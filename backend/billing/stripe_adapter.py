"""Stripe webhook translation into the provider-neutral subscription domain."""

from datetime import datetime, timezone
import logging
import os
import uuid

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..billing_customers import get_billing_customer
from ..database import SessionLocal, WebhookEvent, get_db
from ..runtime_config import stripe_billing_enabled, stripe_expect_livemode
from ..subscriptions import SubscriptionStatus, upsert_subscription


logger = logging.getLogger(__name__)
router = APIRouter(tags=["billing"])

SUPPORTED_SUBSCRIPTION_EVENTS = frozenset({
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
})

STRIPE_STATUS_MAP = {
    "trialing": SubscriptionStatus.TRIALING.value,
    "active": SubscriptionStatus.ACTIVE.value,
    "past_due": SubscriptionStatus.PAST_DUE.value,
    "canceled": SubscriptionStatus.CANCELED.value,
    "incomplete": SubscriptionStatus.INCOMPLETE.value,
    # These provider states are terminal/non-entitled in the normalized policy.
    "incomplete_expired": SubscriptionStatus.EXPIRED.value,
    "unpaid": SubscriptionStatus.EXPIRED.value,
    "paused": SubscriptionStatus.EXPIRED.value,
}


class StripeEventError(ValueError):
    """A signed event cannot be mapped safely to a local subscription."""


def stripe_price_plan_map(environ=None) -> dict[str, str]:
    """Build trusted server-owned Stripe Price ID -> internal plan mapping."""
    environ = os.environ if environ is None else environ
    configured = [
        (environ.get("STRIPE_PRICE_COACH_STARTER", "").strip(), "coach_starter"),
        (environ.get("STRIPE_PRICE_COACH_PRO", "").strip(), "coach_pro"),
        (environ.get("STRIPE_PRICE_COACH_UNLIMITED", "").strip(), "coach_unlimited"),
    ]
    price_ids = [price_id for price_id, _ in configured if price_id]
    if len(price_ids) != len(set(price_ids)):
        raise StripeEventError("Stripe price configuration contains duplicate price IDs")
    return {price_id: plan_key for price_id, plan_key in configured if price_id}


def stripe_plan_price_map(environ=None) -> dict[str, str]:
    """Checkout's reverse lookup uses the same trusted configuration as webhooks."""
    return {plan: price for price, plan in stripe_price_plan_map(environ).items()}


def normalize_stripe_status(status: str) -> str:
    if not isinstance(status, str) or status not in STRIPE_STATUS_MAP:
        raise StripeEventError("Unsupported Stripe subscription status")
    return STRIPE_STATUS_MAP[status]


def _mapping(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict_recursive"):
        return value.to_dict_recursive()
    if hasattr(value, "to_dict"):
        return value.to_dict()
    try:
        return dict(value)
    except (TypeError, ValueError):
        raise StripeEventError("Malformed Stripe object")


def _optional_datetime(value, field_name):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StripeEventError(f"Stripe {field_name} timestamp is invalid")
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc).replace(tzinfo=None)
    except (OverflowError, OSError, ValueError) as exc:
        raise StripeEventError(f"Stripe {field_name} timestamp is invalid") from exc


def _object_id(value, label):
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict) or hasattr(value, "to_dict_recursive"):
        object_id = _mapping(value).get("id")
        if isinstance(object_id, str) and object_id.strip():
            return object_id.strip()
    raise StripeEventError(f"Stripe {label} ID is missing")


def map_subscription_price(subscription, price_plan_map: dict[str, str]) -> str:
    """Require exactly one known recurring coaching price and no mixed items."""
    data = _mapping(subscription)
    items_value = data.get("items")
    items_data = _mapping(items_value).get("data") if items_value is not None else None
    if not isinstance(items_data, (list, tuple)) or len(items_data) != 1:
        raise StripeEventError("Stripe subscription must contain exactly one coaching price item")
    item = _mapping(items_data[0])
    price_value = item.get("price")
    price_id = _object_id(price_value, "price")
    price_data = _mapping(price_value) if not isinstance(price_value, str) else {}
    if not price_data.get("recurring"):
        raise StripeEventError("Stripe coaching price must be recurring")
    plan_key = price_plan_map.get(price_id)
    if plan_key is None:
        raise StripeEventError("Stripe subscription contains an unrecognized price")
    return plan_key


def normalize_stripe_subscription(subscription, *, event_created: int,
                                   event_id: str, price_plan_map: dict[str, str]) -> dict:
    data = _mapping(subscription)
    sub_id = _object_id(data.get("id"), "subscription")
    customer_id = _object_id(data.get("customer"), "customer")
    plan_key = map_subscription_price(data, price_plan_map)
    status = normalize_stripe_status(data.get("status"))
    cancel_at_period_end = data.get("cancel_at_period_end", False)
    if not isinstance(cancel_at_period_end, bool):
        raise StripeEventError("Stripe cancellation flag is invalid")
    if not isinstance(event_id, str) or not event_id.strip():
        raise StripeEventError("Stripe event ID is missing")
    created_at = _optional_datetime(event_created, "event")
    return {
        "provider_subscription_id": sub_id,
        "provider_customer_id": customer_id,
        "plan_key": plan_key,
        "status": status,
        "current_period_start": _optional_datetime(data.get("current_period_start"), "period start"),
        "current_period_end": _optional_datetime(data.get("current_period_end"), "period end"),
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": _optional_datetime(data.get("canceled_at"), "canceled at"),
        "ended_at": _optional_datetime(data.get("ended_at"), "ended at"),
        "provider_event_created_at": created_at,
        "provider_event_id": event_id,
    }


def process_stripe_event(db: Session, event, *, now: datetime | None = None) -> str:
    """Apply a verified Stripe event; caller controls transaction/commit."""
    event_data = _mapping(event)
    event_id = event_data.get("id")
    event_type = event_data.get("type")
    event_created = event_data.get("created")
    if not isinstance(event_id, str) or not event_id.strip() or not isinstance(event_type, str):
        raise StripeEventError("Stripe event identity is malformed")

    inbox = db.query(WebhookEvent).filter(
        WebhookEvent.provider == "stripe",
        WebhookEvent.external_event_id == event_id,
    ).one_or_none()
    if inbox is not None and inbox.status in {"PROCESSED", "IGNORED", "STALE"}:
        return "duplicate"

    if inbox is None:
        inbox = WebhookEvent(
            id=str(uuid.uuid4()), provider="stripe", external_event_id=event_id,
            status="PROCESSING", received_at=datetime.utcnow(),
        )
        try:
            with db.begin_nested():
                db.add(inbox)
                db.flush()
        except IntegrityError:
            inbox = db.query(WebhookEvent).filter(
                WebhookEvent.provider == "stripe",
                WebhookEvent.external_event_id == event_id,
            ).one_or_none()
            if inbox is None:
                raise
            if inbox.status in {"PROCESSED", "IGNORED", "STALE"}:
                return "duplicate"
            inbox.status = "PROCESSING"
    else:
        # FAILED is retryable. Never commit a claim separately from processing.
        inbox.status = "PROCESSING"

    if event_data.get("account"):
        inbox.status = "IGNORED"
        inbox.processed_at = datetime.utcnow()
        return "ignored_connect"

    if event_type not in SUPPORTED_SUBSCRIPTION_EVENTS:
        inbox.status = "IGNORED"
        inbox.processed_at = datetime.utcnow()
        return "ignored"

    data_block = _mapping(event_data.get("data") or {})
    subscription_data = data_block.get("object")
    if subscription_data is None:
        raise StripeEventError("Stripe subscription event has no object")
    normalized = normalize_stripe_subscription(
        subscription_data,
        event_created=event_created,
        event_id=event_id,
        price_plan_map=stripe_price_plan_map(),
    )
    customer = get_billing_customer(db, "stripe", normalized["provider_customer_id"])
    if customer is None:
        raise StripeEventError("Stripe customer is not linked to a workspace")

    try:
        subscription = upsert_subscription(
            db,
            workspace_id=customer.workspace_id,
            provider="stripe",
            **normalized,
            now=now,
        )
    except ValueError as exc:
        raise StripeEventError("Stripe subscription conflicts with an existing trusted mapping") from exc
    if subscription.provider_event_id != event_id:
        inbox.status = "STALE"
        result = "stale"
    else:
        inbox.status = "PROCESSED"
        result = "processed"
    inbox.processed_at = datetime.utcnow()
    logger.info(
        "Stripe webhook synchronized event_id=%s event_type=%s subscription_id=%s workspace_id=%s result=%s",
        event_id, event_type, normalized["provider_subscription_id"], customer.workspace_id, result,
    )
    return result


def _persist_failed_event(event, detail: str) -> None:
    event_data = _mapping(event)
    event_id = event_data.get("id")
    if not isinstance(event_id, str) or not event_id:
        return
    db = SessionLocal()
    try:
        inbox = db.query(WebhookEvent).filter(
            WebhookEvent.provider == "stripe",
            WebhookEvent.external_event_id == event_id,
        ).one_or_none()
        if inbox is None:
            inbox = WebhookEvent(
                id=str(uuid.uuid4()), provider="stripe", external_event_id=event_id,
                received_at=datetime.utcnow(), status="FAILED",
            )
            db.add(inbox)
        elif inbox.status not in {"PROCESSED", "IGNORED", "STALE"}:
            inbox.status = "FAILED"
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not persist failed Stripe event event_id=%s", event_id)
    finally:
        db.close()
    logger.error("Stripe webhook mapping failed event_id=%s reason=%s", event_id, detail)


@router.post("/api/billing/stripe/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    if not stripe_billing_enabled():
        raise HTTPException(status_code=503, detail="Stripe billing webhook is disabled")
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Stripe webhook verification is not configured")
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature or payload") from exc

    event_data = _mapping(event)
    event_livemode = event_data.get("livemode")
    if not isinstance(event_livemode, bool) or event_livemode != stripe_expect_livemode():
        raise HTTPException(status_code=400, detail="Stripe event mode does not match server configuration")
    try:
        result = process_stripe_event(db, event)
        db.commit()
    except StripeEventError as exc:
        db.rollback()
        _persist_failed_event(event, str(exc))
        raise HTTPException(status_code=500, detail="Stripe subscription event could not be mapped safely") from exc
    except Exception:
        db.rollback()
        event_id = event_data.get("id")
        logger.exception("Stripe webhook processing failed event_id=%s", event_id)
        raise HTTPException(status_code=500, detail="Stripe webhook processing failed")

    event_id = event_data.get("id")
    logger.info("Stripe webhook accepted event_id=%s event_type=%s result=%s", event_id, event_data.get("type"), result)
    return {"status": result}

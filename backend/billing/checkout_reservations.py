"""Persistent, serialized Checkout coordination. Subscriptions alone grant access."""

import json
import logging
import uuid
from datetime import datetime, timedelta

import stripe
from sqlalchemy import update

from ..database import AuditEvent, BillingCheckoutReservation, Workspace
from ..subscriptions import has_current_stripe_subscription

logger = logging.getLogger(__name__)
CREATING_STALE_AFTER = timedelta(minutes=10)
# Stripe only promises idempotency keys for at least 24 hours. Do not replay
# an operation after this conservative window without provider reconciliation.
CREATING_RETRY_LIMIT = timedelta(hours=23)


class ReservationConflict(Exception):
    def __init__(self, code: str):
        self.code = code


class ReservationProviderError(Exception):
    pass


def _audit(db, row, event_type, **extra):
    db.add(AuditEvent(
        id=str(uuid.uuid4()), event_type=event_type,
        resource_type="BillingCheckoutReservation", resource_id=row.id,
        metadata_json=json.dumps({
            "provider": row.provider, "plan_key": row.plan_key,
            "request_id": row.request_id,
            "provider_session_id": row.provider_checkout_session_id, **extra,
        }),
    ))


def lock_workspace(db, workspace_id):
    # UPDATE takes a row lock in PostgreSQL and a writer lock in SQLite. It
    # serializes the initial insert as well as later slot transitions.
    result = db.execute(update(Workspace).where(Workspace.id == workspace_id).values(updated_at=datetime.utcnow()))
    if result.rowcount != 1:
        raise ValueError("Workspace does not exist")


def current_reservation(db, workspace_id, provider="stripe"):
    return db.query(BillingCheckoutReservation).filter_by(workspace_id=workspace_id, provider=provider).one_or_none()


def is_expired(row, now=None):
    return row.status == "OPEN" and row.expires_at is not None and row.expires_at <= (now or datetime.utcnow())


def expire_provider_session(row, api_key):
    """Fail closed if an expired local slot may still be usable at Stripe."""
    if not row.provider_checkout_session_id:
        raise ReservationProviderError("Checkout session identity is unavailable")
    try:
        session = stripe.checkout.Session.retrieve(row.provider_checkout_session_id, api_key=api_key)
        status = session.get("status")
        if status == "open":
            session = stripe.checkout.Session.expire(row.provider_checkout_session_id, api_key=api_key)
            status = session.get("status")
        if status != "expired":
            raise ReservationProviderError("Previous Checkout session is not confirmed expired")
    except stripe.error.StripeError as exc:
        logger.warning("Could not expire Checkout session id=%s type=%s", row.provider_checkout_session_id, type(exc).__name__)
        raise ReservationProviderError("Could not confirm previous Checkout expiration") from exc


def claim_checkout(db, *, workspace_id, provider, request_id, plan_key, api_key):
    """Return (reservation, action) after atomically claiming a workspace slot.

    Call within a transaction; commit CREATING before any provider creation.
    """
    now = datetime.utcnow()
    lock_workspace(db, workspace_id)
    if provider == "stripe" and has_current_stripe_subscription(db, workspace_id):
        raise ReservationConflict("BILLING_SUBSCRIPTION_EXISTS")
    row = current_reservation(db, workspace_id, provider)
    if row and row.request_id == request_id and row.plan_key != plan_key:
        raise ReservationConflict("BILLING_CHECKOUT_REQUEST_CONFLICT")
    if row and row.status == "OPEN" and not is_expired(row, now):
        if row.plan_key != plan_key:
            raise ReservationConflict("BILLING_CHECKOUT_IN_PROGRESS")
        _audit(db, row, "CHECKOUT_RESUMED")
        return row, "resume"
    if row and row.status == "CREATING":
        age = now - row.updated_at
        if (row.plan_key != plan_key or now - row.created_at > CREATING_RETRY_LIMIT or
                (row.request_id != request_id and age < CREATING_STALE_AFTER)):
            raise ReservationConflict("BILLING_CHECKOUT_IN_PROGRESS")
        # A crashed worker may have created a session before its DB write.
        # Recover using the *original* request and Stripe idempotency key.
        row.updated_at = now
        return row, "recover"
    if row and row.request_id == request_id and row.status != "FAILED":
        raise ReservationConflict("BILLING_CHECKOUT_REQUEST_CONFLICT")
    if row and is_expired(row, now):
        expire_provider_session(row, api_key)
        row.status = "EXPIRED"
        row.updated_at = now
        _audit(db, row, "CHECKOUT_EXPIRED")
    if row is None:
        row = BillingCheckoutReservation(
            id=str(uuid.uuid4()), workspace_id=workspace_id, provider=provider,
            request_id=request_id, plan_key=plan_key, status="CREATING",
            created_at=now, updated_at=now,
        )
        db.add(row)
    else:
        row.request_id = request_id
        row.plan_key = plan_key
        row.provider_checkout_session_id = None
        row.provider_checkout_url = None
        row.expires_at = None
        row.status = "CREATING"
        row.created_at = now
        row.updated_at = now
    _audit(db, row, "CHECKOUT_RESERVED")
    return row, "create"


def finalize_checkout(db, *, workspace_id, provider, request_id, session):
    lock_workspace(db, workspace_id)
    row = current_reservation(db, workspace_id, provider)
    if row is None or row.request_id != request_id or row.status != "CREATING":
        raise ReservationConflict("BILLING_CHECKOUT_IN_PROGRESS")
    session_id, url, expires = session.get("id"), session.get("url"), session.get("expires_at")
    if (not isinstance(session_id, str) or not session_id.startswith("cs_") or
            not isinstance(url, str) or not url.startswith("https://checkout.stripe.com/") or
            not isinstance(expires, int) or expires <= 0):
        raise ReservationProviderError("Checkout Session response is incomplete")
    row.provider_checkout_session_id = session_id
    row.provider_checkout_url = url
    row.expires_at = datetime.utcfromtimestamp(expires)
    row.status = "OPEN"
    row.updated_at = datetime.utcnow()
    _audit(db, row, "CHECKOUT_CREATED")
    return row


def fail_checkout(db, *, workspace_id, provider, request_id):
    lock_workspace(db, workspace_id)
    row = current_reservation(db, workspace_id, provider)
    if row and row.request_id == request_id and row.status == "CREATING":
        row.status = "FAILED"
        row.updated_at = datetime.utcnow()
        _audit(db, row, "CHECKOUT_FAILED")


def reconcile_subscription_checkout(db, *, workspace_id, provider, plan_key):
    """Called only after trusted customer mapping and subscription upsert."""
    lock_workspace(db, workspace_id)
    row = current_reservation(db, workspace_id, provider)
    if row is None or row.status not in {"CREATING", "OPEN"}:
        return
    mismatch = row.plan_key != plan_key
    row.status = "COMPLETED"
    row.updated_at = datetime.utcnow()
    if mismatch:
        logger.warning("Checkout plan mismatch workspace_id=%s reserved=%s synchronized=%s", workspace_id, row.plan_key, plan_key)
        _audit(db, row, "CHECKOUT_RECONCILIATION_MISMATCH", subscription_plan_key=plan_key)
    _audit(db, row, "CHECKOUT_COMPLETED", subscription_plan_key=plan_key)

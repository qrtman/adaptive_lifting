"""Provider-neutral subscription lifecycle policy and synchronization service.

No provider API calls belong here. Provider adapters must map trusted server-side
product configuration to an internal plan key before calling ``upsert_subscription``.
"""

from datetime import datetime, timedelta, timezone
from enum import Enum
import json
import os
import uuid

from sqlalchemy.exc import IntegrityError

from .database import AuditEvent, Subscription


class SubscriptionStatus(str, Enum):
    TRIALING = "TRIALING"
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    CANCELED = "CANCELED"
    EXPIRED = "EXPIRED"
    INCOMPLETE = "INCOMPLETE"


ALLOWED_SUBSCRIPTION_STATUSES = tuple(status.value for status in SubscriptionStatus)
DEFAULT_PAST_DUE_GRACE_DAYS = 3


def has_current_stripe_subscription(db, workspace_id: str, now: datetime | None = None) -> bool:
    """Block a second Checkout until every Stripe subscription is terminal."""
    now = _utc_naive(now or datetime.utcnow())
    rows = db.query(Subscription).filter_by(workspace_id=workspace_id, provider="stripe").all()
    return any(row.status != SubscriptionStatus.EXPIRED.value and not (
        row.status == SubscriptionStatus.CANCELED.value and
        row.current_period_end is not None and _utc_naive(row.current_period_end) <= now
    ) for row in rows)


def _utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise ValueError("Subscription timestamps must be datetimes")
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _normalized_status(value: str | SubscriptionStatus) -> str:
    raw = value.value if isinstance(value, SubscriptionStatus) else str(value)
    try:
        return SubscriptionStatus(raw.strip().upper()).value
    except ValueError as exc:
        raise ValueError(f"Unknown subscription status: {raw}") from exc


def past_due_grace_days() -> int:
    """Read the grace period; unset defaults to 3 days, zero disables grace."""
    configured = os.environ.get("SUBSCRIPTION_PAST_DUE_GRACE_DAYS")
    if configured is None or not configured.strip():
        return DEFAULT_PAST_DUE_GRACE_DAYS
    try:
        days = int(configured)
    except ValueError as exc:
        raise ValueError("SUBSCRIPTION_PAST_DUE_GRACE_DAYS must be a non-negative integer") from exc
    if days < 0:
        raise ValueError("SUBSCRIPTION_PAST_DUE_GRACE_DAYS must be a non-negative integer")
    return days


def subscription_is_entitled(subscription: Subscription, now: datetime | None = None,
                              grace_days: int | None = None) -> bool:
    """Apply the single normalized status policy used by entitlement resolution.

    ACTIVE and TRIALING are eligible. A scheduled or already-recorded
    cancellation remains eligible through its period end. PAST_DUE is eligible
    only before period-end plus the configured grace period. Missing boundaries
    fail closed for CANCELED and PAST_DUE records.
    """
    status = _normalized_status(subscription.status)
    now_utc = _utc_naive(now or datetime.utcnow())
    period_end = _utc_naive(subscription.current_period_end)
    if status == SubscriptionStatus.TRIALING.value:
        return True
    if status == SubscriptionStatus.ACTIVE.value:
        if subscription.cancel_at_period_end:
            return period_end is not None and now_utc < period_end
        return True
    if status == SubscriptionStatus.CANCELED.value:
        return period_end is not None and now_utc < period_end
    if status == SubscriptionStatus.PAST_DUE.value:
        if period_end is None:
            return False
        grace = past_due_grace_days() if grace_days is None else grace_days
        if not isinstance(grace, int) or isinstance(grace, bool) or grace < 0:
            raise ValueError("grace_days must be a non-negative integer")
        return now_utc < period_end + timedelta(days=grace)
    return False


def _audit(db, event_type: str, subscription: Subscription, old_status: str | None,
           old_plan: str | None, actor_user_id: str | None):
    db.add(AuditEvent(
        id=str(uuid.uuid4()), actor_user_id=actor_user_id,
        event_type=event_type, resource_type="Subscription", resource_id=subscription.id,
        metadata_json=json.dumps({
            "provider": subscription.provider,
            "plan_key": subscription.plan_key,
            "old_plan_key": old_plan,
            "old_status": old_status,
            "new_status": subscription.status,
            "provider_event_id": subscription.provider_event_id,
        }),
    ))


def upsert_subscription(db, *, workspace_id: str, provider: str,
                        provider_subscription_id: str, plan_key: str,
                        status: str | SubscriptionStatus,
                        current_period_start: datetime | None = None,
                        current_period_end: datetime | None = None,
                        cancel_at_period_end: bool = False,
                        provider_customer_id: str | None = None,
                        canceled_at: datetime | None = None,
                        ended_at: datetime | None = None,
                        provider_event_created_at: datetime | None = None,
                        provider_event_id: str | None = None,
                        actor_user_id: str | None = None,
                        now: datetime | None = None) -> Subscription:
    """Create or update a subscription by stable provider identity.

    The caller owns the outer transaction and commits or rolls it back along
    with any surrounding operation. Database uniqueness plus a savepoint makes
    concurrent duplicate synchronization safe without exposing partial audit
    writes. Provider-supplied metadata must never select ``plan_key`` directly.
    """
    from .entitlements import PLAN_CONFIG, SUBSCRIPTION_PLAN_KEYS

    normalized_provider = (provider or "").strip().lower()
    normalized_provider_subscription_id = (provider_subscription_id or "").strip()
    if not normalized_provider:
        raise ValueError("Subscription provider is required")
    if not normalized_provider_subscription_id:
        raise ValueError("Provider subscription ID is required")
    if plan_key not in SUBSCRIPTION_PLAN_KEYS or plan_key not in PLAN_CONFIG:
        raise ValueError(f"Plan is not available for subscriptions: {plan_key}")
    if not isinstance(cancel_at_period_end, bool):
        raise ValueError("cancel_at_period_end must be a boolean")
    normalized = {
        "workspace_id": str(workspace_id),
        "provider": normalized_provider,
        "provider_customer_id": (provider_customer_id.strip() or None) if provider_customer_id else None,
        "provider_subscription_id": normalized_provider_subscription_id,
        "plan_key": plan_key,
        "status": _normalized_status(status),
        "current_period_start": _utc_naive(current_period_start),
        "current_period_end": _utc_naive(current_period_end),
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": _utc_naive(canceled_at),
        "ended_at": _utc_naive(ended_at),
    }
    if (normalized["current_period_start"] is not None and normalized["current_period_end"] is not None
            and normalized["current_period_end"] < normalized["current_period_start"]):
        raise ValueError("Subscription period end must not be before its start")
    event_created_at = _utc_naive(provider_event_created_at)
    event_id = (provider_event_id or "").strip() or None
    if (event_created_at is None) != (event_id is None):
        raise ValueError("Provider event timestamp and ID must be supplied together")
    updated_at = _utc_naive(now or datetime.utcnow())

    try:
        with db.begin_nested():
            subscription = db.query(Subscription).filter(
                Subscription.provider == normalized_provider,
                Subscription.provider_subscription_id == normalized_provider_subscription_id,
            ).with_for_update().one_or_none()
            created = subscription is None
            if created:
                subscription = Subscription(id=str(uuid.uuid4()), **normalized)
                db.add(subscription)
                subscription.provider_event_created_at = event_created_at
                subscription.provider_event_id = event_id
                old_status = None
                old_plan = None
                state_changed = True
                changed = True
            else:
                if subscription.workspace_id != str(workspace_id):
                    raise ValueError("A provider subscription cannot be reassigned to another workspace")
                if event_created_at is not None and subscription.provider_event_created_at is not None:
                    previous_order = (
                        _utc_naive(subscription.provider_event_created_at),
                        subscription.provider_event_id or "",
                    )
                    incoming_order = (event_created_at, event_id)
                    # Event IDs break same-second ties consistently. A lower
                    # or equal pair is stale and leaves the row/audit untouched.
                    if incoming_order <= previous_order:
                        return subscription
                old_plan = subscription.plan_key
                old_status = subscription.status
                state_changed = any(getattr(subscription, key) != value for key, value in normalized.items())
                changed = state_changed
                if event_created_at is not None:
                    changed = changed or (
                        subscription.provider_event_created_at != event_created_at
                        or subscription.provider_event_id != event_id
                    )
                for key, value in normalized.items():
                    setattr(subscription, key, value)
                if event_created_at is not None:
                    subscription.provider_event_created_at = event_created_at
                    subscription.provider_event_id = event_id
                if changed:
                    subscription.updated_at = updated_at
            db.flush()
            if changed and state_changed:
                event_type = "SUBSCRIPTION_CREATED" if created else (
                    "SUBSCRIPTION_STATUS_CHANGED" if old_status != subscription.status else "SUBSCRIPTION_UPDATED"
                )
                _audit(db, event_type, subscription, old_status, old_plan, actor_user_id)
                db.flush()
        return subscription
    except IntegrityError:
        # A concurrent webhook may have inserted the same provider identity.
        # Retry as an update after the unique constraint has resolved the race.
        existing = db.query(Subscription).filter(
            Subscription.provider == normalized_provider,
            Subscription.provider_subscription_id == normalized_provider_subscription_id,
        ).one_or_none()
        if existing is None:
            raise
        return upsert_subscription(
            db, workspace_id=workspace_id, provider=provider,
            provider_subscription_id=provider_subscription_id, plan_key=plan_key,
            status=status, current_period_start=current_period_start,
            current_period_end=current_period_end, cancel_at_period_end=cancel_at_period_end,
            provider_customer_id=provider_customer_id, canceled_at=canceled_at,
            ended_at=ended_at, provider_event_created_at=provider_event_created_at,
            provider_event_id=provider_event_id, actor_user_id=actor_user_id, now=now,
        )

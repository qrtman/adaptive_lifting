"""Workspace SaaS entitlement resolution and manual access grant services.

coach_beta intentionally outranks coach_starter (20 athletes and integrations)
but remains below coach_pro (25 athletes). Ranking is explicit and stable.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import uuid

from .database import AccessGrant, AuditEvent, Subscription
from .subscriptions import subscription_is_entitled


PLAN_CONFIG = {
    "coach_beta": {
        "max_active_athletes": 20,
        "can_program": True,
        "can_use_analytics": True,
        "can_use_integrations": True,
    },
    "coach_starter": {
        "max_active_athletes": 5,
        "can_program": True,
        "can_use_analytics": True,
        "can_use_integrations": False,
    },
    "coach_pro": {
        "max_active_athletes": 25,
        "can_program": True,
        "can_use_analytics": True,
        "can_use_integrations": True,
    },
    "coach_unlimited": {
        "max_active_athletes": None,
        "can_program": True,
        "can_use_analytics": True,
        "can_use_integrations": True,
    },
}

PLAN_PRECEDENCE = {
    "coach_starter": 1,
    "coach_beta": 2,
    "coach_pro": 3,
    "coach_unlimited": 4,
}

# Beta remains a manual grant tier. Subscription synchronization accepts only
# the sellable product plans; the same plan configuration still drives all
# capability resolution.
SUBSCRIPTION_PLAN_KEYS = frozenset({"coach_starter", "coach_pro", "coach_unlimited"})


@dataclass(frozen=True)
class WorkspaceEntitlements:
    workspace_id: str
    active: bool
    plan_key: str | None
    max_active_athletes: int | None
    can_program: bool
    can_use_analytics: bool
    can_use_integrations: bool
    source_type: str | None = None
    source_id: str | None = None
    source_status: str | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool | None = None


def _utc_naive(value):
    """Use the existing database's naive-UTC DateTime convention."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def get_active_workspace_grants(db, workspace_id, now=None, source=None):
    now = _utc_naive(now or datetime.utcnow())
    query = db.query(AccessGrant).filter(
        AccessGrant.workspace_id == str(workspace_id),
        AccessGrant.starts_at <= now,
        (AccessGrant.expires_at.is_(None) | (AccessGrant.expires_at > now)),
        AccessGrant.revoked_at.is_(None),
    )
    if source is not None:
        query = query.filter(AccessGrant.source == source)
    return query.order_by(AccessGrant.starts_at.desc(), AccessGrant.created_at.desc(), AccessGrant.id).all()


def resolve_workspace_entitlements(db, workspace_id, now=None):
    now_utc = _utc_naive(now or datetime.utcnow())
    candidates = []
    grants = [grant for grant in get_active_workspace_grants(db, workspace_id, now_utc)
              if grant.plan_key in PLAN_CONFIG]
    for grant in grants:
        candidates.append({
            "plan_key": grant.plan_key,
            "source_type": "grant",
            "source_id": grant.id,
            "source_status": "ACTIVE",
            "starts_at": _utc_naive(grant.starts_at),
            "period_end": _utc_naive(grant.expires_at),
            "cancel_at_period_end": None,
        })

    subscriptions = db.query(Subscription).filter(
        Subscription.workspace_id == str(workspace_id),
    ).all()
    for subscription in subscriptions:
        if subscription.plan_key not in PLAN_CONFIG or not subscription_is_entitled(subscription, now=now_utc):
            continue
        candidates.append({
            "plan_key": subscription.plan_key,
            "source_type": "subscription",
            "source_id": subscription.id,
            "source_status": subscription.status,
            "starts_at": _utc_naive(subscription.current_period_start) or _utc_naive(subscription.created_at),
            "period_end": _utc_naive(subscription.current_period_end),
            "cancel_at_period_end": subscription.cancel_at_period_end,
        })

    if not candidates:
        return WorkspaceEntitlements(
            workspace_id=str(workspace_id), active=False, plan_key=None,
            max_active_athletes=0, can_program=False,
            can_use_analytics=False, can_use_integrations=False,
        )

    # Plan capability rank always wins. Same-plan ties use start time and a
    # stable source identity; source type does not confer special precedence.
    selected = max(candidates, key=lambda candidate: (
        PLAN_PRECEDENCE[candidate["plan_key"]],
        candidate["starts_at"],
        candidate["source_id"],
        candidate["source_type"],
    ))
    config = PLAN_CONFIG[selected["plan_key"]]
    return WorkspaceEntitlements(
        workspace_id=str(workspace_id), active=True, plan_key=selected["plan_key"],
        max_active_athletes=config["max_active_athletes"],
        can_program=config["can_program"],
        can_use_analytics=config["can_use_analytics"],
        can_use_integrations=config["can_use_integrations"],
        source_type=selected["source_type"],
        source_id=selected["source_id"],
        source_status=selected["source_status"],
        current_period_end=selected["period_end"],
        cancel_at_period_end=selected["cancel_at_period_end"],
    )


def grant_workspace_access(db, workspace, plan_key, source="manual", days=None,
                           no_expiry=False, reason=None, created_by_user_id=None,
                           now=None):
    if plan_key not in PLAN_CONFIG:
        raise ValueError(f"Unknown plan: {plan_key}")
    if not source or not source.strip():
        raise ValueError("Grant source is required")
    if (days is None and not no_expiry) or (days is not None and no_expiry):
        raise ValueError("Specify exactly one of days or no_expiry")
    if days is not None and (not isinstance(days, int) or isinstance(days, bool) or days <= 0):
        raise ValueError("Grant duration must be a positive number of days")

    starts_at = _utc_naive(now or datetime.utcnow())
    expires_at = starts_at + timedelta(days=days) if days is not None else None
    existing = get_active_workspace_grants(db, workspace.id, now=starts_at)
    duplicate = next((grant for grant in existing
                      if grant.plan_key == plan_key and grant.source == source), None)
    if duplicate is not None:
        return duplicate

    grant = AccessGrant(
        id=str(uuid.uuid4()), workspace_id=str(workspace.id), plan_key=plan_key,
        source=source, starts_at=starts_at, expires_at=expires_at,
        created_by_user_id=created_by_user_id, reason=reason,
    )
    db.add(grant)
    db.flush()
    db.add(AuditEvent(
        id=str(uuid.uuid4()), actor_user_id=created_by_user_id,
        event_type="ACCESS_GRANTED", resource_type="AccessGrant", resource_id=grant.id,
        metadata_json=json.dumps({
            "plan_key": plan_key, "source": source,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "reason": reason,
        }),
    ))
    db.flush()
    return grant


def revoke_workspace_access(db, workspace_id, source=None, now=None):
    now = _utc_naive(now or datetime.utcnow())
    grants = get_active_workspace_grants(db, workspace_id, now=now, source=source)
    for grant in grants:
        grant.revoked_at = now
        db.add(AuditEvent(
            id=str(uuid.uuid4()), actor_user_id=None,
            event_type="ACCESS_REVOKED", resource_type="AccessGrant", resource_id=grant.id,
            metadata_json=json.dumps({"plan_key": grant.plan_key, "source": grant.source}),
        ))
    db.flush()
    return grants

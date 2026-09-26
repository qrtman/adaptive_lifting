"""Coach workspace entitlement checks, kept separate from athlete plan RBAC."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .database import AccessGrant, Subscription, User, Workspace, WorkspaceMember
from .entitlements import (
    WorkspaceEntitlements,
    resolve_workspace_entitlements,
)
from .workspaces import ensure_default_workspace_for_coach, get_active_athlete_count
from .subscriptions import has_current_stripe_subscription


CAPABILITY_FEATURES = {
    "can_program": "programming",
    "can_use_analytics": "analytics",
    "can_use_integrations": "integrations",
}


def get_coach_workspace(db: Session, current_user: User):
    """Find the coach-owned default workspace without creating one."""
    if current_user.role != "COACH":
        return None
    workspace = db.query(Workspace).filter(Workspace.owner_user_id == current_user.id).one_or_none()
    if workspace is None:
        return None
    membership = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.user_id == current_user.id,
    ).one_or_none()
    if membership is None or membership.role != "OWNER":
        return None
    return workspace


def _access_required():
    raise HTTPException(status_code=403, detail={
        "code": "WORKSPACE_ACCESS_REQUIRED",
        "message": "An active coaching plan is required.",
    })


def require_coach_workspace(db: Session, current_user: User):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Only coaches can perform this action")
    workspace = get_coach_workspace(db, current_user)
    if workspace is None:
        _access_required()
    return workspace


def require_workspace_billing_owner(db: Session, current_user: User):
    """Billing requires the server-controlled owner membership, never a client role."""
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail={"code": "BILLING_OWNER_REQUIRED", "message": "Workspace owner access is required for billing."})
    workspace = get_coach_workspace(db, current_user)
    if workspace is None:
        raise HTTPException(status_code=403, detail={"code": "BILLING_OWNER_REQUIRED", "message": "Workspace owner access is required for billing."})
    return workspace


def require_coach_entitlement(db: Session, current_user: User, capability: str | None = None):
    """Require an active coach workspace and, optionally, one named capability.

    Athlete callers are deliberately unaffected so shared endpoint functions can
    apply this check without blocking athlete-owned plan work.
    """
    if current_user.role == "ATHLETE":
        return None
    workspace = require_coach_workspace(db, current_user)
    entitlements = resolve_workspace_entitlements(db, workspace.id)
    if not entitlements.active:
        _access_required()
    if capability is not None:
        if capability not in CAPABILITY_FEATURES:
            raise ValueError(f"Unknown coach capability: {capability}")
        if not getattr(entitlements, capability):
            feature = CAPABILITY_FEATURES[capability]
            raise HTTPException(status_code=403, detail={
                "code": "FEATURE_NOT_INCLUDED",
                "feature": feature,
                "message": f"This coaching plan does not include {feature}.",
            })
    return entitlements


def require_programming_access(db: Session, current_user: User):
    return require_coach_entitlement(db, current_user, "can_program")


def require_analytics_access(db: Session, current_user: User):
    return require_coach_entitlement(db, current_user, "can_use_analytics")


def require_integrations_access(db: Session, current_user: User):
    return require_coach_entitlement(db, current_user, "can_use_integrations")


def require_active_coach_access(db: Session, coach: User):
    return require_coach_entitlement(db, coach)


def require_athlete_capacity(db: Session, coach: User):
    """Lock the workspace row while checking capacity before a new relationship."""
    if coach.role != "COACH":
        _access_required()
    workspace = require_coach_workspace(db, coach)
    locked_workspace = db.query(Workspace).filter(Workspace.id == workspace.id).with_for_update().one_or_none()
    if locked_workspace is None:
        _access_required()
    entitlements = require_active_coach_access(db, coach)
    active_count = get_active_athlete_count(db, locked_workspace)
    limit = entitlements.max_active_athletes
    if limit is not None and active_count >= limit:
        raise HTTPException(status_code=409, detail={
            "code": "ATHLETE_LIMIT_REACHED",
            "message": "This coaching account has reached its active athlete limit.",
            "activeAthletes": active_count,
            "maxActiveAthletes": limit,
        })
    return active_count


def build_account_access_state(db: Session, current_user: User) -> dict:
    if current_user.role != "COACH":
        return {
            "workspace": None,
            "membershipRole": None,
            "entitlements": None,
            "grant": None,
            "accessSource": None,
            "usage": None,
        }

    workspace = ensure_default_workspace_for_coach(db, current_user)
    db.commit()
    membership = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.user_id == current_user.id,
    ).one_or_none()
    entitlements = resolve_workspace_entitlements(db, workspace.id)
    grant = db.query(AccessGrant).filter(
        AccessGrant.id == entitlements.source_id,
        AccessGrant.workspace_id == workspace.id,
    ).one_or_none() if entitlements.source_type == "grant" else None
    subscription = db.query(Subscription).filter(
        Subscription.id == entitlements.source_id,
        Subscription.workspace_id == workspace.id,
    ).one_or_none() if entitlements.source_type == "subscription" else None
    if not entitlements.active and subscription is None:
        subscription = db.query(Subscription).filter(
            Subscription.workspace_id == workspace.id,
        ).order_by(Subscription.updated_at.desc(), Subscription.id).first()
    # Billing controls need the Stripe lifecycle even when a more permissive
    # manual grant wins. Never use this display field for entitlement checks.
    stripe_subscription = db.query(Subscription).filter(
        Subscription.workspace_id == workspace.id,
        Subscription.provider == "stripe",
    ).order_by(Subscription.updated_at.desc(), Subscription.id).first()
    entitlement_data = {
        "active": entitlements.active,
        "planKey": entitlements.plan_key,
        "maxActiveAthletes": entitlements.max_active_athletes,
        "canProgram": entitlements.can_program,
        "canUseAnalytics": entitlements.can_use_analytics,
        "canUseIntegrations": entitlements.can_use_integrations,
    }
    return {
        "workspace": {"id": workspace.id, "name": workspace.name},
        "membershipRole": membership.role if membership else None,
        "entitlements": entitlement_data,
        "grant": ({
            "source": grant.source,
            "startsAt": grant.starts_at.isoformat(),
            "expiresAt": grant.expires_at.isoformat() if grant.expires_at else None,
        } if grant else None),
        "accessSource": ({
            "type": "subscription",
            "status": subscription.status,
            "currentPeriodEnd": subscription.current_period_end.isoformat() if subscription.current_period_end else None,
            "cancelAtPeriodEnd": bool(subscription.cancel_at_period_end),
        } if subscription else ({
            "type": "grant",
            "status": "ACTIVE",
            "expiresAt": grant.expires_at.isoformat() if grant.expires_at else None,
        } if grant else None)),
        "billingSubscription": ({
            "planKey": stripe_subscription.plan_key,
            "status": stripe_subscription.status,
            "currentPeriodEnd": stripe_subscription.current_period_end.isoformat() if stripe_subscription.current_period_end else None,
            "cancelAtPeriodEnd": bool(stripe_subscription.cancel_at_period_end),
        } if stripe_subscription else None),
        "canStartCheckout": not has_current_stripe_subscription(db, workspace.id),
        "usage": {
            "activeAthletes": get_active_athlete_count(db, workspace),
            "maxActiveAthletes": entitlements.max_active_athletes,
        },
    }

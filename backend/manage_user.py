"""Operator commands for manually managing user access."""

import argparse
import json
import sys
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func

from .database import AccessGrant, AuditEvent, BillingCustomer, SessionLocal, Subscription, User, Workspace, WorkspaceMember
from .entitlements import (
    PLAN_CONFIG,
    SUBSCRIPTION_PLAN_KEYS,
    grant_workspace_access,
    resolve_workspace_entitlements,
    revoke_workspace_access,
)
from .workspaces import ensure_default_workspace_for_coach, get_active_athlete_count
from .subscriptions import SubscriptionStatus, upsert_subscription
from .billing_customers import link_billing_customer


def _find_user(db, email):
    normalized_email = email.strip().lower()
    return normalized_email, db.query(User).filter(func.lower(User.email) == normalized_email).one_or_none()


def promote_coach(email: str) -> int:
    db = SessionLocal()
    try:
        normalized_email, user = _find_user(db, email)
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1
        if user.role == "COACH":
            print(f"{normalized_email} is already a coach; no change necessary.")
            return 0
        if user.role != "ATHLETE":
            print(f"Cannot promote account with role {user.role!r}.", file=sys.stderr)
            return 1

        user.role = "COACH"
        db.add(AuditEvent(
            id=str(uuid.uuid4()),
            actor_user_id=None,
            event_type="COACH_PROMOTED",
            resource_type="User",
            resource_id=user.id,
            metadata_json=json.dumps({"email": normalized_email}),
        ))
        db.commit()
        print(f"Promoted {normalized_email} to coach.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def grant_coach_access(email: str, plan: str, days=None, no_expiry=False, reason=None) -> int:
    normalized_email = email.strip().lower()
    db = SessionLocal()
    try:
        normalized_email, user = _find_user(db, email)
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1
        if user.role == "ATHLETE":
            user.role = "COACH"
            db.add(AuditEvent(
                id=str(uuid.uuid4()), actor_user_id=None,
                event_type="COACH_PROMOTED", resource_type="User", resource_id=user.id,
                metadata_json=json.dumps({"email": normalized_email}),
            ))
        elif user.role != "COACH":
            print(f"Cannot grant coach access to account with role {user.role!r}.", file=sys.stderr)
            return 1

        workspace = ensure_default_workspace_for_coach(db, user)
        source = "beta" if plan == "coach_beta" else "manual"
        grant = grant_workspace_access(
            db, workspace, plan, source=source, days=days,
            no_expiry=no_expiry, reason=reason,
        )
        db.commit()
        print(f"Granted {grant.plan_key} access to {normalized_email}")
        print(f"Workspace: {workspace.id}")
        print(f"Expires: {grant.expires_at.isoformat() if grant.expires_at else 'never'}")
        print(f"Source: {grant.source}")
        return 0
    except ValueError as exc:
        db.rollback()
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def revoke_coach_access(email: str) -> int:
    normalized_email = email.strip().lower()
    db = SessionLocal()
    try:
        normalized_email, user = _find_user(db, email)
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1
        workspace = db.query(Workspace).filter(Workspace.owner_user_id == user.id).one_or_none()
        if workspace is None:
            print(f"No active access grants found for {normalized_email}.")
            return 0
        grants = revoke_workspace_access(db, workspace.id)
        db.commit()
        if not grants:
            print(f"No active access grants found for {normalized_email}.")
            return 0
        print(f"Revoked {len(grants)} active access grant(s) for {normalized_email}.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def show_access(email: str) -> int:
    normalized_email = email.strip().lower()
    db = SessionLocal()
    try:
        normalized_email, user = _find_user(db, email)
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1

        print(f"Email: {user.email}")
        print(f"Role: {user.role}")
        workspace = db.query(Workspace).filter(Workspace.owner_user_id == user.id).one_or_none()
        if workspace is None:
            print("\nWorkspace: none")
            print("\nAccess:\n  Active: no")
            print("\nAthletes:\n  Active: 0\n  Limit: 0")
            return 0

        member = db.query(WorkspaceMember).filter(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user.id,
        ).one_or_none()
        entitlements = resolve_workspace_entitlements(db, workspace.id)
        grants = db.query(AccessGrant).filter(AccessGrant.workspace_id == workspace.id).order_by(
            AccessGrant.created_at.desc(), AccessGrant.id,
        ).all()
        subscriptions = db.query(Subscription).filter(Subscription.workspace_id == workspace.id).order_by(
            Subscription.created_at.desc(), Subscription.id,
        ).all()
        billing_customers = db.query(BillingCustomer).filter(
            BillingCustomer.workspace_id == workspace.id,
        ).order_by(BillingCustomer.provider).all()
        print("\nWorkspace:")
        print(f"  ID: {workspace.id}")
        print(f"  Name: {workspace.name}")
        print(f"  Membership: {member.role if member else 'none'}")
        print("\nAccess:")
        print(f"  Active: {'yes' if entitlements.active else 'no'}")
        print(f"  Plan: {entitlements.plan_key or 'none'}")
        if entitlements.source_type == "grant":
            selected = next((grant for grant in grants if grant.id == entitlements.source_id), None)
            print(f"  Source: {selected.source if selected else 'grant'}")
            print(f"  Started: {selected.starts_at.isoformat() if selected else 'unknown'}")
            print(f"  Expires: {selected.expires_at.isoformat() if selected and selected.expires_at else ('never' if selected else 'unknown')}")
        elif entitlements.source_type == "subscription":
            selected = next((sub for sub in subscriptions if sub.id == entitlements.source_id), None)
            print("  Source: subscription")
            print(f"  Status: {selected.status if selected else 'unknown'}")
            print(f"  Period ends: {selected.current_period_end.isoformat() if selected and selected.current_period_end else 'unknown'}")
        else:
            print("  Source: none")

        print("\nManual grants:")
        if not grants:
            print("  none")
        now = datetime.utcnow()
        for grant in grants:
            state = "REVOKED" if grant.revoked_at is not None else (
                "EXPIRED" if grant.expires_at is not None and grant.expires_at <= now else "ACTIVE OR SCHEDULED"
            )
            expiry = grant.expires_at.isoformat() if grant.expires_at else "never"
            print(f"  {grant.plan_key} · {grant.source} · {state} · expires {expiry}")

        print("\nSubscriptions:")
        if not subscriptions:
            print("  none")
        for subscription in subscriptions:
            period_end = subscription.current_period_end.isoformat() if subscription.current_period_end else "unknown"
            cancel = " · cancels at period end" if subscription.cancel_at_period_end else ""
            print(f"  {subscription.provider} · {subscription.plan_key} · {subscription.status} · period ends {period_end}{cancel}")
        print("\nBilling customers:")
        if not billing_customers:
            print("  none")
        for customer in billing_customers:
            masked = f"{customer.provider_customer_id[:5]}…{customer.provider_customer_id[-4:]}" if len(customer.provider_customer_id) > 10 else customer.provider_customer_id
            print(f"  {customer.provider}: {masked}")
        limit = "unlimited" if entitlements.max_active_athletes is None else entitlements.max_active_athletes
        print("\nAthletes:")
        print(f"  Active: {get_active_athlete_count(db, workspace)}")
        print(f"  Limit: {limit}")
        return 0
    finally:
        db.close()


def link_billing_customer_for_user(email: str, provider: str, customer_id: str) -> int:
    normalized_email = email.strip().lower()
    db = SessionLocal()
    try:
        normalized_email, user = _find_user(db, email)
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1
        if user.role != "COACH":
            print("Billing customers can only be linked to a coach workspace.", file=sys.stderr)
            return 1
        workspace = ensure_default_workspace_for_coach(db, user)
        mapping = link_billing_customer(
            db, workspace_id=workspace.id, provider=provider,
            provider_customer_id=customer_id,
        )
        db.commit()
        masked = f"{mapping.provider_customer_id[:5]}…{mapping.provider_customer_id[-4:]}" if len(mapping.provider_customer_id) > 10 else mapping.provider_customer_id
        print(f"Linked billing customer for {normalized_email}.")
        print(f"Provider: {mapping.provider}")
        print(f"Customer: {masked}")
        print(f"Workspace: {workspace.id}")
        return 0
    except ValueError as exc:
        db.rollback()
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def set_test_subscription(email: str, plan: str, status: str, period_days: int,
                          cancel_at_period_end: bool = False) -> int:
    normalized_email = email.strip().lower()
    if not isinstance(period_days, int) or isinstance(period_days, bool) or period_days <= 0:
        print("Subscription period must be a positive number of days.", file=sys.stderr)
        return 1
    db = SessionLocal()
    try:
        normalized_email, user = _find_user(db, email)
        if user is None:
            print(f"No account found for {normalized_email}.", file=sys.stderr)
            return 1
        if user.role == "ATHLETE":
            user.role = "COACH"
            db.add(AuditEvent(
                id=str(uuid.uuid4()), actor_user_id=None,
                event_type="COACH_PROMOTED", resource_type="User", resource_id=user.id,
                metadata_json=json.dumps({"email": normalized_email}),
            ))
        elif user.role != "COACH":
            print(f"Cannot assign a coach subscription to account with role {user.role!r}.", file=sys.stderr)
            return 1

        workspace = ensure_default_workspace_for_coach(db, user)
        now = datetime.utcnow()
        period_start = now - timedelta(days=period_days) if status == SubscriptionStatus.EXPIRED.value else now
        period_end = now - timedelta(seconds=1) if status == SubscriptionStatus.EXPIRED.value else now + timedelta(days=period_days)
        subscription = upsert_subscription(
            db,
            workspace_id=workspace.id,
            provider="manual_test",
            provider_subscription_id=f"manual-test:{workspace.id}",
            plan_key=plan,
            status=status,
            current_period_start=period_start,
            current_period_end=period_end,
            cancel_at_period_end=cancel_at_period_end,
            canceled_at=now if status == SubscriptionStatus.CANCELED.value else None,
            ended_at=now if status == SubscriptionStatus.EXPIRED.value else None,
            now=now,
        )
        db.commit()
        print(f"Set test subscription for {normalized_email}")
        print(f"Provider: {subscription.provider}")
        print(f"Plan: {subscription.plan_key}")
        print(f"Status: {subscription.status}")
        print(f"Period ends: {subscription.current_period_end.isoformat() if subscription.current_period_end else 'unknown'}")
        print(f"Cancel at period end: {'yes' if subscription.cancel_at_period_end else 'no'}")
        return 0
    except ValueError as exc:
        db.rollback()
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Manage Adaptive Lifting user access")
    subparsers = parser.add_subparsers(dest="command", required=True)
    promote_parser = subparsers.add_parser("promote-coach", help="Promote an athlete account to coach")
    promote_parser.add_argument("email", help="Email address of the existing account")
    grant_parser = subparsers.add_parser("grant-coach-access", help="Promote if needed and grant workspace access")
    grant_parser.add_argument("email", help="Email address of the existing account")
    grant_parser.add_argument("--plan", required=True, choices=sorted(PLAN_CONFIG))
    duration = grant_parser.add_mutually_exclusive_group(required=True)
    duration.add_argument("--days", type=int, help="Grant duration in whole days")
    duration.add_argument("--no-expiry", action="store_true", help="Grant access without an expiry")
    grant_parser.add_argument("--reason", help="Operator note stored with the grant")
    revoke_parser = subparsers.add_parser("revoke-coach-access", help="Revoke active workspace grants")
    revoke_parser.add_argument("email", help="Email address of the existing account")
    show_parser = subparsers.add_parser("show-access", help="Show workspace and entitlement state")
    show_parser.add_argument("email", help="Email address of the existing account")
    test_subscription_parser = subparsers.add_parser(
        "set-test-subscription", help="Create or update a manual_test subscription for operator testing",
    )
    test_subscription_parser.add_argument("email", help="Email address of the existing account")
    test_subscription_parser.add_argument("--plan", required=True, choices=sorted(SUBSCRIPTION_PLAN_KEYS))
    test_subscription_parser.add_argument("--status", required=True, choices=[status.value for status in SubscriptionStatus])
    test_subscription_parser.add_argument("--period-days", "--days", dest="period_days", required=True, type=int)
    test_subscription_parser.add_argument("--cancel-at-period-end", action="store_true")
    link_customer_parser = subparsers.add_parser(
        "link-billing-customer", help="Link an external billing customer to a coach workspace",
    )
    link_customer_parser.add_argument("email", help="Email address of the coach account")
    link_customer_parser.add_argument("--provider", required=True, choices=["stripe"])
    link_customer_parser.add_argument("--customer-id", required=True, help="External provider customer ID")
    args = parser.parse_args(argv)

    if args.command == "promote-coach":
        return promote_coach(args.email)
    if args.command == "grant-coach-access":
        return grant_coach_access(args.email, args.plan, days=args.days,
                                  no_expiry=args.no_expiry, reason=args.reason)
    if args.command == "revoke-coach-access":
        return revoke_coach_access(args.email)
    if args.command == "show-access":
        return show_access(args.email)
    if args.command == "set-test-subscription":
        return set_test_subscription(args.email, args.plan, args.status, args.period_days,
                                     cancel_at_period_end=args.cancel_at_period_end)
    if args.command == "link-billing-customer":
        return link_billing_customer_for_user(args.email, args.provider, args.customer_id)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

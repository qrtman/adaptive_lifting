import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.database import AuditEvent, SessionLocal, Subscription, User, Workspace
from backend.entitlements import grant_workspace_access, resolve_workspace_entitlements
from backend.manage_user import main as manage_user_main
from backend.saas_access import build_account_access_state, require_analytics_access, require_integrations_access, require_programming_access
from backend.subscriptions import (
    DEFAULT_PAST_DUE_GRACE_DAYS,
    SubscriptionStatus,
    past_due_grace_days,
    subscription_is_entitled,
    upsert_subscription,
)
from backend.workspaces import ensure_default_workspace_for_coach


def _coach(db, email=None):
    email = email or f"subscription-{uuid.uuid4().hex}@example.com"
    user = User(id=str(uuid.uuid4()), email=email, hashed_password="test-only", role="COACH")
    db.add(user)
    db.flush()
    return user


def _subscription(status, period_end=None, *, cancel_at_period_end=False):
    return SimpleNamespace(
        status=status,
        current_period_end=period_end,
        cancel_at_period_end=cancel_at_period_end,
    )


def _upsert(db, workspace, *, plan="coach_pro", status="ACTIVE", now=None, **kwargs):
    now = now or datetime(2026, 9, 27, 12, 0, 0)
    return upsert_subscription(
        db,
        workspace_id=workspace.id,
        provider="manual_test",
        provider_subscription_id=f"subscription:{workspace.id}",
        plan_key=plan,
        status=status,
        current_period_start=kwargs.pop("current_period_start", now),
        current_period_end=kwargs.pop("current_period_end", now + timedelta(days=30)),
        now=now,
        **kwargs,
    )


def test_normalized_subscription_status_policy_and_grace_period(monkeypatch):
    now = datetime(2026, 9, 27, 12, 0, 0)
    future = now + timedelta(days=1)
    past = now - timedelta(days=1)
    assert subscription_is_entitled(_subscription("TRIALING"), now)
    assert subscription_is_entitled(_subscription("ACTIVE"), now)
    assert subscription_is_entitled(_subscription("ACTIVE", past), now)
    assert not subscription_is_entitled(_subscription("ACTIVE", past, cancel_at_period_end=True), now)
    assert subscription_is_entitled(_subscription("ACTIVE", future, cancel_at_period_end=True), now)
    assert subscription_is_entitled(_subscription("CANCELED", future), now)
    assert not subscription_is_entitled(_subscription("CANCELED", now), now)
    assert subscription_is_entitled(_subscription("PAST_DUE", past), now, grace_days=3)
    assert not subscription_is_entitled(_subscription("PAST_DUE", now - timedelta(days=3)), now, grace_days=3)
    assert not subscription_is_entitled(_subscription("PAST_DUE", None), now, grace_days=3)
    assert not subscription_is_entitled(_subscription("EXPIRED", future), now)
    assert not subscription_is_entitled(_subscription("INCOMPLETE", future), now)

    monkeypatch.delenv("SUBSCRIPTION_PAST_DUE_GRACE_DAYS", raising=False)
    assert past_due_grace_days() == DEFAULT_PAST_DUE_GRACE_DAYS == 3
    monkeypatch.setenv("SUBSCRIPTION_PAST_DUE_GRACE_DAYS", "0")
    assert past_due_grace_days() == 0
    monkeypatch.setenv("SUBSCRIPTION_PAST_DUE_GRACE_DAYS", "invalid")
    with pytest.raises(ValueError, match="SUBSCRIPTION_PAST_DUE_GRACE_DAYS"):
        past_due_grace_days()


def test_subscription_upsert_is_idempotent_audited_and_updates_one_row():
    now = datetime(2026, 9, 27, 12, 0, 0)
    with SessionLocal() as db:
        coach = _coach(db)
        workspace = ensure_default_workspace_for_coach(db, coach)
        period_end = now + timedelta(days=30)
        aware_start = datetime(2026, 9, 27, 14, 0, tzinfo=timezone(timedelta(hours=2)))
        first = _upsert(db, workspace, now=now, provider_customer_id="customer-test",
                        current_period_start=aware_start, current_period_end=period_end)
        repeated = _upsert(db, workspace, now=now, provider_customer_id="customer-test",
                           current_period_start=aware_start, current_period_end=period_end)
        assert first.id == repeated.id
        assert first.current_period_start == now
        assert db.query(Subscription).filter_by(workspace_id=workspace.id).count() == 1
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_CREATED", resource_id=first.id).count() == 1
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_UPDATED", resource_id=first.id).count() == 0

        updated = _upsert(db, workspace, plan="coach_starter", status="PAST_DUE", now=now,
                          provider_customer_id="customer-test", current_period_end=period_end)
        assert updated.id == first.id
        assert updated.plan_key == "coach_starter" and updated.status == "PAST_DUE"
        status_audit = db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_STATUS_CHANGED", resource_id=first.id).one()
        audit_metadata = json.loads(status_audit.metadata_json)
        assert audit_metadata == {
            "provider": "manual_test", "plan_key": "coach_starter",
            "old_plan_key": "coach_pro", "provider_event_id": None,
            "old_status": "ACTIVE", "new_status": "PAST_DUE",
        }
        assert "customer-test" not in status_audit.metadata_json
        subscription_id = updated.id
        db.rollback()
        assert db.query(Subscription).filter_by(id=subscription_id).count() == 0
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_CREATED", resource_id=subscription_id).count() == 0


def test_subscription_upsert_rejects_invalid_values_and_workspace_reassignment():
    with SessionLocal() as db:
        first_coach = _coach(db)
        first_workspace = ensure_default_workspace_for_coach(db, first_coach)
        second_coach = _coach(db)
        second_workspace = ensure_default_workspace_for_coach(db, second_coach)
        with pytest.raises(ValueError, match="subscription"):
            _upsert(db, first_workspace, plan="stripe_pro")
        with pytest.raises(ValueError, match="subscriptions"):
            _upsert(db, first_workspace, plan="coach_beta")
        with pytest.raises(ValueError, match="Unknown subscription status"):
            _upsert(db, first_workspace, status="PENDING")
        with pytest.raises(ValueError, match="boolean"):
            _upsert(db, first_workspace, cancel_at_period_end="false")
        existing = _upsert(db, first_workspace)
        with pytest.raises(ValueError, match="reassigned"):
            upsert_subscription(
                db, workspace_id=second_workspace.id, provider="manual_test",
                provider_subscription_id=f"subscription:{first_workspace.id}",
                plan_key="coach_pro", status="ACTIVE",
            )
        assert db.query(Subscription).filter_by(id=existing.id, workspace_id=first_workspace.id).one()
        db.rollback()


@pytest.mark.parametrize("case", [
    "founder_beats_starter", "pro_beats_beta", "beta_survives_expired_pro",
    "subscription_alone", "no_valid_source",
])
def test_unified_resolver_combines_grants_and_subscriptions_by_plan_precedence(case):
    now = datetime(2026, 9, 27, 12, 0, 0)
    with SessionLocal() as db:
        coach = _coach(db)
        workspace = ensure_default_workspace_for_coach(db, coach)
        if case == "founder_beats_starter":
            grant_workspace_access(db, workspace, "coach_unlimited", no_expiry=True, source="founder", now=now)
            _upsert(db, workspace, plan="coach_starter", now=now)
            expected = "coach_unlimited"
        elif case == "pro_beats_beta":
            grant_workspace_access(db, workspace, "coach_beta", no_expiry=True, source="beta", now=now)
            _upsert(db, workspace, plan="coach_pro", now=now)
            expected = "coach_pro"
        elif case == "beta_survives_expired_pro":
            grant_workspace_access(db, workspace, "coach_beta", no_expiry=True, source="beta", now=now)
            _upsert(db, workspace, plan="coach_pro", status="EXPIRED", now=now)
            expected = "coach_beta"
        elif case == "subscription_alone":
            _upsert(db, workspace, plan="coach_pro", now=now)
            expected = "coach_pro"
        else:
            expired_grant = grant_workspace_access(
                db, workspace, "coach_beta", days=1, source="revoked", now=now - timedelta(days=5),
            )
            expired_grant.revoked_at = now - timedelta(days=1)
            _upsert(db, workspace, plan="coach_pro", status="EXPIRED", now=now)
            expected = None

        result = resolve_workspace_entitlements(db, workspace.id, now=now)
        assert result.active is (expected is not None)
        assert result.plan_key == expected
        if case == "founder_beats_starter":
            assert result.source_type == "grant"
        elif case == "pro_beats_beta" or case == "subscription_alone":
            assert result.source_type == "subscription"
        elif case == "beta_survives_expired_pro":
            assert result.source_type == "grant"
        db.rollback()


def test_subscription_plan_flows_into_capacity_capabilities_and_account_access():
    now = datetime(2026, 9, 27, 12, 0, 0)
    with SessionLocal() as db:
        coach = _coach(db)
        workspace = ensure_default_workspace_for_coach(db, coach)
        sub = _upsert(db, workspace, plan="coach_pro", now=now)
        entitlements = resolve_workspace_entitlements(db, workspace.id, now=now)
        assert entitlements.active and entitlements.plan_key == "coach_pro"
        assert entitlements.max_active_athletes == 25
        assert entitlements.can_program and entitlements.can_use_analytics and entitlements.can_use_integrations
        assert require_programming_access(db, coach).plan_key == "coach_pro"
        assert require_analytics_access(db, coach).plan_key == "coach_pro"
        assert require_integrations_access(db, coach).plan_key == "coach_pro"

        _upsert(db, workspace, plan="coach_starter", now=now)
        starter = resolve_workspace_entitlements(db, workspace.id, now=now)
        assert starter.max_active_athletes == 5 and starter.can_program and starter.can_use_analytics
        assert not starter.can_use_integrations
        with pytest.raises(HTTPException) as denied:
            require_integrations_access(db, coach)
        assert denied.value.detail["code"] == "FEATURE_NOT_INCLUDED"
        _upsert(db, workspace, plan="coach_pro", now=now)

        state = build_account_access_state(db, coach)
        assert state["entitlements"]["maxActiveAthletes"] == 25
        assert state["accessSource"] == {
            "type": "subscription", "status": "ACTIVE",
            "currentPeriodEnd": sub.current_period_end.isoformat(), "cancelAtPeriodEnd": False,
        }
        assert state["grant"] is None
        assert "provider_subscription_id" not in json.dumps(state)
        db.rollback()


def test_cli_test_subscription_is_idempotent_and_show_lists_both_sources(capsys):
    email = f"sim-{uuid.uuid4().hex}@example.com"
    with SessionLocal() as db:
        coach = _coach(db, email=email)
        workspace_id = ensure_default_workspace_for_coach(db, coach).id
        grant_workspace_access(db, db.query(Workspace).filter_by(id=workspace_id).one(),
                               "coach_beta", no_expiry=True, source="beta")
        db.commit()

    command = ["set-test-subscription", email, "--plan", "coach_pro", "--status", "ACTIVE", "--period-days", "30"]
    assert manage_user_main(command) == 0
    assert "Provider: manual_test" in capsys.readouterr().out
    assert manage_user_main(command) == 0
    assert manage_user_main([
        "set-test-subscription", email, "--plan", "coach_starter", "--status", "ACTIVE",
        "--days", "30", "--cancel-at-period-end",
    ]) == 0
    assert "Cancel at period end: yes" in capsys.readouterr().out
    with SessionLocal() as db:
        subscription = db.query(Subscription).filter_by(workspace_id=workspace_id).one()
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_CREATED", resource_id=subscription.id).count() == 1
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_STATUS_CHANGED", resource_id=subscription.id).count() == 0
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_UPDATED", resource_id=subscription.id).count() >= 1

    assert manage_user_main(["show-access", email]) == 0
    shown = capsys.readouterr().out
    assert "Plan: coach_beta" in shown
    assert "Manual grants:" in shown and "coach_beta · beta" in shown
    assert "Subscriptions:" in shown and "manual_test · coach_starter · ACTIVE" in shown
    assert "Source: beta" in shown
    assert manage_user_main(["revoke-coach-access", email]) == 0
    capsys.readouterr()
    with SessionLocal() as db:
        user = db.query(User).filter_by(email=email).one()
        workspace = db.query(Workspace).filter_by(owner_user_id=user.id).one()
        effective = resolve_workspace_entitlements(db, workspace.id)
        assert effective.active and effective.plan_key == "coach_starter"
        assert db.query(Subscription).filter_by(workspace_id=workspace.id).one().status == "ACTIVE"


def test_cli_test_subscription_validation_and_audit_status_transition(capsys):
    email = f"sim-invalid-{uuid.uuid4().hex}@example.com"
    with SessionLocal() as db:
        _coach(db, email=email)
        db.commit()
    assert manage_user_main(["set-test-subscription", email, "--plan", "coach_pro", "--status", "ACTIVE", "--days", "0"]) == 1
    assert "positive" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        manage_user_main(["set-test-subscription", email, "--plan", "coach_pro", "--status", "UNKNOWN", "--days", "1"])
    assert manage_user_main(["set-test-subscription", email, "--plan", "coach_pro", "--status", "ACTIVE", "--days", "30"]) == 0
    capsys.readouterr()
    assert manage_user_main(["set-test-subscription", email, "--plan", "coach_pro", "--status", "PAST_DUE", "--days", "30"]) == 0
    capsys.readouterr()
    with SessionLocal() as db:
        sub = db.query(Subscription).filter(Subscription.provider == "manual_test", Subscription.status == "PAST_DUE").order_by(Subscription.created_at.desc()).first()
        event = db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_STATUS_CHANGED", resource_id=sub.id).one()
        assert json.loads(event.metadata_json)["new_status"] == "PAST_DUE"

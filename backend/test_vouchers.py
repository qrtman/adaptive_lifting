import json
import re
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.database import AccessGrant, AuditEvent, CoachingRelationship, SessionLocal, Subscription, User, Voucher, Workspace
from backend.entitlements import grant_workspace_access, resolve_workspace_entitlements
from backend.main import app
from backend.manage_user import main as manage_user_main
from backend.subscriptions import upsert_subscription
from backend.test_support import register_coach
from backend.vouchers import (
    VoucherInvalid, _generate_code, create_voucher, hash_code,
    inspect_voucher, redeem_voucher,
)
from backend.workspaces import ensure_default_workspace_for_coach


@pytest.fixture(autouse=True)
def voucher_secret(monkeypatch):
    monkeypatch.setenv("VOUCHER_CODE_SECRET", "test-only-stable-voucher-hmac-key-32-bytes")


def _coach():
    user_id = str(uuid.uuid4())
    user = User(id=user_id, email=f"voucher-{uuid.uuid4().hex}@example.com",
                hashed_password="test-only", role="COACH")
    with SessionLocal() as db:
        db.add(user)
        db.commit()
    return user_id


def _issue(user_id, plan="coach_pro", days=90, *, deadline=None, payment_reference=None):
    with SessionLocal() as db:
        user = db.query(User).filter_by(id=user_id).one()
        row, code = create_voucher(db, assigned_user=user, plan_key=plan, duration_days=days,
                                   voucher_expires_at=deadline, payment_reference=payment_reference)
        db.commit()
        return row.id, code


def _redeem(user_id, code, *, now=None):
    with SessionLocal() as db:
        user = db.query(User).filter_by(id=user_id).one()
        row, grant = redeem_voucher(db, code=code, user=user, now=now)
        db.commit()
        return row.id, grant.id


def test_creation_stores_only_keyed_hash_and_validates_product():
    user_id = _coach()
    deadline = datetime.utcnow() + timedelta(days=30)
    row_id, code = _issue(user_id, deadline=deadline, payment_reference="INV-TEST-142")
    assert re.fullmatch(r"VCH-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}", code)
    assert hash_code(code) == hash_code("  " + code.lower() + "  ")
    assert hash_code(code) != hash_code(_generate_code())
    with SessionLocal() as db:
        row = db.query(Voucher).filter_by(id=row_id).one()
        assert row.code_hash == hash_code(code) and code not in str(row.__dict__)
        assert row.code_prefix.startswith("VCH-") and len(row.code_prefix) == 8
        assert row.assigned_user_id == user_id and row.plan_key == "coach_pro"
        assert row.duration_days == 90 and row.expires_at == deadline
        assert row.payment_reference == "INV-TEST-142" and row.source == "offline_payment"
        audit = db.query(AuditEvent).filter_by(event_type="VOUCHER_CREATED", resource_id=row_id).one()
        assert code not in audit.metadata_json
        assert json.loads(audit.metadata_json)["assigned_user_id"] == user_id
        user = db.query(User).filter_by(id=user_id).one()
        for plan, days in (("coach_beta", 90), ("unknown", 90), ("coach_pro", 0), ("coach_pro", -1)):
            with pytest.raises(ValueError):
                create_voucher(db, assigned_user=user, plan_key=plan, duration_days=days)
        assert inspect_voucher(db, code).id == row_id


def test_redemption_is_account_bound_one_time_and_creates_grant():
    owner_id, other_id = _coach(), _coach()
    row_id, code = _issue(owner_id)
    with pytest.raises(VoucherInvalid):
        _redeem(other_id, code)
    _, grant_id = _redeem(owner_id, code)
    with pytest.raises(VoucherInvalid):
        _redeem(owner_id, code)
    with SessionLocal() as db:
        row = db.query(Voucher).filter_by(id=row_id).one()
        grant = db.query(AccessGrant).filter_by(id=grant_id).one()
        assert row.redeemed_at is not None and row.redeemed_by_user_id == owner_id
        assert grant.source == "offline_payment" and grant.reason == f"voucher:{row_id}"
        assert grant.plan_key == "coach_pro" and grant.expires_at - grant.starts_at == timedelta(days=90)
        assert db.query(AccessGrant).filter_by(reason=f"voucher:{row_id}").count() == 1
        assert db.query(AuditEvent).filter_by(event_type="VOUCHER_REDEEMED", resource_id=row_id).count() == 1
        assert resolve_workspace_entitlements(db, grant.workspace_id).plan_key == "coach_pro"
        assert db.query(Subscription).filter_by(workspace_id=grant.workspace_id).count() == 0


def test_invalid_revoked_expired_and_athlete_redemption_are_safe():
    coach_id = _coach()
    row_id, code = _issue(coach_id)
    with SessionLocal() as db:
        row = db.query(Voucher).filter_by(id=row_id).one()
        row.revoked_at = datetime.utcnow()
        db.commit()
    with pytest.raises(VoucherInvalid):
        _redeem(coach_id, code)
    _, expired_code = _issue(coach_id)
    with SessionLocal() as db:
        db.query(Voucher).filter_by(code_hash=hash_code(expired_code)).one().expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    with pytest.raises(VoucherInvalid):
        _redeem(coach_id, expired_code)
    with pytest.raises(VoucherInvalid):
        _redeem(coach_id, _generate_code())
    athlete_id = str(uuid.uuid4())
    athlete = User(id=athlete_id, email=f"athlete-{uuid.uuid4().hex}@example.com",
                   hashed_password="test-only", role="ATHLETE")
    with SessionLocal() as db:
        db.add(athlete)
        db.commit()
    with SessionLocal() as db:
        with pytest.raises(PermissionError, match="VOUCHER_COACH_ACCOUNT_REQUIRED"):
            redeem_voucher(db, code=code, user=db.query(User).filter_by(id=athlete_id).one())


def test_failed_grant_creation_rolls_back_voucher_claim(monkeypatch):
    user_id = _coach()
    row_id, code = _issue(user_id)
    def fail_after_claim(*args, **kwargs):
        raise RuntimeError("grant creation failed")
    monkeypatch.setattr("backend.vouchers.ensure_default_workspace_for_coach", fail_after_claim)
    with SessionLocal() as db:
        user = db.query(User).filter_by(id=user_id).one()
        with pytest.raises(RuntimeError, match="grant creation failed"):
            redeem_voucher(db, code=code, user=user)
        db.rollback()
    with SessionLocal() as db:
        assert db.query(Voucher).filter_by(id=row_id).one().redeemed_at is None
        assert db.query(AccessGrant).filter_by(reason=f"voucher:{row_id}").count() == 0


def test_api_redeems_only_trusted_voucher_fields_and_generic_errors():
    owner = TestClient(app)
    email = f"voucher-api-{uuid.uuid4().hex}@example.com"
    coach = register_coach(owner, email, with_access=False)
    coach_id = coach.json()["user"]["id"]
    _, code = _issue(coach_id, plan="coach_starter", days=30)
    path = "/api/billing/vouchers/redeem"
    assert owner.post(path, json={"code": code, "planKey": "coach_unlimited"}).status_code == 422
    invalid = owner.post(path, json={"code": _generate_code()})
    assert invalid.status_code == 400 and invalid.json()["detail"]["code"] == "VOUCHER_INVALID"
    other = TestClient(app)
    register_coach(other, f"other-{uuid.uuid4().hex}@example.com", with_access=False)
    mismatch = other.post(path, json={"code": code})
    assert mismatch.status_code == 400 and mismatch.json()["detail"]["code"] == "VOUCHER_INVALID"
    redeemed = owner.post(path, json={"code": code})
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json() == {"status": "redeemed", "planKey": "coach_starter", "durationDays": 30}
    replay = owner.post(path, json={"code": code})
    assert replay.status_code == 400 and replay.json()["detail"]["code"] == "VOUCHER_INVALID"
    assert owner.get("/api/account/access").json()["entitlements"]["maxActiveAthletes"] == 5
    athlete = TestClient(app)
    assert athlete.post("/api/auth/register", json={"email": f"athlete-{uuid.uuid4().hex}@example.com", "password": "password123"}).status_code == 200
    denied = athlete.post(path, json={"code": code})
    assert denied.status_code == 403 and denied.json()["detail"]["code"] == "VOUCHER_COACH_ACCOUNT_REQUIRED"


def test_api_masks_revoked_expired_and_wrong_account_the_same():
    client = TestClient(app)
    coach = register_coach(client, f"voucher-mask-{uuid.uuid4().hex}@example.com", with_access=False)
    coach_id = coach.json()["user"]["id"]
    revoked_id, revoked_code = _issue(coach_id)
    expired_id, expired_code = _issue(coach_id)
    with SessionLocal() as db:
        db.query(Voucher).filter_by(id=revoked_id).one().revoked_at = datetime.utcnow()
        db.query(Voucher).filter_by(id=expired_id).one().expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    messages = []
    for code in (revoked_code, expired_code, _generate_code()):
        result = client.post("/api/billing/vouchers/redeem", json={"code": code})
        assert result.status_code == 400
        messages.append(result.json()["detail"])
    assert messages[0] == messages[1] == messages[2]


def test_missing_voucher_secret_fails_closed_without_redeeming(monkeypatch):
    client = TestClient(app)
    coach = register_coach(client, f"voucher-secret-{uuid.uuid4().hex}@example.com", with_access=False)
    voucher_id, code = _issue(coach.json()["user"]["id"])
    monkeypatch.delenv("VOUCHER_CODE_SECRET")
    result = client.post("/api/billing/vouchers/redeem", json={"code": code})
    assert result.status_code == 503 and result.json()["detail"]["code"] == "VOUCHER_UNAVAILABLE"
    with SessionLocal() as db:
        assert db.query(Voucher).filter_by(id=voucher_id).one().redeemed_at is None


def test_api_shared_rate_limit_returns_safe_429(monkeypatch):
    monkeypatch.setenv("VOUCHER_RATE_LIMIT_ENABLED", "true")
    client = TestClient(app)
    coach = register_coach(client, f"voucher-limit-{uuid.uuid4().hex}@example.com", with_access=False)
    voucher_id, code = _issue(coach.json()["user"]["id"])
    path = "/api/billing/vouchers/redeem"
    for _ in range(5):
        result = client.post(path, json={"code": _generate_code()})
        assert result.status_code == 400, result.text
    limited = client.post(path, json={"code": code})
    assert limited.status_code == 429
    assert limited.json()["detail"]["code"] == "VOUCHER_RATE_LIMITED"
    assert code not in str(limited.json())
    with SessionLocal() as db:
        assert db.query(Voucher).filter_by(id=voucher_id).one().redeemed_at is None


def test_same_plan_vouchers_append_from_latest_expiry():
    user_id = _coach()
    now = datetime.utcnow()
    _, first_code = _issue(user_id, days=30)
    _, first_grant_id = _redeem(user_id, first_code, now=now)
    _, second_code = _issue(user_id, days=90)
    _, second_grant_id = _redeem(user_id, second_code, now=now + timedelta(days=1))
    _, third_code = _issue(user_id, days=7)
    _, third_grant_id = _redeem(user_id, third_code, now=now + timedelta(days=2))
    with SessionLocal() as db:
        first, second, third = [db.query(AccessGrant).filter_by(id=grant_id).one()
                                for grant_id in (first_grant_id, second_grant_id, third_grant_id)]
        assert second.starts_at == first.expires_at
        assert third.starts_at == second.expires_at
        assert third.expires_at == now + timedelta(days=127)
        assert resolve_workspace_entitlements(db, first.workspace_id, now=now + timedelta(days=50)).plan_key == "coach_pro"


def test_different_plan_starts_now_and_keeps_original_grant():
    user_id = _coach()
    now = datetime.utcnow()
    _, starter_code = _issue(user_id, plan="coach_starter", days=30)
    _, starter_id = _redeem(user_id, starter_code, now=now)
    _, pro_code = _issue(user_id, plan="coach_pro", days=90)
    _, pro_id = _redeem(user_id, pro_code, now=now + timedelta(days=10))
    with SessionLocal() as db:
        starter = db.query(AccessGrant).filter_by(id=starter_id).one()
        pro = db.query(AccessGrant).filter_by(id=pro_id).one()
        assert starter.expires_at == now + timedelta(days=30)
        assert pro.starts_at == now + timedelta(days=10)
        assert pro.expires_at == now + timedelta(days=100)
        assert resolve_workspace_entitlements(db, pro.workspace_id, now=now + timedelta(days=11)).plan_key == "coach_pro"


def test_operator_create_inspect_revoke_and_show_access(capsys):
    user_id = _coach()
    with SessionLocal() as db:
        email = db.query(User).filter_by(id=user_id).one().email
    assert manage_user_main(["create-voucher", email, "--plan", "coach_pro", "--days", "90",
                             "--voucher-valid-days", "30", "--payment-reference", "INV-TEST-142",
                             "--notes", "operator-only note"]) == 0
    created = capsys.readouterr().out
    code = re.search(r"Code: (VCH-[A-Z2-9-]+)", created).group(1)
    assert "shown only once" in created and "operator-only note" not in created
    assert manage_user_main(["show-voucher", "--code", code]) == 0
    inspected = capsys.readouterr().out
    assert code not in inspected and "INV-TEST-142" in inspected and "Redeemed: no" in inspected
    assert manage_user_main(["revoke-voucher", code]) == 0
    revoked = capsys.readouterr().out
    assert code not in revoked
    with pytest.raises(VoucherInvalid):
        _redeem(user_id, code)
    _, second_code = _issue(user_id)
    _redeem(user_id, second_code)
    assert manage_user_main(["revoke-voucher", second_code]) == 1
    assert "already been redeemed" in capsys.readouterr().err
    assert manage_user_main(["show-access", email]) == 0
    access = capsys.readouterr().out
    assert "Voucher history:" in access and "offline_payment" in access
    assert second_code not in access
    assert manage_user_main(["billing-status", email]) == 0
    diagnostics = capsys.readouterr().out
    assert "Voucher secret fingerprint:" in diagnostics
    assert "Failed Stripe webhook events:" in diagnostics
    assert "Stale CREATING checkouts:" in diagnostics
    assert "test-only-stable-voucher-hmac-key" not in diagnostics


@pytest.mark.parametrize("stripe_plan,stripe_status,voucher_plan,founder_plan,expected", [
    ("coach_starter", "ACTIVE", "coach_pro", None, "coach_pro"),
    ("coach_pro", "ACTIVE", "coach_starter", None, "coach_pro"),
    ("coach_pro", "EXPIRED", "coach_starter", None, "coach_starter"),
    (None, None, "coach_pro", "coach_unlimited", "coach_unlimited"),
])
def test_voucher_and_stripe_or_founder_entitlements_stay_independent(
        monkeypatch, stripe_plan, stripe_status, voucher_plan, founder_plan, expected):
    def forbidden(*args, **kwargs):
        raise AssertionError("voucher redemption must not call Stripe")
    monkeypatch.setattr("stripe.Customer.create", forbidden)
    monkeypatch.setattr("stripe.checkout.Session.create", forbidden)
    user_id = _coach()
    with SessionLocal() as db:
        user = db.query(User).filter_by(id=user_id).one()
        workspace = ensure_default_workspace_for_coach(db, user)
        now = datetime.utcnow()
        if stripe_plan:
            upsert_subscription(db, workspace_id=workspace.id, provider="stripe",
                                provider_subscription_id=f"sub_{uuid.uuid4().hex}",
                                plan_key=stripe_plan, status=stripe_status,
                                current_period_start=now - timedelta(days=30),
                                current_period_end=now + (timedelta(days=30) if stripe_status == "ACTIVE" else -timedelta(days=1)))
        if founder_plan:
            grant_workspace_access(db, workspace, founder_plan, source="founder", no_expiry=True)
        db.commit()
        workspace_id = workspace.id
    _, code = _issue(user_id, plan=voucher_plan)
    _redeem(user_id, code)
    with SessionLocal() as db:
        assert resolve_workspace_entitlements(db, workspace_id).plan_key == expected
        if stripe_plan:
            assert db.query(Subscription).filter_by(workspace_id=workspace_id).one().plan_key == stripe_plan
            assert db.query(Subscription).filter_by(workspace_id=workspace_id).one().status == stripe_status


@pytest.mark.parametrize("plan,limit,integrations", [
    ("coach_starter", 5, False), ("coach_pro", 25, True), ("coach_unlimited", None, True),
])
def test_voucher_plan_flows_to_existing_capacity_and_capabilities(plan, limit, integrations):
    user_id = _coach()
    _, code = _issue(user_id, plan=plan)
    _redeem(user_id, code)
    with SessionLocal() as db:
        workspace_id = db.query(Workspace).filter_by(owner_user_id=user_id).one().id
        effective = resolve_workspace_entitlements(db, workspace_id)
        assert effective.max_active_athletes == limit
        assert effective.can_program and effective.can_use_analytics
        assert effective.can_use_integrations is integrations


def test_voucher_grant_allows_existing_linked_programming_until_expired():
    client = TestClient(app)
    coach = register_coach(client, f"voucher-program-{uuid.uuid4().hex}@example.com", with_access=False)
    coach_id = coach.json()["user"]["id"]
    athlete_id = str(uuid.uuid4())
    with SessionLocal() as db:
        db.add(User(id=athlete_id, email=f"voucher-athlete-{uuid.uuid4().hex}@example.com",
                    hashed_password="test-only", role="ATHLETE"))
        db.flush()
        db.add(CoachingRelationship(coach_id=coach_id, athlete_id=athlete_id))
        db.commit()
    blocked = client.post("/api/sessions", json={"date": "2026-09-27", "title": "Before voucher", "athleteId": athlete_id})
    assert blocked.status_code == 403
    _, code = _issue(coach_id, plan="coach_pro")
    assert client.post("/api/billing/vouchers/redeem", json={"code": code}).status_code == 200
    allowed = client.post("/api/sessions", json={"date": "2026-09-28", "title": "After voucher", "athleteId": athlete_id})
    assert allowed.status_code == 200, allowed.text
    with SessionLocal() as db:
        db.query(AccessGrant).filter(AccessGrant.reason.like("voucher:%"), AccessGrant.workspace_id ==
                                     db.query(Workspace).filter_by(owner_user_id=coach_id).one().id).one().expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    expired = client.post("/api/sessions", json={"date": "2026-09-29", "title": "Expired voucher", "athleteId": athlete_id})
    assert expired.status_code == 403

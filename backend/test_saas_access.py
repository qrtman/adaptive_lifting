import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.database import (
    AccessGrant, CoachingRelationship, InviteCode, SessionLocal, User, Workspace,
)
from backend.entitlements import grant_workspace_access, revoke_workspace_access
from backend.main import app
from backend.test_support import register_coach
from backend.workspaces import ensure_default_workspace_for_coach
from backend.subscriptions import upsert_subscription


def _register_athlete(client, email=None):
    email = email or f"athlete-{uuid.uuid4().hex}@example.com"
    response = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert response.status_code == 200
    return response


def _add_relationships(coach_id, count):
    db = SessionLocal()
    athlete_ids = []
    try:
        for _ in range(count):
            athlete = User(
                id=str(uuid.uuid4()), email=f"capacity-{uuid.uuid4().hex}@example.com",
                hashed_password="test-only", role="ATHLETE",
            )
            db.add(athlete)
            db.flush()
            db.add(CoachingRelationship(coach_id=coach_id, athlete_id=athlete.id))
            athlete_ids.append(athlete.id)
        db.commit()
        return athlete_ids
    finally:
        db.close()


def _set_grant_state(coach_id, state):
    db = SessionLocal()
    try:
        workspace = db.query(Workspace).filter_by(owner_user_id=coach_id).one()
        grant = db.query(AccessGrant).filter_by(workspace_id=workspace.id).one()
        if state == "expired":
            grant.expires_at = datetime.utcnow() - timedelta(seconds=1)
            db.commit()
            return
        if state == "revoked":
            revoke_workspace_access(db, workspace.id)
            db.commit()
            return
        raise AssertionError(state)
    finally:
        db.close()


def _set_subscription_state(coach_id, status, plan="coach_pro"):
    now = datetime.utcnow()
    with SessionLocal() as db:
        coach = db.query(User).filter_by(id=coach_id).one()
        workspace = ensure_default_workspace_for_coach(db, coach)
        upsert_subscription(
            db, workspace_id=workspace.id, provider="manual_test",
            provider_subscription_id=f"phase2:{workspace.id}", plan_key=plan,
            status=status, current_period_start=now - timedelta(days=30) if status == "EXPIRED" else now,
            current_period_end=now + timedelta(days=30) if status != "EXPIRED" else now - timedelta(days=1),
            now=now,
        )
        db.commit()


def _create_session(client, cookies, athlete_id=None):
    return client.post("/api/sessions", json={
        "date": "2026-09-27", "title": "Phase 2 test", "athleteId": athlete_id,
    }, cookies=cookies)


def test_account_access_returns_nulls_for_athlete_without_creating_workspace():
    client = TestClient(app)
    athlete = _register_athlete(client)
    response = client.get("/api/account/access", cookies=athlete.cookies)
    assert response.status_code == 200
    assert response.json() == {
        "workspace": None, "membershipRole": None, "entitlements": None,
        "grant": None, "accessSource": None, "usage": None,
    }
    with SessionLocal() as db:
        assert db.query(Workspace).filter_by(owner_user_id=athlete.json()["user"]["id"]).count() == 0


def test_account_access_reports_beta_grant_and_expired_access_keeps_login_working():
    client = TestClient(app)
    email = f"access-{uuid.uuid4().hex}@example.com"
    coach = register_coach(client, email)
    active = client.get("/api/account/access", cookies=coach.cookies)
    assert active.status_code == 200
    payload = active.json()
    assert payload["workspace"]["name"] == email.split("@", 1)[0] + " Coaching"
    assert payload["membershipRole"] == "OWNER"
    assert payload["entitlements"] == {
        "active": True, "planKey": "coach_beta", "maxActiveAthletes": 20,
        "canProgram": True, "canUseAnalytics": True, "canUseIntegrations": True,
    }
    assert payload["grant"]["source"] == "beta"
    assert payload["grant"]["startsAt"]
    assert payload["grant"]["expiresAt"] is None
    assert payload["usage"] == {"activeAthletes": 0, "maxActiveAthletes": 20}

    _set_grant_state(coach.json()["user"]["id"], "expired")
    logged_in = client.post("/api/auth/login", data={"username": email, "password": "password123"})
    assert logged_in.status_code == 200
    inactive = client.get("/api/account/access", cookies=logged_in.cookies)
    assert inactive.status_code == 200
    assert inactive.json()["entitlements"]["active"] is False
    assert inactive.json()["entitlements"]["planKey"] is None
    assert inactive.json()["grant"] is None


@pytest.mark.parametrize("state", ["none", "expired", "revoked"])
def test_coach_without_active_grant_cannot_mutate_linked_plan(state):
    client = TestClient(app)
    email = f"locked-{state}-{uuid.uuid4().hex}@example.com"
    coach = register_coach(client, email, with_access=(state != "none"))
    coach_id = coach.json()["user"]["id"]
    athlete_id = _add_relationships(coach_id, 1)[0]
    if state == "none":
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=coach_id).one()
            ensure_default_workspace_for_coach(db, user)
            db.commit()
    if state in {"expired", "revoked"}:
        _set_grant_state(coach_id, state)

    response = _create_session(client, coach.cookies, athlete_id)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "WORKSPACE_ACCESS_REQUIRED"


@pytest.mark.parametrize("plan", ["coach_beta", "coach_pro"])
def test_entitled_coach_can_program_linked_athlete(plan):
    client = TestClient(app)
    coach = register_coach(client, f"program-{plan}-{uuid.uuid4().hex}@example.com", plan=plan)
    athlete_id = _add_relationships(coach.json()["user"]["id"], 1)[0]
    response = _create_session(client, coach.cookies, athlete_id)
    assert response.status_code == 200, response.text


def test_paid_subscription_entitlement_allows_linked_mutation_but_not_unrelated_athlete():
    client = TestClient(app)
    coach = register_coach(client, f"paid-program-{uuid.uuid4().hex}@example.com", with_access=False)
    coach_id = coach.json()["user"]["id"]
    _set_subscription_state(coach_id, "ACTIVE")
    linked_id = _add_relationships(coach_id, 1)[0]
    allowed = _create_session(client, coach.cookies, linked_id)
    assert allowed.status_code == 200, allowed.text

    unrelated = _register_athlete(client)
    denied = _create_session(client, coach.cookies, unrelated.json()["user"]["id"])
    assert denied.status_code == 403
    assert "Not linked" in denied.json()["detail"]


def test_expired_paid_subscription_denies_mutation_but_beta_grant_still_grants_access():
    client = TestClient(app)
    coach = register_coach(client, f"expired-paid-{uuid.uuid4().hex}@example.com", with_access=False)
    coach_id = coach.json()["user"]["id"]
    athlete_id = _add_relationships(coach_id, 1)[0]
    _set_subscription_state(coach_id, "EXPIRED")
    access = client.get("/api/account/access", cookies=coach.cookies).json()
    assert access["entitlements"]["active"] is False
    assert access["accessSource"]["type"] == "subscription"
    assert access["accessSource"]["status"] == "EXPIRED"
    expired = _create_session(client, coach.cookies, athlete_id)
    assert expired.status_code == 403
    assert expired.json()["detail"]["code"] == "WORKSPACE_ACCESS_REQUIRED"

    with SessionLocal() as db:
        user = db.query(User).filter_by(id=coach_id).one()
        workspace = db.query(Workspace).filter_by(owner_user_id=coach_id).one()
        grant_workspace_access(db, workspace, "coach_beta", no_expiry=True, source="beta")
        db.commit()
    beta = _create_session(client, coach.cookies, athlete_id)
    assert beta.status_code == 200, beta.text


def test_paid_subscription_flows_to_account_access_and_capacity_limit():
    client = TestClient(app)
    coach = register_coach(client, f"paid-capacity-{uuid.uuid4().hex}@example.com", with_access=False)
    coach_id = coach.json()["user"]["id"]
    _set_subscription_state(coach_id, "ACTIVE", plan="coach_pro")
    state = client.get("/api/account/access", cookies=coach.cookies).json()
    assert state["entitlements"]["planKey"] == "coach_pro"
    assert state["entitlements"]["maxActiveAthletes"] == 25
    assert state["grant"] is None
    assert state["accessSource"]["type"] == "subscription"
    assert state["accessSource"]["status"] == "ACTIVE"

    _add_relationships(coach_id, 25)
    code = client.post("/api/auth/coach-code", cookies=coach.cookies)
    assert code.status_code == 200
    athlete = _register_athlete(client)
    rejected = client.post("/api/auth/link", json={"code": code.json()["code"]}, cookies=athlete.cookies)
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "ATHLETE_LIMIT_REACHED"
    assert rejected.json()["detail"]["maxActiveAthletes"] == 25


def test_athlete_can_program_own_plan_after_coach_grant_expires():
    client = TestClient(app)
    coach = register_coach(client, f"athlete-self-{uuid.uuid4().hex}@example.com")
    _set_grant_state(coach.json()["user"]["id"], "expired")
    athlete = _register_athlete(client)
    response = _create_session(client, athlete.cookies)
    assert response.status_code == 200, response.text


def test_active_entitlement_does_not_bypass_coach_athlete_relationship():
    client = TestClient(app)
    coach = register_coach(client, f"unrelated-{uuid.uuid4().hex}@example.com", plan="coach_unlimited")
    unrelated_athlete = _register_athlete(client)
    response = _create_session(client, coach.cookies, unrelated_athlete.json()["user"]["id"])
    assert response.status_code == 403
    assert "Not linked" in response.json()["detail"]


@pytest.mark.parametrize("plan,count,expected", [
    ("coach_starter", 0, 200), ("coach_starter", 4, 200),
    ("coach_starter", 5, 409), ("coach_starter", 7, 409),
    ("coach_beta", 19, 200), ("coach_beta", 20, 409),
    ("coach_pro", 24, 200), ("coach_pro", 25, 409),
    ("coach_unlimited", 30, 200),
])
def test_link_enforces_plan_capacity(plan, count, expected):
    client = TestClient(app)
    coach = register_coach(client, f"capacity-{plan}-{uuid.uuid4().hex}@example.com", plan=plan)
    _add_relationships(coach.json()["user"]["id"], count)
    code = client.post("/api/auth/coach-code", cookies=coach.cookies)
    assert code.status_code == 200, code.text
    athlete = _register_athlete(client)
    response = client.post("/api/auth/link", json={"code": code.json()["code"]}, cookies=athlete.cookies)
    assert response.status_code == expected, response.text
    if expected == 409:
        detail = response.json()["detail"]
        assert detail["code"] == "ATHLETE_LIMIT_REACHED"
        assert detail["activeAthletes"] == count
        assert detail["maxActiveAthletes"] == {"coach_starter": 5, "coach_beta": 20, "coach_pro": 25}[plan]
        with SessionLocal() as db:
            assert db.query(CoachingRelationship).filter_by(coach_id=coach.json()["user"]["id"], ended_at=None).count() == count


@pytest.mark.parametrize("state", ["expired", "revoked"])
def test_existing_link_remains_and_new_link_is_denied_after_access_loss(state):
    client = TestClient(app)
    coach = register_coach(client, f"retained-{state}-{uuid.uuid4().hex}@example.com")
    coach_id = coach.json()["user"]["id"]
    existing_athlete_id = _add_relationships(coach_id, 1)[0]
    code = client.post("/api/auth/coach-code", cookies=coach.cookies)
    assert code.status_code == 200
    _set_grant_state(coach_id, state)

    new_athlete = _register_athlete(client)
    blocked = client.post("/api/auth/link", json={"code": code.json()["code"]}, cookies=new_athlete.cookies)
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "WORKSPACE_ACCESS_REQUIRED"
    roster = client.get("/api/coach/roster", cookies=coach.cookies)
    assert roster.status_code == 200
    assert [row["id"] for row in roster.json()] == [existing_athlete_id]


def _analytics_query(client, cookies, athlete_id=None):
    return client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["e1rm"], "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "week",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "line",
        },
    }, cookies=cookies)


def test_analytics_access_is_coach_entitlement_plus_existing_relationship():
    client = TestClient(app)
    athlete = _register_athlete(client)
    own = _analytics_query(client, athlete.cookies)
    assert own.status_code == 200, own.text

    coach = register_coach(client, f"analytics-{uuid.uuid4().hex}@example.com")
    coach_id = coach.json()["user"]["id"]
    linked_id = _add_relationships(coach_id, 1)[0]
    assert _analytics_query(client, coach.cookies, linked_id).status_code == 200

    _set_grant_state(coach_id, "revoked")
    denied = _analytics_query(client, coach.cookies, linked_id)
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "WORKSPACE_ACCESS_REQUIRED"

    other = register_coach(client, f"analytics-other-{uuid.uuid4().hex}@example.com")
    unrelated = _analytics_query(client, other.cookies, linked_id)
    assert unrelated.status_code == 403
    assert "Not authorized" in unrelated.json()["detail"]

import uuid

from fastapi.testclient import TestClient

from backend.main import app


def test_register_and_login_set_session_cookie():
    client = TestClient(app)
    email = f"coach-{uuid.uuid4().hex[:10]}@example.com"
    register_response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": "COACH"},
    )
    assert register_response.status_code == 200
    assert "session_id" in register_response.cookies

    login_response = client.post(
        "/api/auth/login",
        data={"username": email, "password": "password123"},
    )
    assert login_response.status_code == 200
    assert "session_id" in login_response.cookies
    assert login_response.cookies.get("session_id")


def test_coach_roster_and_microcycle_isolation():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach_email = f"coach-{suffix}@example.com"
    athlete1_email = f"athlete1-{suffix}@example.com"
    athlete2_email = f"athlete2-{suffix}@example.com"

    coach = client.post(
        "/api/auth/register",
        json={"email": coach_email, "password": "password123", "role": "COACH"},
    )
    assert coach.status_code == 200
    coach_cookies = dict(coach.cookies)

    athlete1 = client.post(
        "/api/auth/register",
        json={"email": athlete1_email, "password": "password123", "role": "ATHLETE"},
    )
    assert athlete1.status_code == 200
    athlete1_cookies = dict(athlete1.cookies)

    athlete2 = client.post(
        "/api/auth/register",
        json={"email": athlete2_email, "password": "password123", "role": "ATHLETE"},
    )
    assert athlete2.status_code == 200

    link = client.post(
        "/api/auth/link-athlete",
        json={"code": coach_email},
        cookies=athlete1_cookies,
    )
    assert link.status_code == 200

    athlete1_mcs = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_mcs.status_code == 200
    athlete1_count = len(athlete1_mcs.json())

    athlete2_mcs = client.get("/api/microcycles", cookies=athlete2.cookies)
    assert athlete2_mcs.status_code == 200

    roster = client.get("/api/coach/roster", cookies=coach_cookies)
    assert roster.status_code == 200
    roster_data = roster.json()
    emails = [row["email"] for row in roster_data]
    assert athlete1_email in emails
    assert athlete2_email not in emails

    coach_mcs = client.get("/api/microcycles", cookies=coach_cookies)
    assert coach_mcs.status_code == 200
    assert len(coach_mcs.json()) == athlete1_count

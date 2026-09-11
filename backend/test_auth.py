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


def test_coach_code_link_unlink_keeps_empty_plan():
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

    code_resp = client.post("/api/auth/coach-code", cookies=coach_cookies)
    assert code_resp.status_code == 200
    coach_code = code_resp.json()["code"]
    assert coach_code

    # Email is no longer a valid link code
    bad = client.post(
        "/api/auth/link-athlete",
        json={"code": coach_email},
        cookies=athlete1_cookies,
    )
    assert bad.status_code == 404

    link = client.post(
        "/api/auth/link-athlete",
        json={"code": coach_code},
        cookies=athlete1_cookies,
    )
    assert link.status_code == 200

    athlete1_mcs = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_mcs.status_code == 200
    assert athlete1_mcs.json() == []

    athlete2_mcs = client.get("/api/microcycles", cookies=athlete2.cookies)
    assert athlete2_mcs.status_code == 200
    assert athlete2_mcs.json() == []

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-11", "title": "Squat day", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=athlete1_cookies,
    )
    assert created.status_code == 200
    session = created.json()
    assert session["blockLabel"] == "Block2"
    assert session["weekLabel"] == "Week3"

    roster = client.get("/api/coach/roster", cookies=coach_cookies)
    assert roster.status_code == 200
    roster_data = roster.json()
    emails = [row["email"] for row in roster_data]
    assert athlete1_email in emails
    assert athlete2_email not in emails

    athlete_id = next(row["id"] for row in roster_data if row["email"] == athlete1_email)
    coach_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    assert coach_mcs.status_code == 200
    assert len(coach_mcs.json()) >= 1

    unlink = client.delete("/api/auth/link", cookies=athlete1_cookies)
    assert unlink.status_code == 200

    roster_after = client.get("/api/coach/roster", cookies=coach_cookies)
    assert athlete1_email not in [row["email"] for row in roster_after.json()]

    # Plan stays in athlete space after unlink
    athlete1_after = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_after.status_code == 200
    assert len(athlete1_after.json()) >= 1


def test_session_labels_anytime_and_reset_stays_empty():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    empty = client.get("/api/microcycles", cookies=cookies)
    assert empty.status_code == 200
    assert empty.json() == []

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Bench"},
        cookies=cookies,
    )
    assert created.status_code == 200
    sid = created.json()["id"]
    assert created.json()["blockLabel"] is None

    labeled = client.patch(
        f"/api/sessions/{sid}",
        json={"blockLabel": "Block1", "weekLabel": "Week1"},
        cookies=cookies,
    )
    assert labeled.status_code == 200
    assert labeled.json()["blockLabel"] == "Block1"
    assert labeled.json()["weekLabel"] == "Week1"

    removed = client.delete(f"/api/sessions/{sid}", cookies=cookies)
    assert removed.status_code == 200

    reset = client.post("/api/reset", cookies=cookies)
    assert reset.status_code == 200
    assert reset.json() == []


def test_copy_week_shifts_dates_and_increments_week_label():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    squat = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    bench = client.post(
        "/api/sessions",
        json={"date": "2026-09-17", "title": "Bench", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200

    copied = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [squat.json()["id"], bench.json()["id"]], "dateOffsetDays": 3},
        cookies=cookies,
    )
    assert copied.status_code == 200
    payload = copied.json()
    assert payload["status"] == "success"
    assert len(payload["copied"]) == 2
    dates = sorted(row["date"] for row in payload["copied"])
    assert dates == ["2026-09-18", "2026-09-20"]
    assert all(row["blockLabel"] == "Block2" for row in payload["copied"])
    assert all(row["weekLabel"] == "Week4" for row in payload["copied"])

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    assert len(workouts) == 4

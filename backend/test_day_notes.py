import uuid

from fastapi.testclient import TestClient

from backend.main import app


def _register(client, email, role):
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": role},
    )
    assert resp.status_code == 200
    return dict(resp.cookies)


def test_day_notes_keyed_by_date_and_athlete_plan():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = _register(client, f"ath-{suffix}@example.com", "ATHLETE")
    other = _register(client, f"oth-{suffix}@example.com", "ATHLETE")
    coach = _register(client, f"coach-{suffix}@example.com", "COACH")

    missing_date = client.put(
        "/api/day-notes",
        json={"date": "09-01-2026", "body": "Deload"},
        cookies=athlete,
    )
    assert missing_date.status_code == 400
    assert missing_date.json()["detail"] == "date must be YYYY-MM-DD"

    saved = client.put(
        "/api/day-notes",
        json={"date": "2026-09-01", "body": "  Deload — keep SQ light  "},
        cookies=athlete,
    )
    assert saved.status_code == 200
    payload = saved.json()
    assert payload["date"] == "2026-09-01"
    assert payload["body"] == "Deload — keep SQ light"

    listed = client.get("/api/day-notes", cookies=athlete)
    assert listed.status_code == 200
    notes = listed.json()["notes"]
    assert len(notes) == 1
    assert notes[0]["date"] == "2026-09-01"
    assert notes[0]["body"] == "Deload — keep SQ light"

    other_list = client.get("/api/day-notes", cookies=other)
    assert other_list.status_code == 200
    assert other_list.json()["notes"] == []

    hijack = client.get(
        f"/api/day-notes?athlete_id={payload['ownerId']}",
        cookies=other,
    )
    assert hijack.status_code == 403
    hijack_put = client.put(
        "/api/day-notes",
        json={"date": "2026-09-01", "body": "Nope", "athleteId": payload["ownerId"]},
        cookies=other,
    )
    assert hijack_put.status_code == 403

    coach_missing = client.get("/api/day-notes", cookies=coach)
    assert coach_missing.status_code == 400

    code = client.post("/api/auth/coach-code", cookies=coach).json()["code"]
    link = client.post("/api/auth/link", json={"code": code}, cookies=athlete)
    assert link.status_code == 200

    roster = client.get("/api/coach/roster", cookies=coach)
    athlete_id = next(row["id"] for row in roster.json())

    coach_list = client.get(f"/api/day-notes?athlete_id={athlete_id}", cookies=coach)
    assert coach_list.status_code == 200
    assert coach_list.json()["notes"][0]["body"] == "Deload — keep SQ light"

    coach_write = client.put(
        "/api/day-notes",
        json={"date": "2026-09-01", "body": "Coach tweak", "athleteId": athlete_id},
        cookies=coach,
    )
    assert coach_write.status_code == 200
    assert coach_write.json()["body"] == "Coach tweak"

    cleared = client.put(
        "/api/day-notes",
        json={"date": "2026-09-01", "body": "   ", "athleteId": athlete_id},
        cookies=coach,
    )
    assert cleared.status_code == 200
    assert cleared.json()["body"] is None

    after_clear = client.get("/api/day-notes", cookies=athlete)
    assert after_clear.json()["notes"] == []

    restored = client.put(
        "/api/day-notes",
        json={"date": "2026-09-01", "body": "Back"},
        cookies=athlete,
    )
    assert restored.status_code == 200
    assert restored.json()["body"] == "Back"

    unlink = client.delete("/api/auth/link", cookies=athlete)
    assert unlink.status_code == 200
    lost = client.get(f"/api/day-notes?athlete_id={athlete_id}", cookies=coach)
    assert lost.status_code == 403
    stays = client.get("/api/day-notes", cookies=athlete)
    assert stays.json()["notes"][0]["body"] == "Back"

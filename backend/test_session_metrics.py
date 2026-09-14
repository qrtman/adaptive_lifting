"""Per-set e1RM and per-session summary against canonical math_utils."""

import uuid

from fastapi.testclient import TestClient

from backend.database import Exercise, ExerciseSet, Microcycle, SessionLocal, Workout, init_db
from backend.main import app
from backend.math_utils import set_preview_metrics
from backend.session_metrics import metrics_for_set, summary_for_workout


def _auth_athlete():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"sum-{suffix}@ex.com", "password": "password123", "role": "ATHLETE"},
    )
    return client, dict(athlete.cookies), athlete.json()["id"]


def _seed(athlete_id: str, with_log: bool = True) -> str:
    init_db()
    db = SessionLocal()
    try:
        mc = Microcycle(id=f"mc-{athlete_id}", weekName="W1", focus="test", status="ACTIVE", owner_id=athlete_id)
        db.add(mc)
        db.flush()
        wid = f"w-{athlete_id}"
        db.add(Workout(
            id=wid, date="2026-09-14", dayLabel="D1", title="SQ",
            tonnage=500.0, delta=0, color="gray", status="COMPLETED",
            microcycle_id=mc.id, owner_id=athlete_id, notes="session note",
        ))
        eid = f"e-{athlete_id}"
        db.add(Exercise(
            id=eid, title="Squat", variation="Competition", tier="Comp",
            lift_category="Squat", movement_pattern="Knee Dominant",
            workout_id=wid, lexo_rank="a0",
        ))
        db.add(ExerciseSet(
            id=f"s-{athlete_id}", label="Top",
            actual=100 if with_log else None,
            reps=5 if with_log else None,
            executedRpe=8.0 if with_log else None,
            plannedWeight=100, plannedReps=5, plannedRpe=8.0,
            exercise_id=eid, lexo_rank="a0",
        ))
        db.commit()
        return wid
    finally:
        db.close()


def test_set_metrics_match_math_utils():
    init_db()
    db = SessionLocal()
    try:
        s = ExerciseSet(plannedWeight=100, plannedReps=5, plannedRpe=8.0, actual=100, reps=5, executedRpe=8.0)
        expected = set_preview_metrics(100, 5, 8.0)
        got = metrics_for_set(s)
        assert got["e1rm"] == expected["e1rm"]
        assert got["intensity_pct"] == expected["intensity_pct"]
        assert got["inol"] == expected["inol"]
    finally:
        db.close()


def test_session_summary_and_notes_endpoint():
    client, cookies, athlete_id = _auth_athlete()
    wid = _seed(athlete_id)
    expected = set_preview_metrics(100, 5, 8.0)
    resp = client.get(f"/api/sessions/{wid}/summary", cookies=cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["notes"] == "session note"
    assert body["summary"]["setCount"] == 1
    assert body["summary"]["tonnage"] == 500.0
    assert body["summary"]["inol"] == expected["inol"]
    assert body["exercises"][0]["sets"][0]["e1rm"] == expected["e1rm"]
    assert body["exercises"][0]["sets"][0]["e1rmSource"] == "server"
    assert body["mathVersion"]

    patch = client.patch(f"/api/sessions/{wid}", json={"notes": "updated"}, cookies=cookies)
    assert patch.status_code == 200
    assert patch.json()["notes"] == "updated"


def test_unlinked_coach_cannot_read_summary():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = client.post("/api/auth/register", json={"email": f"c-{suffix}@ex.com", "password": "password123", "role": "COACH"})
    athlete = client.post("/api/auth/register", json={"email": f"a-{suffix}@ex.com", "password": "password123", "role": "ATHLETE"})
    athlete_id = athlete.json()["id"]
    wid = _seed(athlete_id)
    resp = client.get(f"/api/sessions/{wid}/summary", cookies=dict(coach.cookies))
    assert resp.status_code == 403


def test_replace_sets_emits_workout_synced_event():
    from backend.database import DomainEvent

    client, cookies, athlete_id = _auth_athlete()
    wid = _seed(athlete_id)
    eid = f"e-{athlete_id}"
    res = client.put(
        f"/api/sessions/{wid}/exercises/{eid}/sets",
        json={"sets": [{
            "id": f"s-{athlete_id}",
            "label": "Top",
            "plannedWeight": 110,
            "plannedReps": 5,
            "plannedRpe": 8.0,
            "actual": 110,
            "reps": 5,
            "executedRpe": 8.5,
        }]},
        cookies=cookies,
    )
    assert res.status_code == 200, res.text
    db = SessionLocal()
    try:
        events = db.query(DomainEvent).filter(DomainEvent.workout_id == wid).all()
        assert any(item.event_type == "WORKOUT_SYNCED" for item in events)
        assert any("actor_user_id" in (item.payload_json or "") for item in events)
    finally:
        db.close()


def test_unlinked_coach_cannot_open_athlete_live_stream():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = client.post("/api/auth/register", json={"email": f"c2-{suffix}@ex.com", "password": "password123", "role": "COACH"})
    athlete = client.post("/api/auth/register", json={"email": f"a2-{suffix}@ex.com", "password": "password123", "role": "ATHLETE"})
    athlete_id = athlete.json()["id"]
    blocked = client.get(f"/api/athletes/{athlete_id}/live", cookies=dict(coach.cookies))
    assert blocked.status_code == 403

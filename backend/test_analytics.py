import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from backend.analytics_registry import validate_config
from backend.analytics_schemas import CardConfig
from backend.database import Exercise, ExerciseSet, Microcycle, SessionLocal, Workout, init_db
from backend.main import app
from backend.math_utils import calculate_e1rm


def _auth_pair():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = client.post("/api/auth/register", json={"email": f"c-{suffix}@ex.com", "password": "password123", "role": "COACH"})
    athlete = client.post("/api/auth/register", json={"email": f"a-{suffix}@ex.com", "password": "password123", "role": "ATHLETE"})
    code = client.post("/api/auth/coach-code", cookies=dict(coach.cookies)).json()["code"]
    client.post("/api/auth/link-athlete", json={"code": code}, cookies=dict(athlete.cookies))
    return client, dict(coach.cookies), dict(athlete.cookies), athlete.json()["id"]


def _seed_sets(athlete_id: str):
    init_db()
    db = SessionLocal()
    try:
        mc = Microcycle(id=f"mc-{athlete_id}", weekName="W1", focus="test", status="ACTIVE", owner_id=athlete_id)
        db.add(mc)
        db.flush()
        start = date(2026, 9, 1)
        for i in range(4):
            day = start + timedelta(days=i * 2)
            wid = f"w-{athlete_id}-{i}"
            db.add(Workout(
                id=wid, date=day.isoformat(), dayLabel=f"D{i+1}", title="SQ",
                tonnage=0, delta=0, color="gray", status="COMPLETED", microcycle_id=mc.id,
            ))
            eid = f"e-{athlete_id}-{i}"
            db.add(Exercise(
                id=eid, title="Squat", variation="Competition", tier="Comp",
                lift_category="Squat", workout_id=wid, lexo_rank="a0",
            ))
            db.add(ExerciseSet(
                id=f"s-{athlete_id}-{i}", label="Top",
                actual=100 + i * 2.5, reps=5, executedRpe=8,
                plannedWeight=100, plannedReps=5, plannedRpe=8,
                exercise_id=eid, lexo_rank="a0",
            ))
        db.commit()
    finally:
        db.close()


def test_incompatible_e1rm_set_count():
    cfg = CardConfig.model_validate({
        "metrics": ["e1rm", "set_count"],
        "scopes": [{"kind": "all", "ids": []}],
        "time_grain": "week",
        "range": {"n": 4, "grain": "week"},
        "visualization": "line",
    })
    reasons = validate_config(cfg)
    assert any("set_count" in r for r in reasons)


def test_acwr_requires_week():
    cfg = CardConfig.model_validate({
        "metrics": ["acwr"],
        "scopes": [{"kind": "all", "ids": []}],
        "time_grain": "block",
        "range": {"n": 4, "grain": "week"},
        "visualization": "line",
    })
    assert any("week grain" in r for r in validate_config(cfg))


def test_metrics_match_canonical_math_and_rbac():
    client, coach_cookies, athlete_cookies, athlete_id = _auth_pair()
    _seed_sets(athlete_id)

    denied = TestClient(app).post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["e1rm"],
            "scopes": [{"kind": "movement", "ids": ["Squat"]}],
            "time_grain": "week",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "line",
        },
    })
    assert denied.status_code == 401

    ok = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["e1rm"],
            "scopes": [{"kind": "movement", "ids": ["Squat"]}],
            "time_grain": "week",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "line",
        },
    }, cookies=coach_cookies)
    assert ok.status_code == 200, ok.text
    payload = ok.json()
    assert payload["math_version"] == "linear-decay-v1"
    expected_all = [calculate_e1rm(100 + i * 2.5, 5, 8.0) for i in range(4)]
    points = payload["series"][0]["points"]
    assert any(
        p is not None and any(abs(p - e) < 0.15 for e in expected_all)
        for p in points
    )

    stranger = client.post("/api/auth/register", json={
        "email": f"x-{uuid.uuid4().hex[:6]}@ex.com", "password": "password123", "role": "ATHLETE",
    })
    blocked = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["tonnage"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "week",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "bar",
        },
    }, cookies=dict(stranger.cookies))
    assert blocked.status_code == 403

    pattern = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["set_count"],
            "scopes": [{"kind": "pattern", "ids": ["Knee Dominant"]}],
            "time_grain": "week",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "weekday_matrix",
        },
    }, cookies=athlete_cookies)
    assert pattern.status_code == 200
    matrix = pattern.json()["matrix"]
    assert "cols" in matrix and matrix["cols"] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    assert "Knee Dominant" in matrix["rows"]


def test_period_alignment_unequal_lengths():
    client, coach_cookies, _athlete_cookies, athlete_id = _auth_pair()
    _seed_sets(athlete_id)
    res = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["tonnage"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "day",
            "range": {"start": "2026-09-01", "end": "2026-09-10"},
            "visualization": "line",
            "comparison": {
                "kind": "period_vs_period",
                "secondary": {"explicit": {"start": "2026-09-01", "end": "2026-09-04"}},
            },
        },
    }, cookies=coach_cookies)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["truncated_to"] is not None
    lengths = {len(s["points"]) for s in body["series"]}
    assert len(lengths) == 1


def test_spacing_series_and_presets():
    client, coach_cookies, _athlete_cookies, athlete_id = _auth_pair()
    _seed_sets(athlete_id)
    res = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["session_spacing", "e1rm"],
            "scopes": [{"kind": "pattern", "ids": ["Knee Dominant"]}],
            "time_grain": "week",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "line",
        },
    }, cookies=coach_cookies)
    assert res.status_code == 200, res.text
    body = res.json()
    assert any(s["metric"] == "session_spacing" for s in body["series"])
    assert body.get("table")

    cards = client.get("/api/insight-cards", cookies=coach_cookies)
    assert cards.status_code == 200
    names = {c["name"] for c in cards.json()}
    assert "Competition lifts" in names
    assert "Weekly load heatmap" in names
    assert "Average intensity by week" in names
    assert "Pattern recruitment by weekday" in names
    assert "Spacing vs e1RM" in names
    assert "Block vs previous block" in names


def test_heatmap_and_empty_and_overlapping_periods():
    client, coach_cookies, _athlete_cookies, athlete_id = _auth_pair()
    _seed_sets(athlete_id)

    heat = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["tonnage"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "day",
            "range": {"start": "2026-09-01", "end": "2026-09-30"},
            "visualization": "heatmap",
        },
    }, cookies=coach_cookies)
    assert heat.status_code == 200, heat.text
    matrix = heat.json()["matrix"]
    assert matrix["rows"]
    assert matrix["cols"]

    overlap = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["tonnage"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "day",
            "range": {"start": "2026-09-01", "end": "2026-09-10"},
            "visualization": "line",
            "comparison": {
                "kind": "period_vs_period",
                "secondary": {"explicit": {"start": "2026-09-05", "end": "2026-09-12"}},
            },
        },
    }, cookies=coach_cookies)
    assert overlap.status_code == 200, overlap.text
    assert overlap.json()["truncated_to"] is not None

    empty = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["tonnage"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "day",
            "range": {"start": "2026-09-01", "end": "2026-09-10"},
            "visualization": "line",
            "comparison": {
                "kind": "period_vs_period",
                "secondary": {"explicit": {"start": "2025-01-01", "end": "2025-01-10"}},
            },
        },
    }, cookies=coach_cookies)
    assert empty.status_code == 200, empty.text
    assert empty.json()["truncated_to"] == 0 or all(
        all(p is None or p == 0 for p in s["points"]) for s in empty.json()["series"] if s["id"].endswith(":prev")
    )

    bad = client.post("/api/analytics/query", json={
        "athlete_id": athlete_id,
        "config": {
            "metrics": ["acwr"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "day",
            "range": {"n": 4, "grain": "week"},
            "visualization": "line",
        },
    }, cookies=coach_cookies)
    assert bad.status_code == 422

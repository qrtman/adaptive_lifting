import uuid

from fastapi.testclient import TestClient

from backend.database import Exercise, ExerciseSet, Microcycle, SessionLocal, Workout
from backend.main import app


def _register(client: TestClient, role: str) -> tuple[dict, str]:
    email = f"{role.lower()}-{uuid.uuid4().hex[:10]}@example.com"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": role},
    )
    assert response.status_code == 200
    return dict(response.cookies), email


def _plant_week(owner_id: str, week_id: str | None = None) -> str:
    week_id = week_id or f"mc-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        micro = Microcycle(
            id=week_id,
            weekName="Week 1",
            focus="Base",
            status="ACTIVE",
            active=True,
            owner_id=owner_id,
            startDate="2026-08-31",
            endDate="2026-09-06",
        )
        db.add(micro)
        db.flush()
        workout = Workout(
            id=f"{week_id}-d1",
            date="2026-09-01",
            dayLabel="D1",
            title="Squat",
            tonnage=0,
            delta=0,
            color="mac-blue",
            status="PLANNED",
            microcycle_id=micro.id,
        )
        db.add(workout)
        db.flush()
        exercise = Exercise(
            id=f"{week_id}-d1-e1",
            title="Squat",
            variation="Low bar",
            tags_raw="Squat",
            workout_id=workout.id,
        )
        db.add(exercise)
        db.flush()
        db.add(ExerciseSet(
            id=f"{week_id}-d1-e1-s1",
            label="Top",
            plannedWeight=200,
            plannedReps=1,
            plannedRpe=8,
            isTop=True,
            actual=205,
            reps=1,
            executedRpe=9,
            exercise_id=exercise.id,
        ))
        db.commit()
        return week_id
    finally:
        db.close()


def test_new_athlete_gets_an_empty_plan_not_a_demo_tree():
    client = TestClient(app)
    cookies, _email = _register(client, "ATHLETE")
    response = client.get("/api/microcycles", cookies=cookies)
    assert response.status_code == 200
    assert response.json() == []


def test_reset_does_not_replant_a_demo_tree():
    client = TestClient(app)
    cookies, email = _register(client, "ATHLETE")
    db = SessionLocal()
    try:
        from backend.database import User
        user = db.query(User).filter(User.email == email).first()
        user_id = user.id
    finally:
        db.close()
    week_id = _plant_week(user_id)
    listed = client.get("/api/microcycles", cookies=cookies)
    assert any(row["id"] == week_id for row in listed.json())
    reset = client.post("/api/reset", cookies=cookies)
    assert reset.status_code == 200
    assert reset.json() == []


def test_coach_can_edit_bounds_and_copy_an_athlete_week():
    client = TestClient(app)
    coach_cookies, coach_email = _register(client, "COACH")
    athlete_cookies, _athlete_email = _register(client, "ATHLETE")
    link = client.post("/api/auth/link-athlete", json={"code": coach_email}, cookies=athlete_cookies)
    assert link.status_code == 200
    db = SessionLocal()
    try:
        from backend.database import User
        athlete = db.query(User).filter(User.email == _athlete_email).first()
        athlete_id = athlete.id
    finally:
        db.close()
    week_id = _plant_week(athlete_id)

    widened = client.patch(
        f"/api/microcycles/{week_id}/bounds",
        json={"startDate": "2026-08-31", "endDate": "2026-09-20"},
        cookies=coach_cookies,
    )
    assert widened.status_code == 200
    assert widened.json()["endDate"] == "2026-09-20"

    copied = client.post(f"/api/microcycles/{week_id}/copy", cookies=coach_cookies)
    assert copied.status_code == 200
    body = copied.json()
    assert body["weekName"] == "Week 1 copy"
    assert body["id"] != week_id
    assert body["workouts"][0]["id"] != f"{week_id}-d1"
    assert body["workouts"][0]["exercises"][0]["sets"][0]["actual"] is None

    stranger_cookies, _ = _register(client, "ATHLETE")
    denied = client.patch(
        f"/api/microcycles/{week_id}/bounds",
        json={"startDate": "2026-08-31", "endDate": "2026-09-21"},
        cookies=stranger_cookies,
    )
    assert denied.status_code == 403

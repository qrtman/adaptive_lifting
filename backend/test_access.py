import uuid

from fastapi.testclient import TestClient

from backend.database import SessionLocal, User
from backend.main import app
from backend.test_microcycles import _plant_week, _register


def _user_id(email: str) -> str:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.email == email).first().id
    finally:
        db.close()


def test_logout_revokes_the_session_cookie():
    client = TestClient(app)
    cookies, _email = _register(client, "ATHLETE")
    assert client.get("/api/microcycles", cookies=cookies).status_code == 200
    logout = client.post("/api/auth/logout", cookies=cookies)
    assert logout.status_code == 200
    denied = client.get("/api/microcycles", cookies=cookies)
    assert denied.status_code == 401
    body = denied.json()
    assert body["detail"]["error"]["code"] == "SESSION_INVALID"


def test_stranger_cannot_log_another_athletes_set():
    client = TestClient(app)
    owner_cookies, owner_email = _register(client, "ATHLETE")
    stranger_cookies, _ = _register(client, "ATHLETE")
    week_id = _plant_week(_user_id(owner_email))
    payload = {
        "workoutId": f"{week_id}-d1",
        "exerciseId": f"{week_id}-d1-e1",
        "setId": f"{week_id}-d1-e1-s1",
        "weight": 210,
        "reps": 1,
        "rpe": 9,
    }
    denied = client.post("/api/sets/log", json=payload, cookies=stranger_cookies)
    assert denied.status_code == 403
    allowed = client.post("/api/sets/log", json=payload, cookies=owner_cookies)
    assert allowed.status_code == 200


def test_stranger_cannot_sync_or_stream_another_athletes_workout():
    client = TestClient(app)
    owner_cookies, owner_email = _register(client, "ATHLETE")
    stranger_cookies, _ = _register(client, "ATHLETE")
    week_id = _plant_week(_user_id(owner_email))
    workout_id = f"{week_id}-d1"
    set_id = f"{week_id}-d1-e1-s1"

    live = client.get(f"/api/workouts/{workout_id}/live", cookies=stranger_cookies)
    assert live.status_code == 403

    unauth = TestClient(app).get(f"/api/workouts/{workout_id}/live")
    assert unauth.status_code == 401

    sync_body = {
        "schema_version": 1,
        "client_device_id": f"dev-{uuid.uuid4().hex[:8]}",
        "workout_id": workout_id,
        "last_updated_at": "2026-09-09T00:00:00Z",
        "changes": [{
            "entity": "ExerciseSet",
            "id": set_id,
            "mutation_id": f"mut-{uuid.uuid4().hex[:8]}",
            "updated_at": "2026-09-09T00:00:00Z",
            "fields": {"actual": 210, "reps": 1, "executedRpe": 9},
        }],
    }
    denied = client.post(f"/api/workouts/{workout_id}/sync", json=sync_body, cookies=stranger_cookies)
    assert denied.status_code == 403

    allowed = client.post(f"/api/workouts/{workout_id}/sync", json=sync_body, cookies=owner_cookies)
    assert allowed.status_code == 200
    assert sync_body["changes"][0]["mutation_id"] in allowed.json()["accepted_mutation_ids"]


def test_athlete_sync_cannot_rewrite_prescription_fields():
    client = TestClient(app)
    cookies, email = _register(client, "ATHLETE")
    week_id = _plant_week(_user_id(email))
    workout_id = f"{week_id}-d1"
    set_id = f"{week_id}-d1-e1-s1"
    mutation_id = f"mut-{uuid.uuid4().hex[:8]}"
    response = client.post(
        f"/api/workouts/{workout_id}/sync",
        json={
            "schema_version": 1,
            "client_device_id": f"dev-{uuid.uuid4().hex[:8]}",
            "workout_id": workout_id,
            "last_updated_at": "2026-09-09T00:00:00Z",
            "changes": [{
                "entity": "ExerciseSet",
                "id": set_id,
                "mutation_id": mutation_id,
                "updated_at": "2026-09-09T00:00:00Z",
                "fields": {"plannedWeight": 500},
            }],
        },
        cookies=cookies,
    )
    assert response.status_code == 200
    body = response.json()
    assert mutation_id in body["rejected_mutations"]
    assert any(row["reason"] == "PRESCRIPTION_FORBIDDEN" for row in body["conflicts"])

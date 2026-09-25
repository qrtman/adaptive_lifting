from datetime import datetime, timedelta
import uuid

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import main
from backend.database import Exercise, ExerciseSet, SessionLocal, Workout
from backend.request_security import install_request_security
from backend.runtime_config import load_jwt_secrets


def test_production_rejects_weak_previous_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_CURRENT", "strong-current-key-" + uuid.uuid4().hex)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "secret")
    with pytest.raises(RuntimeError, match="JWT_SECRET_PREVIOUS"):
        load_jwt_secrets()


def test_key_rotation_preserves_sessions_and_removing_key_revokes_them(monkeypatch):
    client = TestClient(main.app)
    response = client.post("/api/auth/register", json={"email": f"rotate-{uuid.uuid4().hex}@example.com", "password": "password123", "role": "ATHLETE"})
    old_token = response.json()["access_token"]
    old_key = main.SECRET_KEY
    monkeypatch.setattr(main, "SECRET_KEY", uuid.uuid4().hex)
    monkeypatch.setattr(main, "JWT_SECRET_PREVIOUS", old_key)
    assert client.get("/api/security/sessions").status_code == 200
    expired = jwt.encode({"sub": response.json()["user"]["id"], "exp": datetime.utcnow() - timedelta(seconds=1)}, old_key, algorithm="HS256")
    with pytest.raises(jwt.ExpiredSignatureError):
        main.decode_access_token(expired)
    monkeypatch.setattr(main, "JWT_SECRET_PREVIOUS", None)
    with pytest.raises(jwt.InvalidSignatureError):
        main.decode_access_token(old_token)
    assert client.get("/api/security/sessions").status_code == 401


def test_sync_cannot_reassign_ownership_or_parent_or_delete_relationships():
    client = TestClient(main.app)
    owner = client.post("/api/auth/register", json={"email": f"sync-{uuid.uuid4().hex}@example.com", "password": "password123", "role": "ATHLETE"}).json()["user"]["id"]
    workout = client.post("/api/sessions", json={"date": "2026-09-26", "title": "Keep"}).json()
    exercise = client.post(f"/api/sessions/{workout['id']}/exercises", json={"title": "Squat", "liftCategory": "Squat"}).json()
    set_id = exercise["sets"][0]["id"]
    attacks = [
        ("Workout", workout["id"], {"owner_id": "victim"}),
        ("Workout", workout["id"], {"exercises": []}),
        ("Workout", workout["id"], {"microcycle_id": "victim-week"}),
        ("Exercise", exercise["id"], {"workout_id": "victim-workout"}),
        ("ExerciseSet", set_id, {"exercise_id": "victim-exercise"}),
        ("ExerciseSet", set_id, {"id": "replacement-id"}),
    ]
    changes = [{"entity": entity, "id": row_id, "mutation_id": uuid.uuid4().hex, "updated_at": datetime.utcnow().isoformat() + "Z", "fields": fields} for entity, row_id, fields in attacks]
    response = client.post(f"/api/workouts/{workout['id']}/sync", json={"schema_version": 1, "client_device_id": uuid.uuid4().hex, "workout_id": workout["id"], "last_updated_at": datetime.utcnow().isoformat() + "Z", "changes": changes})
    assert response.status_code == 200
    assert response.json()["accepted_mutation_ids"] == []
    assert len(response.json()["rejected_mutations"]) == len(attacks)
    with SessionLocal() as db:
        assert db.get(Workout, workout["id"]).owner_id == owner
        assert db.get(Exercise, exercise["id"]).workout_id == workout["id"]
        assert db.get(ExerciseSet, set_id).exercise_id == exercise["id"]


def test_production_origin_guard_and_auth_throttle(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    app = FastAPI()
    install_request_security(app, ["https://lift.example.com"])

    @app.post("/api/auth/login")
    def login():
        return {"ok": True}

    client = TestClient(app)
    assert client.post("/api/auth/login", headers={"Origin": "https://evil.example.com"}).status_code == 403
    client.cookies.set("session_id", "cookie")
    assert client.post("/api/auth/login").status_code == 403
    for _ in range(20):
        assert client.post("/api/auth/login", headers={"Origin": "https://lift.example.com"}).status_code == 200
    response = client.post("/api/auth/login", headers={"Origin": "https://lift.example.com"})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_production_disabled_integrations_fail_closed(monkeypatch):
    from backend import integrations
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(integrations, "TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setattr(integrations, "TELEGRAM_WEBHOOK_SECRET", "")
    client = TestClient(main.app)
    assert client.post("/api/integrations/telegram/webhook", json={"update_id": 123}, headers={"X-Telegram-Bot-Api-Secret-Token": ""}).status_code == 503

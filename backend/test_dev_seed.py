from fastapi.testclient import TestClient

from backend.database import CoachingRelationship, SessionLocal, User
from backend.dev_seed import DEMO_ATHLETE_EMAIL, DEMO_COACH_EMAIL
from backend.main import app


def test_development_login_creates_linked_demo_accounts(monkeypatch):
    monkeypatch.setenv("DEV_LOGIN_ENABLED", "true")
    client = TestClient(app)

    coach_login = client.post("/api/dev/login/coach")
    athlete_login = client.post("/api/dev/login/athlete")

    assert coach_login.status_code == 200
    assert athlete_login.status_code == 200
    assert coach_login.json()["user"]["email"] == DEMO_COACH_EMAIL
    assert athlete_login.json()["user"]["email"] == DEMO_ATHLETE_EMAIL

    db = SessionLocal()
    try:
        coach = db.query(User).filter(User.email == DEMO_COACH_EMAIL).one()
        athlete = db.query(User).filter(User.email == DEMO_ATHLETE_EMAIL).one()
        assert db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == coach.id,
            CoachingRelationship.athlete_id == athlete.id,
        ).one()
    finally:
        db.close()


def test_development_login_requires_explicit_flag(monkeypatch):
    monkeypatch.setenv("DEV_LOGIN_ENABLED", "false")
    response = TestClient(app).post("/api/dev/login/coach")
    assert response.status_code == 404

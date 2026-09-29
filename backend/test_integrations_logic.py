import hmac
import hashlib
import json
import urllib.parse
import time
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlparse, parse_qs

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from backend.database import Base, CoachingRelationship, IntegrationOutbox, OAuthState, User, IntegrationConnection
from backend.entitlements import grant_workspace_access
from backend.workspaces import ensure_default_workspace_for_coach
from backend.integrations import encrypt_data, decrypt_data, verify_telegram_init_data, INTEGRATION_ENCRYPTION_KEY
from backend import integrations
from backend.main import app


def test_credentials_encryption_roundtrip():
    token = "google_refresh_token_abc123_xyz789"
    encrypted = encrypt_data(token, INTEGRATION_ENCRYPTION_KEY)
    assert decrypt_data(encrypted, INTEGRATION_ENCRYPTION_KEY) == token


def _signed_init_data(bot_token: str, params: dict) -> str:
    sorted_params = sorted(params.items())
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_params)
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    params = dict(params)
    params["hash"] = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(params)


def _params(**overrides):
    params = {
        "auth_date": str(int(time.time())),
        "query_id": "AAHdFtQxAAAAAN0G1DE",
        "user": json.dumps({"id": 8888, "first_name": "Lifter", "username": "powerlifter"}),
    }
    params.update(overrides)
    return params


def test_telegram_init_data_accepts_valid_signature():
    bot_token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
    params = _params()
    user = verify_telegram_init_data(_signed_init_data(bot_token, params), bot_token)
    assert user["id"] == 8888
    assert user["username"] == "powerlifter"


def test_telegram_init_data_rejects_tampered_payload():
    bot_token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
    params = _params()
    raw = _signed_init_data(bot_token, params)
    tampered = urllib.parse.parse_qs(raw)
    tampered["auth_date"] = ["1700000005"]
    raw_tampered = urllib.parse.urlencode({k: v[0] for k, v in tampered.items()})
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw_tampered, bot_token)


def test_telegram_init_data_rejects_invalid_hash():
    raw = _signed_init_data("123456789:secret", _params())
    raw = raw.replace("hash=", "hash=0", 1)
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw, "123456789:secret")


def test_telegram_init_data_rejects_stale_auth_date():
    token = "123456789:secret"
    raw = _signed_init_data(token, _params(auth_date=str(int(time.time()) - 301)))
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw, token)


@pytest.mark.parametrize("raw", ["", "mock_init_data", "mock_attack", "hash=", "user=%7B%22id%22%3A1%7D"])
def test_telegram_init_data_rejects_missing_or_mock_fields(raw):
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw, "123456789:secret")


def test_telegram_init_data_rejects_mock_input_even_with_real_bot_token():
    with pytest.raises(ValueError):
        verify_telegram_init_data("mock_init_data", "123456789:real-secret")


def test_telegram_init_data_rejects_malformed_user_json():
    token = "123456789:secret"
    raw = _signed_init_data(token, _params(user="{malformed"))
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw, token)


def test_telegram_init_data_rejects_missing_bot_token():
    raw = _signed_init_data("123456789:secret", _params())
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw, "")


def test_telegram_init_data_rejects_known_placeholder_bot_token():
    raw = _signed_init_data("mock_bot_token", _params())
    with pytest.raises(ValueError):
        verify_telegram_init_data(raw, "mock_bot_token")


def test_integration_outbox_persists_in_memory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(IntegrationOutbox(
        id="test-job-uuid-1234",
        provider="google-sheets",
        connection_id="mock-conn-id",
        payload_json=json.dumps({"mesocycle_id": "meso-1"}),
        status="queued",
    ))
    db.commit()
    fetched = db.query(IntegrationOutbox).filter_by(id="test-job-uuid-1234").one()
    assert fetched.provider == "google-sheets"
    assert fetched.status == "queued"
    db.close()


@pytest.fixture
def oauth_client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    db = factory()
    user_a = User(id="oauth-user-a", email="oauth-a@example.com", hashed_password="x", role="COACH", email_verified_at=datetime.utcnow())
    user_b = User(id="oauth-user-b", email="oauth-b@example.com", hashed_password="x", role="COACH", email_verified_at=datetime.utcnow())
    db.add_all([user_a, user_b])
    db.commit()
    for user, plan in ((user_a, "coach_beta"), (user_b, "coach_starter")):
        workspace = ensure_default_workspace_for_coach(db, user)
        grant_workspace_access(db, workspace, plan, no_expiry=True, reason="test-fixture")
    db.commit()
    current = {"user": user_a}

    def override_db():
        yield db

    app.dependency_overrides[integrations.get_db] = override_db
    app.dependency_overrides[integrations.get_current_user] = lambda: current["user"]
    client = TestClient(app)
    yield client, db, current, user_a, user_b
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def _start_google_oauth(client):
    response = client.get("/api/integrations/google-sheets/auth-url")
    assert response.status_code == 200
    params = parse_qs(urlparse(response.json()["auth_url"]).query)
    return params["state"][0]


def test_google_oauth_state_normal_flow_is_random_and_single_use(oauth_client):
    client, db, _current, user_a, _user_b = oauth_client
    state = _start_google_oauth(client)
    assert state != user_a.id
    assert len(state) >= 40
    stored = db.query(OAuthState).one()
    assert stored.user_id == user_a.id
    assert stored.provider == "google-sheets"
    assert stored.state_hash != state
    assert stored.expires_at - stored.created_at == timedelta(minutes=10)

    callback = client.get("/api/integrations/google-sheets/callback", params={"code": "test-code", "state": state})
    assert callback.status_code == 200
    conn = db.query(IntegrationConnection).one()
    assert conn.user_id == user_a.id
    assert conn.provider == "google-sheets"
    assert db.query(OAuthState).count() == 0
    replay = client.get("/api/integrations/google-sheets/callback", params={"code": "test-code", "state": state})
    assert replay.status_code == 400


def test_google_oauth_rejects_forged_and_missing_state(oauth_client):
    client, db, _current, _user_a, _user_b = oauth_client
    assert client.get("/api/integrations/google-sheets/callback", params={"code": "x", "state": "forged"}).status_code == 400
    assert client.get("/api/integrations/google-sheets/callback", params={"code": "x"}).status_code == 400
    assert db.query(IntegrationConnection).count() == 0


def test_google_sheets_requires_integration_capability(oauth_client):
    client, db, current, _user_a, user_b = oauth_client
    current["user"] = user_b
    response = client.get("/api/integrations/google-sheets/auth-url")
    assert response.status_code == 403
    assert response.json()["detail"] == {
        "code": "FEATURE_NOT_INCLUDED",
        "feature": "integrations",
        "message": "This coaching plan does not include integrations.",
    }
    assert db.query(OAuthState).count() == 0


def test_google_sheets_publishing_keeps_relationship_authorization(oauth_client):
    client, db, current, user_a, user_b = oauth_client
    athlete = User(id="sheets-athlete", email="sheets-athlete@example.com", hashed_password="x", role="ATHLETE", email_verified_at=datetime.utcnow())
    db.add(athlete)
    db.commit()
    current["user"] = user_b
    db.add(CoachingRelationship(coach_id=user_b.id, athlete_id=athlete.id))
    db.commit()
    limited = client.post("/api/integrations/google-sheets/publish", json={
        "athlete_id": athlete.id, "mesocycle_id": "meso-test",
    })
    assert limited.status_code == 403
    assert limited.json()["detail"]["code"] == "FEATURE_NOT_INCLUDED"

    current["user"] = user_a
    unrelated = client.post("/api/integrations/google-sheets/publish", json={
        "athlete_id": athlete.id, "mesocycle_id": "meso-test",
    })
    assert unrelated.status_code == 403
    assert "No active relationship" in unrelated.json()["detail"]


def test_google_oauth_rejects_expired_and_wrong_provider_state(oauth_client):
    client, db, _current, _user_a, _user_b = oauth_client
    expired = _start_google_oauth(client)
    record = db.query(OAuthState).one()
    record.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.get("/api/integrations/google-sheets/callback", params={"code": "x", "state": expired}).status_code == 400

    mismatch = _start_google_oauth(client)
    record = db.query(OAuthState).one()
    record.provider = "another-provider"
    db.commit()
    assert client.get("/api/integrations/google-sheets/callback", params={"code": "x", "state": mismatch}).status_code == 400
    assert db.query(OAuthState).count() == 0
    assert db.query(IntegrationConnection).count() == 0


def test_google_oauth_state_owner_cannot_be_substituted_by_another_user(oauth_client):
    client, db, current, user_a, user_b = oauth_client
    state = _start_google_oauth(client)
    # A second signed-in user cannot rewrite the server-side owner. The OAuth
    # callback has no user-id parameter and recovers the original owner.
    current["user"] = user_b
    response = client.get("/api/integrations/google-sheets/callback", params={"code": "x", "state": state, "user_id": user_b.id})
    assert response.status_code == 200
    assert db.query(IntegrationConnection).one().user_id == user_a.id
    assert db.query(IntegrationConnection).filter_by(user_id=user_b.id).count() == 0


def test_google_oauth_callback_rejects_account_that_became_pending(oauth_client):
    client, db, _current, user, _other = oauth_client
    state = _start_google_oauth(client)
    user.email_verified_at = None
    db.commit()
    response = client.get('/api/integrations/google-sheets/callback', params={'code': 'x', 'state': state})
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'EMAIL_VERIFICATION_REQUIRED'
    assert db.query(IntegrationConnection).count() == 0


def test_sheets_worker_refuses_pending_account_before_reading_training(oauth_client, monkeypatch):
    _client, db, _current, user, _other = oauth_client
    user.email_verified_at = None
    conn = IntegrationConnection(id='pending-export-connection', user_id=user.id, provider='google-sheets', status='active')
    db.add(conn)
    db.commit()
    job = IntegrationOutbox(id='pending-export-job', provider='google-sheets', connection_id=conn.id,
                            payload_json=json.dumps({'athlete_id': user.id, 'mesocycle_id': 'm'}), status='processing')
    db.add(job)
    db.commit()
    monkeypatch.setattr(integrations, 'get_valid_google_access_token', lambda *_: pytest.fail('provider must not be contacted'))
    assert not integrations.process_sheets_publish_job(job, db)
    assert job.status == 'failed' and job.attempt_count == 3
    assert job.result == 'Export authorization is no longer valid'


def test_sheets_worker_respects_a_relationship_tombstone(oauth_client):
    _client, db, _current, coach, _other = oauth_client
    athlete = User(id='tombstone-export-athlete', email='tombstone-export@example.test',
                   hashed_password='x', role='ATHLETE', email_verified_at=datetime.utcnow())
    db.add(athlete)
    db.commit()
    db.add(CoachingRelationship(coach_id=coach.id, athlete_id=athlete.id, deleted_at=datetime.utcnow()))
    connection = IntegrationConnection(id='tombstone-export-connection', user_id=coach.id,
                                       provider='google-sheets', status='active')
    db.add(connection)
    db.commit()
    job = IntegrationOutbox(id='tombstone-export-job', provider='google-sheets', connection_id=connection.id,
                            payload_json=json.dumps({'athlete_id': athlete.id, 'mesocycle_id': 'm'}), status='processing')
    db.add(job)
    db.commit()
    assert not integrations.process_sheets_publish_job(job, db)
    assert job.result == 'Export authorization is no longer valid'
    assert job.attempt_count == 3

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

from backend.database import Base, IntegrationOutbox, OAuthState, User, IntegrationConnection
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
    user_a = User(id="oauth-user-a", email="oauth-a@example.com", hashed_password="x", role="COACH")
    user_b = User(id="oauth-user-b", email="oauth-b@example.com", hashed_password="x", role="COACH")
    db.add_all([user_a, user_b])
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

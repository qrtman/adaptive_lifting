import hmac
import hashlib
import json
import urllib.parse
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, IntegrationOutbox
from backend.integrations import encrypt_data, decrypt_data, verify_telegram_init_data, INTEGRATION_ENCRYPTION_KEY


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

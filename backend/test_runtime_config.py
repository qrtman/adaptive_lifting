import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.runtime_config import (
    cookie_secure_flag,
    load_cors_allowed_origins,
    load_jwt_secrets,
    validate_production_settings,
)


def _clear_runtime_env():
    for key in ("JWT_SECRET_CURRENT", "JWT_SECRET_PREVIOUS", "CORS_ALLOWED_ORIGINS", "COOKIE_SECURE", "APP_ENV", "ENV"):
        os.environ.pop(key, None)


def test_jwt_secret_required():
    _clear_runtime_env()
    try:
        load_jwt_secrets()
        raise AssertionError("expected RuntimeError when JWT_SECRET_CURRENT is unset")
    except RuntimeError as exc:
        assert "JWT_SECRET_CURRENT" in str(exc)


def test_jwt_secret_previous_optional():
    _clear_runtime_env()
    os.environ["JWT_SECRET_CURRENT"] = "current-key-value"
    current, previous = load_jwt_secrets()
    assert current == "current-key-value"
    assert previous is None
    os.environ["JWT_SECRET_PREVIOUS"] = "previous-key-value"
    current, previous = load_jwt_secrets()
    assert current == "current-key-value"
    assert previous == "previous-key-value"


def test_jwt_placeholder_forbidden_in_production():
    _clear_runtime_env()
    os.environ["APP_ENV"] = "production"
    os.environ["JWT_SECRET_CURRENT"] = "dev-only-unspecified-secret"
    try:
        load_jwt_secrets()
        raise AssertionError("expected RuntimeError for placeholder secret in production")
    except RuntimeError as exc:
        assert "placeholder" in str(exc)


def test_cors_required_and_rejects_wildcard():
    _clear_runtime_env()
    try:
        load_cors_allowed_origins()
        raise AssertionError("expected RuntimeError when CORS_ALLOWED_ORIGINS is unset")
    except RuntimeError as exc:
        assert "CORS_ALLOWED_ORIGINS" in str(exc)

    os.environ["CORS_ALLOWED_ORIGINS"] = "*"
    try:
        load_cors_allowed_origins()
        raise AssertionError("expected RuntimeError for wildcard CORS")
    except RuntimeError as exc:
        assert "*" in str(exc)

    os.environ["CORS_ALLOWED_ORIGINS"] = "http://localhost:5173, http://localhost:3000"
    assert load_cors_allowed_origins() == ["http://localhost:5173", "http://localhost:3000"]


def test_cookie_secure_from_env():
    _clear_runtime_env()
    os.environ["COOKIE_SECURE"] = "true"
    assert cookie_secure_flag() is True
    os.environ["COOKIE_SECURE"] = "false"
    assert cookie_secure_flag() is False


def test_apply_dotenv_does_not_override():
    from backend.runtime_config import apply_dotenv
    _clear_runtime_env()
    os.environ["JWT_SECRET_CURRENT"] = "already-set"
    apply_dotenv()
    assert os.environ["JWT_SECRET_CURRENT"] == "already-set"


def test_production_rejects_insecure_cookie_and_placeholder_encryption_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_URL", "https://lift.example.com")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://lift.example.com")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("INTEGRATION_ENCRYPTION_KEY", "dev-only-change-me")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    try:
        validate_production_settings()
        raise AssertionError("expected COOKIE_SECURE rejection")
    except RuntimeError as exc:
        assert "COOKIE_SECURE" in str(exc)
    monkeypatch.setenv("COOKIE_SECURE", "true")
    try:
        validate_production_settings()
        raise AssertionError("expected encryption key rejection")
    except RuntimeError as exc:
        assert "INTEGRATION_ENCRYPTION_KEY" in str(exc)
    monkeypatch.setenv("INTEGRATION_ENCRYPTION_KEY", "a-unique-stable-encryption-key-of-32-characters")
    validate_production_settings()

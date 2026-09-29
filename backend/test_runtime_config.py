import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.runtime_config import (
    cookie_secure_flag,
    load_cors_allowed_origins,
    load_jwt_secrets,
    validate_production_settings,
    voucher_secret_fingerprint,
)


def _clear_runtime_env(monkeypatch):
    for key in ("JWT_SECRET_CURRENT", "JWT_SECRET_PREVIOUS", "CORS_ALLOWED_ORIGINS", "COOKIE_SECURE", "APP_ENV", "ENV"):
        monkeypatch.delenv(key, raising=False)


def test_jwt_secret_required(monkeypatch):
    _clear_runtime_env(monkeypatch)
    try:
        load_jwt_secrets()
        raise AssertionError("expected RuntimeError when JWT_SECRET_CURRENT is unset")
    except RuntimeError as exc:
        assert "JWT_SECRET_CURRENT" in str(exc)


def test_jwt_secret_previous_optional(monkeypatch):
    _clear_runtime_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET_CURRENT", "current-key-value")
    current, previous = load_jwt_secrets()
    assert current == "current-key-value"
    assert previous is None
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "previous-key-value")
    current, previous = load_jwt_secrets()
    assert current == "current-key-value"
    assert previous == "previous-key-value"


def test_jwt_placeholder_forbidden_in_production(monkeypatch):
    _clear_runtime_env(monkeypatch)
    monkeypatch.setenv("EMAIL_VERIFICATION_NEW_ACCOUNTS", "false")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_CURRENT", "dev-only-unspecified-secret")
    try:
        load_jwt_secrets()
        raise AssertionError("expected RuntimeError for placeholder secret in production")
    except RuntimeError as exc:
        assert "placeholder" in str(exc)


def test_cors_required_and_rejects_wildcard(monkeypatch):
    _clear_runtime_env(monkeypatch)
    try:
        load_cors_allowed_origins()
        raise AssertionError("expected RuntimeError when CORS_ALLOWED_ORIGINS is unset")
    except RuntimeError as exc:
        assert "CORS_ALLOWED_ORIGINS" in str(exc)

    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    try:
        load_cors_allowed_origins()
        raise AssertionError("expected RuntimeError for wildcard CORS")
    except RuntimeError as exc:
        assert "*" in str(exc)

    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, http://localhost:3000")
    assert load_cors_allowed_origins() == ["http://localhost:5173", "http://localhost:3000"]


def test_cookie_secure_from_env(monkeypatch):
    _clear_runtime_env(monkeypatch)
    monkeypatch.setenv("COOKIE_SECURE", "true")
    assert cookie_secure_flag() is True
    monkeypatch.setenv("COOKIE_SECURE", "false")
    assert cookie_secure_flag() is False


def test_apply_dotenv_does_not_override(monkeypatch):
    from backend.runtime_config import apply_dotenv
    _clear_runtime_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET_CURRENT", "already-set")
    apply_dotenv()
    assert os.environ["JWT_SECRET_CURRENT"] == "already-set"


def test_production_rejects_insecure_cookie_and_placeholder_encryption_key(monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_NEW_ACCOUNTS", "false")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_CURRENT", "runtime-config-test-jwt-key-with-over-32-characters")
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    monkeypatch.setenv("VOUCHER_BILLING_ENABLED", "false")
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


def test_stripe_config_is_optional_but_validated_when_enabled(monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_NEW_ACCOUNTS", "false")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_CURRENT", "runtime-config-test-jwt-key-with-over-32-characters")
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    monkeypatch.setenv("VOUCHER_BILLING_ENABLED", "false")
    monkeypatch.setenv("APP_URL", "https://lift.example.com")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://lift.example.com")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("INTEGRATION_ENCRYPTION_KEY", "a-unique-stable-encryption-key-of-32-characters")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("STRIPE_BILLING_ENABLED", "false")
    validate_production_settings()

    monkeypatch.setenv("STRIPE_BILLING_ENABLED", "true")
    with pytest.raises(RuntimeError, match="STRIPE_SECRET_KEY"):
        validate_production_settings()
    monkeypatch.setenv("STRIPE_SECRET_KEY", "configured-server-secret")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "configured-webhook-secret")
    monkeypatch.setenv("STRIPE_PRICE_COACH_STARTER", "price_starter")
    monkeypatch.setenv("STRIPE_PRICE_COACH_PRO", "price_pro")
    monkeypatch.setenv("STRIPE_PRICE_COACH_UNLIMITED", "price_unlimited")
    monkeypatch.setenv("STRIPE_EXPECT_LIVEMODE", "false")
    with pytest.raises(RuntimeError, match="STRIPE_EXPECT_LIVEMODE"):
        validate_production_settings()
    monkeypatch.setenv("STRIPE_EXPECT_LIVEMODE", "true")
    validate_production_settings()
    monkeypatch.setenv("STRIPE_SECRET_KEY", "replace-with-stripe-key")
    with pytest.raises(RuntimeError, match="STRIPE_SECRET_KEY"):
        validate_production_settings()
    monkeypatch.setenv("STRIPE_SECRET_KEY", "configured-server-secret")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "example-webhook-secret")
    with pytest.raises(RuntimeError, match="STRIPE_WEBHOOK_SECRET"):
        validate_production_settings()
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "configured-webhook-secret")
    for unsafe_origin in ("http://lift.example.com", "https://lift.example.com/path",
                          "https://lift.example.com?next=evil.example", "https://user@lift.example.com"):
        monkeypatch.setenv("APP_URL", unsafe_origin)
        with pytest.raises(RuntimeError, match="APP_URL"):
            validate_production_settings()


def test_production_voucher_secret_is_durable_independent_and_fingerprinted(monkeypatch):
    for name, value in {
        "EMAIL_VERIFICATION_NEW_ACCOUNTS": "false",
        "APP_ENV": "production", "APP_URL": "https://lift.example.com",
        "CORS_ALLOWED_ORIGINS": "https://lift.example.com", "COOKIE_SECURE": "true",
        "JWT_SECRET_CURRENT": "separate-jwt-secret-for-runtime-config-test-1234",
        "JWT_SECRET_PREVIOUS": "",
        "INTEGRATION_ENCRYPTION_KEY": "separate-integration-secret-for-test-1234",
        "TELEGRAM_BOT_TOKEN": "", "GOOGLE_OAUTH_CLIENT_ID": "", "GOOGLE_CLIENT_ID": "",
        "STRIPE_BILLING_ENABLED": "false", "VOUCHER_BILLING_ENABLED": "true",
    }.items():
        monkeypatch.setenv(name, value)
    for unsafe in ("", "short", "replace-with-a-long-random-secret", "x" * 64):
        monkeypatch.setenv("VOUCHER_CODE_SECRET", unsafe)
        with pytest.raises(RuntimeError, match="VOUCHER_CODE_SECRET"):
            validate_production_settings()
    monkeypatch.setenv("VOUCHER_CODE_SECRET", "separate-jwt-secret-for-runtime-config-test-1234")
    with pytest.raises(RuntimeError, match="independent"):
        validate_production_settings()
    monkeypatch.setenv("VOUCHER_CODE_SECRET", "unique-voucher-secret-for-runtime-test-ABCD-5678")
    validate_production_settings()
    fingerprint = voucher_secret_fingerprint()
    assert len(fingerprint) == 12 and fingerprint.isalnum()
    assert "unique-voucher" not in fingerprint
    monkeypatch.setenv("VOUCHER_CODE_SECRET", "different-voucher-secret-for-runtime-ABCD-5678")
    assert voucher_secret_fingerprint() != fingerprint


def test_staging_requires_test_mode_for_stripe(monkeypatch):
    for name, value in {
        "EMAIL_VERIFICATION_NEW_ACCOUNTS": "false",
        "APP_ENV": "staging", "APP_URL": "https://stage.example.com",
        "CORS_ALLOWED_ORIGINS": "https://stage.example.com", "COOKIE_SECURE": "true",
        "JWT_SECRET_CURRENT": "staging-runtime-test-jwt-key-with-over-32-characters",
        "JWT_SECRET_PREVIOUS": "", "INTEGRATION_ENCRYPTION_KEY": "staging-integration-secret-over-32-characters",
        "TELEGRAM_BOT_TOKEN": "", "GOOGLE_OAUTH_CLIENT_ID": "", "GOOGLE_CLIENT_ID": "",
        "STRIPE_BILLING_ENABLED": "true", "STRIPE_SECRET_KEY": "configured-staging-key",
        "STRIPE_WEBHOOK_SECRET": "configured-staging-webhook",
        "STRIPE_PRICE_COACH_STARTER": "price_stage_starter",
        "STRIPE_PRICE_COACH_PRO": "price_stage_pro",
        "STRIPE_PRICE_COACH_UNLIMITED": "price_stage_unlimited",
        "STRIPE_EXPECT_LIVEMODE": "true", "VOUCHER_BILLING_ENABLED": "false",
    }.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError, match="false in staging"):
        validate_production_settings()
    monkeypatch.setenv("STRIPE_EXPECT_LIVEMODE", "false")
    validate_production_settings()

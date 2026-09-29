import base64

import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat, NoEncryption

from scripts.check_staging_config import check_staging_config


@pytest.fixture
def staging_settings(monkeypatch):
    private = ec.generate_private_key(ec.SECP256R1())
    settings = {
        "APP_ENV": "staging", "DEPLOY_APP_ENV": "staging",
        "APP_DOMAIN": "staging.adaptive.test", "APP_URL": "https://staging.adaptive.test",
        "CORS_ALLOWED_ORIGINS": "https://staging.adaptive.test", "COOKIE_SECURE": "true",
        "DATABASE_URL": "postgresql+psycopg://test@127.0.0.1/staging",
        "JWT_SECRET_CURRENT": "staging-test-only-jwt-secret-at-least-32-bytes",
        "JWT_SECRET_PREVIOUS": "", "INTEGRATION_ENCRYPTION_KEY": "staging-test-only-integration-secret-32-bytes",
        "EMAIL_VERIFICATION_NEW_ACCOUNTS": "true", "EMAIL_VERIFICATION_ENFORCE_LEGACY": "false",
        "EMAIL_PROVIDER": "resend", "EMAIL_PROVIDER_API_KEY": "staging-test-only-provider-key",
        "EMAIL_FROM": "Verification <verify@staging.adaptive.test>",
        "EMAIL_PAYLOAD_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "OFFLINE_AUTH_PRIVATE_KEY": private.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode(),
        "VITE_OFFLINE_AUTH_PUBLIC_KEY": base64.b64encode(private.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)).decode(),
        "GOOGLE_CLIENT_ID": "staging-client", "VITE_GOOGLE_CLIENT_ID": "staging-client",
        "GOOGLE_OAUTH_CLIENT_ID": "", "GOOGLE_OAUTH_CLIENT_SECRET": "", "TELEGRAM_BOT_TOKEN": "",
        "STRIPE_BILLING_ENABLED": "false", "VOUCHER_BILLING_ENABLED": "false",
    }
    for key, value in settings.items():
        monkeypatch.setenv(key, value)


def test_staging_preflight_accepts_consistent_settings_without_external_access(staging_settings):
    check_staging_config()


@pytest.mark.parametrize("key,value,expected", [
    ("APP_ENV", "production", "APP_ENV"),
    ("DEPLOY_APP_ENV", "production", "DEPLOY_APP_ENV"),
    ("EMAIL_VERIFICATION_ENFORCE_LEGACY", "true", "ENFORCE_LEGACY"),
    ("EMAIL_VERIFICATION_NEW_ACCOUNTS", "false", "NEW_ACCOUNTS"),
    ("EMAIL_PROVIDER", "fake", "EMAIL_PROVIDER"),
    ("EMAIL_PROVIDER_API_KEY", "", "EMAIL_PROVIDER_API_KEY"),
    ("VITE_GOOGLE_CLIENT_ID", "different-client", "GOOGLE_CLIENT_ID"),
    ("DATABASE_URL", "sqlite:///local.sqlite", "DATABASE_URL"),
    ("APP_DOMAIN", "other.adaptive.test", "APP_DOMAIN"),
    ("VITE_OFFLINE_AUTH_PUBLIC_KEY", base64.b64encode(b"different").decode(), "public key"),
])
def test_staging_preflight_rejects_unsafe_or_mismatched_settings(staging_settings, monkeypatch, key, value, expected):
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match=expected):
        check_staging_config()

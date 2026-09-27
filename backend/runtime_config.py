import hashlib
import os
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlsplit

JWT_KID_CURRENT = "current"
JWT_KID_PREVIOUS = "previous"

_PLACEHOLDER_SECRETS = frozenset({
    "dev-only-unspecified-secret",
    "changeme",
    "secret",
    "jwt-secret",
})


def _obvious_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered in _PLACEHOLDER_SECRETS or lowered.startswith(
        ("replace", "dev-only", "mock_", "example", "sample", "changeme")
    )


def apply_dotenv() -> None:
    """Load repo-root .env into os.environ without overriding existing variables."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def is_production_like() -> bool:
    env_name = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "").strip().lower()
    if env_name in {"production", "staging", "prod"}:
        return True
    return os.environ.get("COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes"}


def _parse_csv(raw: str) -> List[str]:
    return [part.strip() for part in raw.split(",") if part.strip()]


def load_jwt_secrets() -> Tuple[str, Optional[str]]:
    current = (os.environ.get("JWT_SECRET_CURRENT") or "").strip()
    previous = (os.environ.get("JWT_SECRET_PREVIOUS") or "").strip() or None
    if not current:
        raise RuntimeError(
            "JWT_SECRET_CURRENT is required. Set it in the environment; hardcoded JWT secrets are forbidden."
        )
    if is_production_like():
        for name, value in (("JWT_SECRET_CURRENT", current), ("JWT_SECRET_PREVIOUS", previous)):
            if value and (value.lower() in _PLACEHOLDER_SECRETS or value.lower().startswith(("replace-", "dev-only-", "mock_")) or len(value) < 32):
                raise RuntimeError(f"{name} must be a unique secret of at least 32 characters in production, not a placeholder.")
    if previous and previous == current:
        previous = None
    return current, previous


def load_cors_allowed_origins() -> List[str]:
    raw = (os.environ.get("CORS_ALLOWED_ORIGINS") or "").strip()
    if not raw:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS is required (comma-separated frontend origins). Wildcard * is not allowed."
        )
    origins = _parse_csv(raw)
    if any(origin == "*" for origin in origins):
        raise RuntimeError("CORS_ALLOWED_ORIGINS must list explicit origins; * is not allowed.")
    return origins


def cookie_secure_flag() -> bool:
    raw = os.environ.get("COOKIE_SECURE", "").strip().lower()
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    return is_production_like()


def validate_production_settings() -> None:
    if not is_production_like():
        return
    if not cookie_secure_flag():
        raise RuntimeError("COOKIE_SECURE must be true in production")
    load_jwt_secrets()
    origins = load_cors_allowed_origins()
    if any(not origin.startswith("https://") for origin in origins):
        raise RuntimeError("CORS_ALLOWED_ORIGINS must use HTTPS in production")
    app_url = os.environ.get("APP_URL", "").strip().rstrip("/")
    if not app_url.startswith("https://"):
        raise RuntimeError("APP_URL must be an HTTPS origin in production")
    key = os.environ.get("INTEGRATION_ENCRYPTION_KEY", "").strip()
    if len(key) < 32 or key.startswith(("dev-only-", "replace-")):
        raise RuntimeError("INTEGRATION_ENCRYPTION_KEY must be a stable secret of at least 32 characters in production")
    if os.environ.get("TELEGRAM_BOT_TOKEN", "").strip():
        webhook_secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
        if len(webhook_secret) < 32 or webhook_secret.startswith(("mock_", "replace-")):
            raise RuntimeError("TELEGRAM_WEBHOOK_SECRET must be configured when Telegram is enabled")
    sheets_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    sheets_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if sheets_id and (sheets_id.startswith(("mock_", "replace-")) or not sheets_secret or sheets_secret.startswith(("mock_", "replace-"))):
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_SECRET must be configured when Google Sheets is enabled")
    google_login_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if google_login_id.startswith(("mock_", "replace-")):
        raise RuntimeError("GOOGLE_CLIENT_ID must be a real OAuth web client ID when Google login is enabled")
    if stripe_billing_enabled():
        parsed_app_url = urlsplit(app_url)
        if (parsed_app_url.scheme != "https" or not parsed_app_url.netloc or
                parsed_app_url.path or parsed_app_url.query or parsed_app_url.fragment or
                parsed_app_url.username or parsed_app_url.password):
            raise RuntimeError("APP_URL must be a single HTTPS origin when Stripe billing is enabled")
        stripe_key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
        if not stripe_key or _obvious_placeholder(stripe_key):
            raise RuntimeError("STRIPE_SECRET_KEY is required when Stripe billing is enabled")
        webhook_key = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
        if not webhook_key or _obvious_placeholder(webhook_key):
            raise RuntimeError("STRIPE_WEBHOOK_SECRET is required when Stripe billing is enabled")
        price_ids = [os.environ.get(name, "").strip() for name in STRIPE_PRICE_ENV_VARS]
        if not all(price_ids) or any(_obvious_placeholder(item) for item in price_ids) or len(set(price_ids)) != len(price_ids):
            raise RuntimeError("All three unique Stripe coaching price IDs are required when Stripe billing is enabled")
        environment_name = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "").strip().lower()
        if environment_name == "staging":
            if stripe_expect_livemode():
                raise RuntimeError("STRIPE_EXPECT_LIVEMODE must be false in staging")
        elif not stripe_expect_livemode():
            raise RuntimeError("STRIPE_EXPECT_LIVEMODE must be true in production")
    if voucher_billing_enabled():
        voucher_secret_bytes()


STRIPE_PRICE_ENV_VARS = (
    "STRIPE_PRICE_COACH_STARTER",
    "STRIPE_PRICE_COACH_PRO",
    "STRIPE_PRICE_COACH_UNLIMITED",
)


def stripe_billing_enabled() -> bool:
    return os.environ.get("STRIPE_BILLING_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def stripe_expect_livemode() -> bool:
    raw = os.environ.get("STRIPE_EXPECT_LIVEMODE", "false").strip().lower()
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no", ""}:
        return False
    raise RuntimeError("STRIPE_EXPECT_LIVEMODE must be a boolean")


def voucher_billing_enabled() -> bool:
    """Production requires an explicit switch; local fixtures can use a set secret."""
    raw = os.environ.get("VOUCHER_BILLING_ENABLED", "").strip().lower()
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    if raw:
        raise RuntimeError("VOUCHER_BILLING_ENABLED must be a boolean")
    return not is_production_like() and bool(os.environ.get("VOUCHER_CODE_SECRET"))


def voucher_secret_bytes() -> bytes:
    """The dedicated, durable HMAC key for outstanding voucher codes."""
    if not voucher_billing_enabled():
        raise RuntimeError("Voucher billing is disabled")
    value = os.environ.get("VOUCHER_CODE_SECRET", "")
    material = value.encode("utf-8")
    lowered = value.strip().lower()
    if (len(material) < 32 or not lowered or (is_production_like() and (
            _obvious_placeholder(lowered) or lowered.startswith("test-") or
            len(set(material)) < 12))):
        raise RuntimeError("VOUCHER_CODE_SECRET must be a dedicated random secret of at least 32 bytes, not a placeholder")
    if value in {os.environ.get("JWT_SECRET_CURRENT"), os.environ.get("JWT_SECRET_PREVIOUS"),
                 os.environ.get("INTEGRATION_ENCRYPTION_KEY"), os.environ.get("STRIPE_SECRET_KEY"),
                 os.environ.get("STRIPE_WEBHOOK_SECRET")}:
        raise RuntimeError("VOUCHER_CODE_SECRET must be independent of other secrets")
    return material


def voucher_secret_fingerprint() -> str:
    return hashlib.sha256(voucher_secret_bytes()).hexdigest()[:12]


def development_login_enabled() -> bool:
    """Allow the local demo-account shortcut only when explicitly enabled."""
    enabled = os.environ.get("DEV_LOGIN_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    return enabled and not is_production_like()

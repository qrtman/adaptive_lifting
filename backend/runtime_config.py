import os
from pathlib import Path
from typing import List, Optional, Tuple

JWT_KID_CURRENT = "current"
JWT_KID_PREVIOUS = "previous"

_PLACEHOLDER_SECRETS = frozenset({
    "dev-only-unspecified-secret",
    "changeme",
    "secret",
    "jwt-secret",
})


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
    if is_production_like() and current.lower() in _PLACEHOLDER_SECRETS:
        raise RuntimeError(
            "JWT_SECRET_CURRENT must not use a development placeholder outside local development."
        )
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

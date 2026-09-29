"""Read-only staging preflight. Prints configuration errors, never secret values.

Run with credentials already injected in the environment, or:
    python scripts/check_staging_config.py --env-file .env.staging
Does not connect to databases/providers, send mail, or deploy anything.
"""
import argparse
import base64
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def check_staging_config():
    from backend.runtime_config import validate_production_settings
    if os.environ.get("APP_ENV") != "staging":
        raise RuntimeError("APP_ENV must be staging; this preflight is not for production")
    if os.environ.get("DEPLOY_APP_ENV", "staging") != "staging":
        raise RuntimeError("DEPLOY_APP_ENV must be staging")
    if os.environ.get("EMAIL_VERIFICATION_NEW_ACCOUNTS") != "true":
        raise RuntimeError("EMAIL_VERIFICATION_NEW_ACCOUNTS must be true for staging acceptance")
    if os.environ.get("EMAIL_VERIFICATION_ENFORCE_LEGACY") != "false":
        raise RuntimeError("EMAIL_VERIFICATION_ENFORCE_LEGACY must remain false for the initial rollout")
    validate_production_settings()
    database = os.environ.get("DATABASE_URL", "")
    if not database.startswith(("postgresql://", "postgresql+psycopg://")) or "replace-" in database or ".example.com" in database:
        raise RuntimeError("DATABASE_URL must identify provisioned staging PostgreSQL")
    origin = os.environ.get("APP_URL", "").rstrip("/")
    if urlsplit(origin).netloc != os.environ.get("APP_DOMAIN") or ".example.com" in origin:
        raise RuntimeError("APP_DOMAIN must match the provisioned APP_URL host")
    if os.environ.get("CORS_ALLOWED_ORIGINS") != origin:
        raise RuntimeError("CORS_ALLOWED_ORIGINS must match the staging frontend origin")
    if os.environ.get("GOOGLE_CLIENT_ID", "") != os.environ.get("VITE_GOOGLE_CLIENT_ID", ""):
        raise RuntimeError("GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID must match")
    private = os.environ.get("OFFLINE_AUTH_PRIVATE_KEY", "").replace("\\n", "\n")
    public = os.environ.get("VITE_OFFLINE_AUTH_PUBLIC_KEY", "")
    if not private or not public:
        raise RuntimeError("Configure both offline authorization keys to validate offline reload")
    from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PublicFormat
    try:
        expected = load_pem_private_key(private.encode(), password=None).public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
        actual = base64.b64decode(public, validate=True)
    except Exception:
        raise RuntimeError("Offline authorization keys must be a valid matching P-256 PEM/SPKI pair") from None
    if expected != actual:
        raise RuntimeError("Offline authorization public key does not match the backend private key")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    if args.env_file:
        if not args.env_file.is_file():
            print("BLOCKED: staging environment file is missing", file=sys.stderr)
            return 1
        # Explicit file supplies the deployment environment, overriding ambient
        # values; Compose --env-file must use this same file at deployment time.
        # Match the repository's apply_dotenv format: one KEY=value per line,
        # optional enclosing quotes, and literal \n for PEM keys. No expansion.
        for line in args.env_file.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ[key.strip()] = value
    try:
        check_staging_config()
    except RuntimeError as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        return 1
    print("PASSED: staging configuration and offline key pairing (external services not tested)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

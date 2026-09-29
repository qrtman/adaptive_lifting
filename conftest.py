import atexit
import os
import tempfile
from pathlib import Path

_fd, _database_path = tempfile.mkstemp(prefix="adaptive-lifting-pytest-", suffix=".sqlite")
os.close(_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_database_path).as_posix()}"

# API startup intentionally does not create or evolve schemas. Provision the
# disposable test database through the same explicit Alembic path as installs.
from alembic import command
from alembic.config import Config

command.upgrade(Config("alembic.ini"), "head")


def _remove_test_database() -> None:
    try:
        from backend.database import engine
        engine.dispose()
    except Exception:
        pass
    Path(_database_path).unlink(missing_ok=True)


atexit.register(_remove_test_database)

os.environ.setdefault("JWT_SECRET_CURRENT", "test-jwt-secret-current")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://testserver")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("EMAIL_PROVIDER", "fake")
os.environ.setdefault("EMAIL_FROM", "Adaptive Lifting <verify@example.test>")
os.environ.setdefault("APP_URL", "http://localhost:3000")
from cryptography.fernet import Fernet
os.environ.setdefault("EMAIL_PAYLOAD_ENCRYPTION_KEY", Fernet.generate_key().decode())

import pytest

@pytest.fixture(autouse=True)
def reset_auth_limits():
    from backend.database import SessionLocal, AuthSecurityEvent, AuthSecuritySubject
    with SessionLocal() as db:
        db.query(AuthSecurityEvent).delete()
        db.query(AuthSecuritySubject).delete()
        db.commit()

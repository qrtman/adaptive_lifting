from sqlalchemy import text

from backend.database import SessionLocal, init_db
from backend.schema_migrations import apply_schema_migrations


def test_movement_pattern_migration_is_versioned_and_idempotent():
    init_db()
    db = SessionLocal()
    try:
        apply_schema_migrations(db)
        apply_schema_migrations(db)
        rows = db.execute(text("SELECT version FROM schema_migrations")).fetchall()
        versions = {row[0] for row in rows}
        assert "001_movement_pattern" in versions
    finally:
        db.close()

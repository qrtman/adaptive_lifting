"""Versioned SQLite schema steps. Idempotent; recorded in schema_migrations."""

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from .exercise_patterns import pattern_for

SCHEMA_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR PRIMARY KEY,
    applied_at DATETIME NOT NULL
)
"""


def _applied(db: Session) -> set:
    rows = db.execute(text("SELECT version FROM schema_migrations")).fetchall()
    return {row[0] for row in rows}


def _record(db: Session, version: str) -> None:
    db.execute(
        text("INSERT INTO schema_migrations (version, applied_at) VALUES (:version, :applied_at)"),
        {"version": version, "applied_at": datetime.utcnow().isoformat()},
    )


def apply_001_movement_pattern(db: Session) -> None:
    try:
        db.execute(text("ALTER TABLE exercises ADD COLUMN movement_pattern VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()
    rows = db.execute(text("SELECT id, title, lift_category, movement_pattern FROM exercises")).fetchall()
    for row in rows:
        if row[3]:
            continue
        db.execute(
            text("UPDATE exercises SET movement_pattern = :pattern WHERE id = :id"),
            {"pattern": pattern_for(row[1], row[2]), "id": row[0]},
        )
    db.commit()


def apply_002_session_notes(db: Session) -> None:
    try:
        db.execute(text("ALTER TABLE workouts ADD COLUMN notes TEXT"))
        db.commit()
    except Exception:
        db.rollback()


MIGRATIONS = (
    ("001_movement_pattern", apply_001_movement_pattern),
    ("002_session_notes", apply_002_session_notes),
)


def apply_schema_migrations(db: Session) -> None:
    db.execute(text(SCHEMA_MIGRATIONS_DDL))
    db.commit()
    done = _applied(db)
    for version, fn in MIGRATIONS:
        if version in done:
            continue
        fn(db)
        _record(db, version)
        db.commit()

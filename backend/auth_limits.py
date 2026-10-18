"""Shared rolling-window IP limits, serialized in the database across workers."""
import hashlib
import uuid
from datetime import datetime, timedelta
from sqlalchemy import update
from .database import AuthSecuritySubject, AuthSecurityEvent, SessionLocal


def allow_auth_attempt(address, category, limit, seconds, session_factory=None):
    subject = hashlib.sha256(f"{category}:{address}".encode()).hexdigest()
    now = datetime.utcnow()
    with (session_factory or SessionLocal)() as db:
        dialect = db.bind.dialect.name
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            from sqlalchemy.dialects.sqlite import insert
        db.execute(insert(AuthSecuritySubject).values(subject_hash=subject, updated_at=now)
                   .on_conflict_do_nothing(index_elements=["subject_hash"]))
        db.execute(update(AuthSecuritySubject).where(AuthSecuritySubject.subject_hash == subject).values(updated_at=now))
        db.query(AuthSecurityEvent).filter_by(subject_hash=subject).filter(
            AuthSecurityEvent.created_at <= now - timedelta(seconds=seconds)).delete(synchronize_session=False)
        count = db.query(AuthSecurityEvent).filter_by(subject_hash=subject).count()
        allowed = count < limit
        if allowed:
            db.add(AuthSecurityEvent(id=str(uuid.uuid4()), subject_hash=subject, created_at=now))
        db.commit()
        return allowed

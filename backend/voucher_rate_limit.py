"""Cross-worker voucher attempt limits backed by the application database."""

import hashlib
import os
from datetime import datetime

from sqlalchemy import case, or_, update
from sqlalchemy.exc import IntegrityError

from .database import VoucherRedemptionLimit
from .runtime_config import is_production_like

MINUTE_LIMIT = 5
HOUR_LIMIT = 20


def enabled():
    if is_production_like():
        return True
    override = os.environ.get("VOUCHER_RATE_LIMIT_ENABLED", "").strip().lower()
    if override in {"1", "true", "yes"}:
        return True
    return False


def _subject(scope, value):
    # The database need not retain raw client addresses or account IDs.
    return hashlib.sha256(f"voucher:{scope}:{value}".encode("utf-8")).hexdigest()


def _claim(db, subject_hash, now):
    minute = now.replace(second=0, microsecond=0)
    hour = now.replace(minute=0, second=0, microsecond=0)
    table = VoucherRedemptionLimit
    statement = update(table).where(
        table.subject_hash == subject_hash,
        or_(table.minute_started_at < minute, table.minute_count < MINUTE_LIMIT),
        or_(table.hour_started_at < hour, table.hour_count < HOUR_LIMIT),
    ).values(
        minute_started_at=minute,
        minute_count=case((table.minute_started_at == minute, table.minute_count + 1), else_=1),
        hour_started_at=hour,
        hour_count=case((table.hour_started_at == hour, table.hour_count + 1), else_=1),
        updated_at=now,
    )
    if db.execute(statement).rowcount == 1:
        return True
    if db.get(table, subject_hash) is not None:
        return False
    try:
        with db.begin_nested():
            db.add(table(subject_hash=subject_hash, minute_started_at=minute, minute_count=1,
                         hour_started_at=hour, hour_count=1, updated_at=now))
            db.flush()
        return True
    except IntegrityError:
        # Another worker inserted this subject while we were trying. The
        # unique primary key resolves the race; retry the atomic update.
        return db.execute(statement).rowcount == 1


def record_voucher_attempt(db, *, user_id, client_ip, now=None):
    """Count an attempt for both the client IP and authenticated account.

    Caller commits these counters independently of the redemption transaction.
    This makes invalid-code attempts count even when redemption rolls back.
    """
    now = now or datetime.utcnow()
    allowed_ip = _claim(db, _subject("ip", client_ip or "unknown"), now)
    allowed_user = _claim(db, _subject("user", user_id), now)
    return allowed_ip and allowed_user

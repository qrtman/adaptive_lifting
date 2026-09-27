from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import uuid

from backend.database import SessionLocal, VoucherRedemptionLimit
from backend.voucher_rate_limit import record_voucher_attempt


def _attempt(user_id, ip, now):
    with SessionLocal.begin() as db:
        return record_voucher_attempt(db, user_id=user_id, client_ip=ip, now=now)


def test_shared_voucher_limit_applies_across_sessions_to_ip_and_account():
    now = datetime(2026, 9, 28, 12, 10, 5)
    ip = f"test-{uuid.uuid4().hex}"
    user = uuid.uuid4().hex
    assert all(_attempt(user, ip, now) for _ in range(5))
    assert not _attempt(user, ip, now)
    assert not _attempt(uuid.uuid4().hex, ip, now)
    assert not _attempt(user, f"other-{uuid.uuid4().hex}", now)
    assert _attempt(user, ip, now + timedelta(minutes=1))
    for minute in (2, 3):
        assert all(_attempt(user, ip, now + timedelta(minutes=minute)) for _ in range(5))
    assert all(_attempt(user, ip, now + timedelta(minutes=4)) for _ in range(4))
    assert not _attempt(user, ip, now + timedelta(minutes=5))
    assert _attempt(user, ip, now + timedelta(hours=1))
    with SessionLocal() as db:
        assert db.query(VoucherRedemptionLimit).count() >= 2


def test_parallel_attempts_share_one_database_counter():
    ip = f"parallel-{uuid.uuid4().hex}"
    user = uuid.uuid4().hex
    now = datetime(2026, 9, 28, 15, 0)
    with ThreadPoolExecutor(max_workers=4) as workers:
        outcomes = list(workers.map(lambda _: _attempt(user, ip, now), range(8)))
    assert outcomes.count(True) == 5
    assert outcomes.count(False) == 3

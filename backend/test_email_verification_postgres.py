"""Optional PostgreSQL concurrency checks, using an isolated temporary schema."""
import hashlib
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend import main, integrations
from backend.auth_limits import allow_auth_attempt
from backend.database import Base, EmailVerificationToken, IntegrationOutbox, User
from backend.email_delivery import FakeEmailProvider
from backend.email_verification import consume_verification, queue_verification, resend_verification


@pytest.fixture
def postgres_sessions():
    url = os.environ.get('EMAIL_VERIFICATION_POSTGRES_URL')
    if not url:
        pytest.skip('EMAIL_VERIFICATION_POSTGRES_URL is not configured')
    if not url.startswith('postgresql'):
        pytest.fail('PostgreSQL URL required')
    admin = create_engine(url)
    schema = 'verification_test_' + uuid.uuid4().hex
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA {schema}'))
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema}'})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        db.add(User(id='pending', email='pending@example.com', hashed_password='x', role='ATHLETE'))
        db.flush()
        queue_verification(db, db.get(User, 'pending'))
        db.commit()
    yield factory
    engine.dispose()
    with admin.begin() as db:
        db.execute(text(f'DROP SCHEMA {schema} CASCADE'))
    admin.dispose()


def test_postgres_consumption_has_exactly_one_winner(postgres_sessions):
    with postgres_sessions() as db:
        job = db.query(IntegrationOutbox).one()
        raw = Fernet(os.environ['EMAIL_PAYLOAD_ENCRYPTION_KEY'].encode()).decrypt(job.encrypted_payload.encode()).decode()
    def verify(_):
        with postgres_sessions() as db:
            try:
                consume_verification(db, raw)
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(verify, range(8)))
    assert results.count(200) == 1 and results.count(400) == 7


def test_postgres_resend_is_serialized(postgres_sessions):
    with postgres_sessions() as db:
        db.query(EmailVerificationToken).update({EmailVerificationToken.created_at: datetime.utcnow() - timedelta(minutes=2)})
        db.commit()
    def resend(_):
        with postgres_sessions() as db:
            resend_verification(db, 'pending@example.com')
            db.commit()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(resend, range(8)))
    with postgres_sessions() as db:
        assert db.query(EmailVerificationToken).filter_by(is_resend=True).count() == 1


def test_postgres_limits_are_shared_and_python_does_not_claim_outbox(postgres_sessions, monkeypatch):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: allow_auth_attempt('ip', 'register', 5, 60, postgres_sessions), range(16)))
    assert sum(results) == 5
    fake = FakeEmailProvider()
    monkeypatch.setattr('backend.email_delivery.email_provider', lambda: fake)
    with ThreadPoolExecutor(max_workers=8) as pool:
        claimed = list(pool.map(lambda _: integrations.process_next_outbox_job(postgres_sessions), range(8)))
    assert claimed == [False] * 8
    assert fake.messages == []

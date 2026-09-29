import hashlib
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend import main, integrations
from backend.auth_limits import allow_auth_attempt
from backend.database import (Base, EmailVerificationToken, IntegrationOutbox, SessionLocal,
                              Session as AuthSession, User, IntegrationConnection, Workout, Microcycle)
from backend.email_delivery import FakeEmailProvider, ResendEmailProvider, EmailDeliveryError, VerificationMessage
from backend.email_verification import queue_verification, requires_verification
from backend.test_support import register_coach, register_verified


def pending(client=None):
    client = client or TestClient(main.app)
    email = f"pending-{uuid.uuid4().hex}@example.com"
    response = client.post('/api/auth/register', json={'email': email, 'password': 'password123'})
    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        user = db.query(User).filter_by(email=email).one()
        token = db.query(EmailVerificationToken).filter_by(user_id=user.id).one()
        job = db.query(IntegrationOutbox).filter_by(verification_token_id=token.id).one()
        raw = Fernet(os.environ['EMAIL_PAYLOAD_ENCRYPTION_KEY'].encode()).decrypt(job.encrypted_payload.encode()).decode()
        return client, email, user.id, raw, token.id, job.id


def test_registration_is_generic_transactional_and_unauthenticated():
    client, email, uid, raw, tid, jid = pending()
    assert client.cookies.get('session_id') is None
    assert client.get('/api/microcycles').status_code == 401
    response = client.post('/api/auth/register', json={'email': email, 'password': 'password123'})
    assert set(response.json()) == {'message'}
    assert 'access_token' not in response.text and raw not in response.text
    with SessionLocal() as db:
        user, token, job = db.get(User, uid), db.get(EmailVerificationToken, tid), db.get(IntegrationOutbox, jid)
        assert user.email_verified_at is None and not user.email_verification_legacy_exempt
        assert user.role == 'ATHLETE' and requires_verification(user)
        assert db.query(AuthSession).filter_by(user_id=uid).count() == 0
        assert token.token_hash == hashlib.sha256(raw.encode()).hexdigest()
        assert token.expires_at - token.created_at == timedelta(hours=24)
        assert raw not in job.payload_json and raw not in job.encrypted_payload
        assert job.connection_id is None


def test_verification_is_post_single_use_and_does_not_sign_in():
    client, email, uid, raw, tid, jid = pending()
    login = lambda: client.post('/api/auth/login', data={'username': email, 'password': 'password123'})
    assert login().json()['detail']['code'] == 'EMAIL_VERIFICATION_REQUIRED'
    assert not client.cookies
    assert client.get('/api/auth/verify-email', params={'token': raw}).status_code == 405
    assert client.post('/api/auth/verify-email', json={'token': raw}).status_code == 200
    assert not client.cookies
    assert client.post('/api/auth/verify-email', json={'token': raw}).status_code == 400
    with SessionLocal() as db:
        assert db.get(User, uid).email_verified_at is not None
        assert db.get(EmailVerificationToken, tid).consumed_at is not None
        assert db.get(IntegrationOutbox, jid).encrypted_payload is None
    assert login().status_code == 200
    assert client.get('/api/microcycles').status_code == 200
    assert client.get('/api/auth/me').json()['user']['id'] == uid


@pytest.mark.parametrize('raw', ['', 'invalid', 'a' * 43, 'a' * 10000])
def test_invalid_tokens(raw):
    assert TestClient(main.app).post('/api/auth/verify-email', json={'token': raw}).status_code == 400


def test_expired_token_and_concurrent_consumption():
    client, _, _, raw, tid, _ = pending()
    with SessionLocal() as db:
        token = db.get(EmailVerificationToken, tid)
        token.created_at = datetime.utcnow() - timedelta(hours=25)
        token.expires_at = datetime.utcnow() - timedelta(hours=1)
        db.commit()
    assert client.post('/api/auth/verify-email', json={'token': raw}).status_code == 400
    _, _, _, raw, _, _ = pending()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: TestClient(main.app).post('/api/auth/verify-email', json={'token': raw}).status_code, range(4)))
    assert sorted(results) == [200, 400, 400, 400]


def age_latest(uid):
    with SessionLocal() as db:
        token = db.query(EmailVerificationToken).filter_by(user_id=uid).order_by(EmailVerificationToken.created_at.desc()).first()
        token.created_at -= timedelta(seconds=61)
        db.commit()


def test_resend_generic_cooldown_invalidation_and_rolling_limit():
    client, email, uid, raw, tid, jid = pending()
    resend = lambda address: client.post('/api/auth/resend-verification', json={'email': address})
    assert resend(email).json() == resend('absent@example.com').json()
    with SessionLocal() as db:
        assert db.query(EmailVerificationToken).filter_by(user_id=uid).count() == 1
    for _ in range(5):
        age_latest(uid)
        assert resend(email).status_code == 200
    age_latest(uid)
    assert resend(email).status_code == 200
    with SessionLocal() as db:
        assert db.query(EmailVerificationToken).filter_by(user_id=uid, is_resend=True).count() == 5
        assert db.get(EmailVerificationToken, tid).invalidated_at is not None
        assert db.get(IntegrationOutbox, jid).encrypted_payload is None
    assert client.post('/api/auth/verify-email', json={'token': raw}).status_code == 400


def test_concurrent_resends_only_queue_one_replacement():
    _, email, uid, _, _, _ = pending()
    age_latest(uid)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: TestClient(main.app).post('/api/auth/resend-verification', json={'email': email}), range(4)))
    with SessionLocal() as db:
        assert db.query(EmailVerificationToken).filter_by(user_id=uid, is_resend=True).count() == 1


def test_shared_ip_controls_are_atomic():
    with ThreadPoolExecutor(max_workers=8) as pool:
        allowed = list(pool.map(lambda _: allow_auth_attempt('shared-ip', 'test', 5, 60), range(12)))
    assert sum(allowed) == 5
    client = TestClient(main.app)
    for _ in range(20):
        assert client.post('/api/auth/verify-email', json={'token': 'bad'}).status_code == 400
    assert client.post('/api/auth/verify-email', json={'token': 'bad'}).status_code == 429


@pytest.fixture
def email_jobs(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.sqlite'}", connect_args={'check_same_thread': False, 'timeout': 10})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        user = User(id='email-user', email='test@example.com', hashed_password='x', role='ATHLETE')
        db.add(user)
        db.flush()
        queue_verification(db, user)
        db.commit()
    yield factory
    engine.dispose()


def test_email_retry_concurrent_workers_and_payload_cleanup(email_jobs, monkeypatch):
    fake = FakeEmailProvider()
    fake.failures_remaining = 1
    monkeypatch.setattr('backend.email_delivery.email_provider', lambda: fake)
    assert integrations.process_next_outbox_job(email_jobs)
    with email_jobs() as db:
        job = db.query(IntegrationOutbox).one()
        assert job.status == 'failed' and job.retry_after > datetime.utcnow()
        assert job.encrypted_payload
        job.retry_after = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: integrations.process_next_outbox_job(email_jobs), range(4)))
    assert len(fake.messages) == 1
    text, html = fake.messages[0].content()
    assert '24 hours' in text and 'Verify email address' in html
    with email_jobs() as db:
        job = db.query(IntegrationOutbox).one()
        assert job.status == 'success' and job.attempt_count == 2 and job.encrypted_payload is None


def test_terminal_failures_and_superseded_email_never_send(email_jobs, monkeypatch):
    fake = FakeEmailProvider()
    fake.failures_remaining = 3
    monkeypatch.setattr('backend.email_delivery.email_provider', lambda: fake)
    for _ in range(3):
        assert integrations.process_next_outbox_job(email_jobs)
        with email_jobs() as db:
            job = db.query(IntegrationOutbox).one()
            if job.attempt_count < 3:
                job.retry_after = datetime.utcnow() - timedelta(seconds=1)
                db.commit()
    assert not integrations.process_next_outbox_job(email_jobs)
    with email_jobs() as db:
        assert db.query(IntegrationOutbox).one().encrypted_payload is None
        queue_verification(db, db.get(User, 'email-user'), resend=True)
        db.commit()
        queue_verification(db, db.get(User, 'email-user'), resend=True)
        db.commit()
    assert integrations.process_next_outbox_job(email_jobs)
    assert not integrations.process_next_outbox_job(email_jobs)
    assert len(fake.messages) == 1


def test_real_provider_sanitizes_errors_and_sends_both_formats(monkeypatch):
    seen = []
    monkeypatch.setenv('EMAIL_PROVIDER_API_KEY', 'test-key')
    monkeypatch.setattr('backend.email_delivery.requests.post', lambda *a, **kw: seen.append(kw) or type('R', (), {'status_code': 429})())
    with pytest.raises(EmailDeliveryError) as err:
        ResendEmailProvider().send(VerificationMessage('test@example.com', 'https://example.com/#token=sensitive'), 'job-id')
    assert 'sensitive' not in str(err.value)
    assert seen[0]['headers']['Idempotency-Key'] == 'job-id'
    assert seen[0]['json']['html'] and seen[0]['json']['text']


def test_google_collision_retires_pending_identity_without_merging(monkeypatch):
    _, email, old_uid, raw, _, _ = pending()
    monkeypatch.setenv('GOOGLE_CLIENT_ID', 'test-client')
    sub = uuid.uuid4().hex
    monkeypatch.setattr(main, 'verify_google_id_token', lambda *_: {'sub': sub, 'email': email, 'email_verified': True})
    client = TestClient(main.app)
    response = client.post('/api/auth/google', json={'token': 'verified-google-token'})
    assert response.status_code == 200
    assert response.json()['user']['id'] != old_uid
    with SessionLocal() as db:
        old = db.get(User, old_uid)
        assert old.deleted_at and old.google_sub is None
        new = db.get(User, response.json()['user']['id'])
        assert new.google_sub == sub and new.email_verified_at
    assert TestClient(main.app).post('/api/auth/login', data={'username': email, 'password': 'password123'}).status_code == 400
    assert TestClient(main.app).post('/api/auth/verify-email', json={'token': raw}).status_code == 400
    assert client.post('/api/auth/google', json={'token': 'verified-google-token'}).json()['user']['id'] == response.json()['user']['id']


def test_existing_session_cannot_bypass_verification_and_coach_link_is_blocked():
    _, email, uid, _, _, _ = pending()
    with SessionLocal() as db:
        sid = uuid.uuid4().hex
        db.add(AuthSession(id=sid, user_id=uid, jwt_id=sid, expires_at=datetime.utcnow() + timedelta(days=1)))
        db.commit()
    token = main.create_access_token({'sub': uid, 'session_id': sid})
    client = TestClient(main.app)
    client.headers['Authorization'] = f'Bearer {token}'
    for path in ['/api/microcycles', '/api/account/access', '/api/auth/me']:
        assert client.get(path).json()['detail']['code'] == 'EMAIL_VERIFICATION_REQUIRED'
    assert client.post('/api/auth/coach-code').status_code == 403
    assert client.post('/api/auth/link', json={'code': 'some-code'}).status_code == 403


def test_telegram_session_webhook_and_stale_link_tokens_are_blocked(monkeypatch):
    _, _, uid, _, _, _ = pending()
    external = uuid.uuid4().hex
    monkeypatch.setattr(integrations, 'verify_telegram_init_data', lambda *_: {'id': external})
    monkeypatch.setattr(integrations, 'TELEGRAM_WEBHOOK_SECRET', 'test-secret')
    sent = []
    monkeypatch.setattr(integrations, 'send_telegram_message', lambda *args: sent.append(args))
    with SessionLocal() as db:
        db.add(IntegrationConnection(id=uuid.uuid4().hex, provider='telegram', user_id=uid, external_account_id=external, status='active'))
        db.commit()
    client = TestClient(main.app)
    assert client.post('/api/integrations/telegram/miniapp/session', json={'initData': 'signed'}).status_code == 403
    assert not client.cookies
    for command in ['/today', '/done', '/status']:
        response = client.post('/api/integrations/telegram/webhook', headers={'X-Telegram-Bot-Api-Secret-Token': 'test-secret'},
            json={'update_id': uuid.uuid4().hex, 'message': {'text': command, 'from': {'id': external}, 'chat': {'id': 1}}})
        assert response.status_code == 403
    link = uuid.uuid4().hex
    integrations.PENDING_LINK_TOKENS[link] = {'user_id': uid, 'expires_at': datetime.utcnow() + timedelta(minutes=5)}
    assert client.post('/api/integrations/telegram/miniapp/session', json={'initData': 'signed', 'linkToken': link}).status_code == 403
    assert not sent


def test_flags_do_not_retroactively_exempt_pending_accounts(monkeypatch):
    _, _, uid, _, _, _ = pending()
    with SessionLocal() as db:
        user = db.get(User, uid)
        monkeypatch.setenv('EMAIL_VERIFICATION_NEW_ACCOUNTS', 'false')
        assert requires_verification(user)
        user.email_verification_legacy_exempt = True
        assert not requires_verification(user)
        monkeypatch.setenv('EMAIL_VERIFICATION_ENFORCE_LEGACY', 'true')
        assert requires_verification(user)


@pytest.mark.parametrize('legacy', [False, True], ids=['verified', 'legacy-exempt'])
def test_telegram_preserves_eligible_sessions_and_webhook_training(monkeypatch, legacy):
    from backend.test_auth import _signed_telegram_init_data
    monkeypatch.setenv('EMAIL_VERIFICATION_ENFORCE_LEGACY', 'false')
    client = TestClient(main.app)
    email = f'telegram-compatible-{uuid.uuid4().hex}@example.com'
    identity = register_verified(client, json={'email': email, 'password': 'password123'}).json()['user']
    uid = identity['id']
    external = int(uuid.uuid4().hex[:10], 16)
    bot_token = '123456789:staging-test-only-bot-token'
    monkeypatch.setattr(integrations, 'TELEGRAM_BOT_TOKEN', bot_token)
    monkeypatch.setattr(integrations, 'TELEGRAM_WEBHOOK_SECRET', 'staging-test-secret')
    sent = []
    monkeypatch.setattr(integrations, 'send_telegram_message', lambda *args: sent.append(args))
    with SessionLocal() as db:
        user = db.get(User, uid)
        if legacy:
            user.email_verified_at = None
            user.email_verification_legacy_exempt = True
        db.add(IntegrationConnection(id=uuid.uuid4().hex, provider='telegram', user_id=uid,
                                    external_account_id=str(external), status='active'))
        db.commit()
    # The password session issued before the historical-status change survives.
    assert client.get('/api/auth/me').status_code == 200
    session = TestClient(main.app).post('/api/integrations/telegram/miniapp/session',
        json={'initData': _signed_telegram_init_data(bot_token, external)})
    assert session.status_code == 200 and 'session_id' in session.cookies
    workout = client.post('/api/sessions', json={
        'date': datetime.utcnow().strftime('%Y-%m-%d'), 'title': 'Telegram compatibility'}).json()
    for command in ['/today', '/done', '/status']:
        response = client.post('/api/integrations/telegram/webhook',
            headers={'X-Telegram-Bot-Api-Secret-Token': 'staging-test-secret'},
            json={'update_id': uuid.uuid4().hex, 'message': {'text': command,
                  'from': {'id': external}, 'chat': {'id': external}}})
        assert response.status_code == 200
    assert len(sent) == 3
    with SessionLocal() as db:
        assert db.get(Workout, workout['id']).status == 'COMPLETED'
        if legacy:
            assert db.get(User, uid).email_verified_at is None
    if legacy:
        monkeypatch.setenv('EMAIL_VERIFICATION_ENFORCE_LEGACY', 'true')
        assert client.get('/api/auth/me').status_code == 403
        assert TestClient(main.app).post('/api/integrations/telegram/miniapp/session',
            json={'initData': _signed_telegram_init_data(bot_token, external)}).status_code == 403
        monkeypatch.setenv('EMAIL_VERIFICATION_ENFORCE_LEGACY', 'false')
        assert client.get('/api/auth/me').status_code == 200


def test_verification_token_does_not_appear_in_application_logs(capsys, caplog):
    client, _, _, raw, _, _ = pending()
    response = client.post('/api/auth/verify-email', json={'token': raw})
    assert response.status_code == 200
    repeated = client.post('/api/auth/verify-email', json={'token': raw})
    assert repeated.status_code == 400
    captured = capsys.readouterr()
    assert raw not in captured.out + captured.err + caplog.text + response.text + repeated.text


def test_production_requires_real_delivery_configuration(monkeypatch):
    from backend.runtime_config import validate_email_settings
    monkeypatch.setenv('APP_ENV', 'production')
    with pytest.raises(RuntimeError, match='EMAIL_PROVIDER'):
        validate_email_settings()
    monkeypatch.setenv('EMAIL_PROVIDER', 'resend')
    monkeypatch.delenv('EMAIL_PROVIDER_API_KEY', raising=False)
    with pytest.raises(RuntimeError, match='EMAIL_PROVIDER_API_KEY'):
        validate_email_settings()


def test_pausing_new_registrations_cannot_remove_pending_account_recovery(monkeypatch):
    from backend.runtime_config import validate_email_settings
    pending()
    monkeypatch.setenv('EMAIL_VERIFICATION_NEW_ACCOUNTS', 'false')
    monkeypatch.setenv('EMAIL_VERIFICATION_ENFORCE_LEGACY', 'false')
    monkeypatch.delenv('EMAIL_PAYLOAD_ENCRYPTION_KEY')
    validate_email_settings()
    with pytest.raises(RuntimeError, match='EMAIL_PAYLOAD_ENCRYPTION_KEY'):
        validate_email_settings(pending_accounts=True)
    with pytest.raises(RuntimeError, match='EMAIL_PAYLOAD_ENCRYPTION_KEY'):
        main.on_startup()


def test_account_token_and_job_roll_back_together(monkeypatch):
    email = f'rollback-{uuid.uuid4().hex}@example.com'
    monkeypatch.setattr('backend.email_verification.email_payload_key', lambda: (_ for _ in ()).throw(RuntimeError('unavailable key')))
    response = TestClient(main.app, raise_server_exceptions=False).post('/api/auth/register', json={'email': email, 'password': 'password123'})
    assert response.status_code == 500
    with SessionLocal() as db:
        assert db.query(User).filter_by(email=email).count() == 0


def test_pending_coach_cannot_be_linked_by_a_verified_athlete():
    from backend.test_support import register_verified
    coach_client = TestClient(main.app)
    response = register_coach(coach_client, f'coach-{uuid.uuid4().hex}@example.com')
    code = coach_client.post('/api/auth/coach-code').json()['code']
    with SessionLocal() as db:
        db.get(User, response.json()['user']['id']).email_verified_at = None
        db.commit()
    athlete_client = TestClient(main.app)
    register_verified(athlete_client, json={'email': f'athlete-{uuid.uuid4().hex}@example.com', 'password': 'password123'})
    assert athlete_client.post('/api/auth/link', json={'code': code}).json()['detail']['code'] == 'EMAIL_VERIFICATION_REQUIRED'


def test_expired_or_abandoned_email_jobs_erase_ciphertext(email_jobs):
    with email_jobs() as db:
        token = db.query(EmailVerificationToken).one()
        token.created_at = datetime.utcnow() - timedelta(hours=25)
        token.expires_at = datetime.utcnow() - timedelta(hours=1)
        db.commit()
    assert not integrations.process_next_outbox_job(email_jobs)
    with email_jobs() as db:
        assert db.query(IntegrationOutbox).one().encrypted_payload is None

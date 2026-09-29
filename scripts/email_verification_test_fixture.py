"""Local test-only identity provisioning and protected-token retrieval over stdin."""
import json
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
path = Path(os.environ['E2E_TEST_DATABASE']).resolve()
if path.name != 'adaptive-email-verification-e2e.sqlite' or os.environ.get('APP_ENV') != 'test':
    raise RuntimeError('Only the isolated Playwright database is supported')
os.environ['DATABASE_URL'] = 'sqlite:///' + path.as_posix()
from backend.database import SessionLocal, User, IntegrationOutbox, EmailVerificationToken
from backend.main import get_password_hash
from cryptography.fernet import Fernet

request = json.load(sys.stdin)
with SessionLocal() as db:
    if request['action'] == 'token':
        user = db.query(User).filter_by(email=request['email']).one()
        token = db.query(EmailVerificationToken).filter_by(user_id=user.id, consumed_at=None, invalidated_at=None).one()
        job = db.query(IntegrationOutbox).filter_by(verification_token_id=token.id).one()
        print(Fernet(os.environ['EMAIL_PAYLOAD_ENCRYPTION_KEY'].encode()).decrypt(job.encrypted_payload.encode()).decode())
    elif request['action'] == 'register':
        # Each unrelated browser fixture starts with an isolated rate window.
        # Production throttling remains enabled and is covered by API tests.
        from backend.database import AuthSecurityEvent, AuthSecuritySubject
        db.query(AuthSecurityEvent).delete()
        db.query(AuthSecuritySubject).delete()
        data = request['data']
        user = User(id=str(uuid.uuid4()), email=data['email'].strip().lower(), role='ATHLETE',
                    hashed_password=get_password_hash(data['password']), email_verified_at=datetime.utcnow())
        db.add(user)
        db.commit()
        if data.get('role') == 'COACH':
            from backend.manage_user import promote_coach, grant_coach_access
            promote_coach(user.email)
            grant_coach_access(user.email, 'coach_beta', no_expiry=True, reason='isolated-e2e-fixture')
    else:
        raise RuntimeError('Unknown test fixture action')

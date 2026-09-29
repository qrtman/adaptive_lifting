"""Email verification policy and transactional token/outbox lifecycle."""
import hashlib
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import update, func

from .database import EmailVerificationToken, IntegrationOutbox, User
from .runtime_config import email_payload_key, legacy_email_verification_enabled

GENERIC_MESSAGE = {"message": "If this address is eligible, a verification email will arrive shortly. Verify your email, then sign in."}


def requires_verification(user):
    if user.email_verified_at is not None or user.google_sub is not None:
        return False
    if user.email_verification_legacy_exempt:
        return legacy_email_verification_enabled()
    return bool(user.email_verification_required)


def require_eligible_account(user):
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=403, detail="This account is unavailable")
    if requires_verification(user):
        raise HTTPException(status_code=403, detail={"code": "EMAIL_VERIFICATION_REQUIRED",
                                                    "message": "Verify your email before signing in."})


def lock_user(db, user_id):
    # A real write acquires a PostgreSQL row lock and SQLite's writer lock.
    # All token replacement, consumption and delivery use this same lock.
    db.execute(update(User).where(User.id == user_id).values(updated_at=User.updated_at))
    db.expire_all()
    return db.get(User, user_id)


def cancel_pending_tokens(db, user_id, now):
    ids = [row.id for row in db.query(EmailVerificationToken).filter_by(user_id=user_id)
           .filter(EmailVerificationToken.consumed_at.is_(None), EmailVerificationToken.invalidated_at.is_(None)).all()]
    if not ids:
        return
    db.query(EmailVerificationToken).filter(EmailVerificationToken.id.in_(ids)).update(
        {EmailVerificationToken.invalidated_at: now}, synchronize_session=False)
    db.query(IntegrationOutbox).filter(IntegrationOutbox.verification_token_id.in_(ids)).update(
        {IntegrationOutbox.encrypted_payload: None, IntegrationOutbox.status: "cancelled",
         IntegrationOutbox.retry_after: None}, synchronize_session=False)


def queue_verification(db, user, *, resend=False, now=None):
    """Caller holds the user lock; caller commits account, token and job together."""
    now = now or datetime.utcnow()
    cancel_pending_tokens(db, user.id, now)
    raw = secrets.token_urlsafe(32)  # exactly 32 CSPRNG bytes, 43 URL-safe characters
    token = EmailVerificationToken(id=str(uuid.uuid4()), user_id=user.id,
        token_hash=hashlib.sha256(raw.encode("ascii")).hexdigest(), created_at=now,
        expires_at=now + timedelta(hours=24), is_resend=resend)
    db.add(token)
    db.flush()
    ciphertext = Fernet(email_payload_key()).encrypt(raw.encode("ascii")).decode("ascii")
    db.add(IntegrationOutbox(id=str(uuid.uuid4()), provider="email-verification", connection_id=None,
        payload_json="{}", encrypted_payload=ciphertext, verification_token_id=token.id,
        status="queued", attempt_count=0))


def resend_verification(db, email):
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is None:
        return
    user = lock_user(db, user.id)
    if user.deleted_at is not None or not requires_verification(user):
        return
    now = datetime.utcnow()
    tokens = db.query(EmailVerificationToken).filter_by(user_id=user.id)
    latest = tokens.order_by(EmailVerificationToken.created_at.desc()).first()
    if latest and latest.created_at > now - timedelta(seconds=60):
        return
    count = tokens.filter(EmailVerificationToken.is_resend.is_(True),
                          EmailVerificationToken.created_at > now - timedelta(hours=24)).count()
    if count >= 5:
        return
    queue_verification(db, user, resend=True, now=now)


def consume_verification(db, raw):
    invalid = HTTPException(status_code=400, detail={"code": "INVALID_VERIFICATION_TOKEN",
                                                    "message": "This verification link is invalid or expired. Request a new email."})
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", raw):
        raise invalid
    hashed = hashlib.sha256(raw.encode("ascii")).hexdigest()
    token = db.query(EmailVerificationToken).filter_by(token_hash=hashed).first()
    if token is None:
        raise invalid
    user = lock_user(db, token.user_id)
    if user is None or user.deleted_at is not None or user.google_sub is not None:
        raise invalid
    now = datetime.utcnow()
    consumed = db.query(EmailVerificationToken).filter_by(token_hash=hashed).filter(
        EmailVerificationToken.consumed_at.is_(None), EmailVerificationToken.invalidated_at.is_(None),
        EmailVerificationToken.expires_at > now).update({EmailVerificationToken.consumed_at: now}, synchronize_session=False)
    if consumed != 1:
        raise invalid
    user.email_verified_at = now
    db.query(IntegrationOutbox).filter_by(verification_token_id=token.id).update(
        {IntegrationOutbox.encrypted_payload: None, IntegrationOutbox.status: "cancelled",
         IntegrationOutbox.retry_after: None}, synchronize_session=False)
    db.commit()


def process_email_job(job, db):
    from .email_delivery import EmailDeliveryError, VerificationMessage, email_provider
    token = db.get(EmailVerificationToken, job.verification_token_id)
    if token is None:
        job.status, job.encrypted_payload = "cancelled", None
        return True
    user = lock_user(db, token.user_id)
    # Re-read the job after obtaining the lock: a resend may have cancelled it.
    db.refresh(job)
    db.refresh(token)
    if job.status != "processing":
        return True
    if (user is None or user.deleted_at is not None or
            user.email_verified_at is not None or token.consumed_at is not None or
            token.invalidated_at is not None or token.expires_at <= datetime.utcnow()):
        job.status, job.encrypted_payload = "cancelled", None
        return True
    try:
        raw = Fernet(email_payload_key()).decrypt(job.encrypted_payload.encode("ascii")).decode("ascii")
        url = os.environ["APP_URL"].rstrip("/") + "/verify-email#token=" + raw
        # Holding the account lock across this bounded call serializes delivery
        # with resend. The provider idempotency key also covers crash recovery.
        email_provider().send(VerificationMessage(user.email, url), job.id)
    except EmailDeliveryError as exc:
        job.status, job.result = "failed", str(exc)
        if not exc.temporary:
            job.attempt_count = 3
        return False
    except Exception:
        job.status, job.result, job.attempt_count = "failed", "Email delivery configuration or payload error", 3
        return False
    job.status, job.result, job.encrypted_payload = "success", "Verification email accepted", None
    return True

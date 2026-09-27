"""Account-bound prepaid vouchers. Redemption creates ordinary AccessGrants."""

import hashlib
import hmac
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, update

from .database import AccessGrant, AuditEvent, User, Voucher, Workspace
from .entitlements import PLAN_CONFIG, SUBSCRIPTION_PLAN_KEYS
from .runtime_config import voucher_secret_bytes
from .workspaces import ensure_default_workspace_for_coach

VOUCHER_SOURCE = "offline_payment"
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 32 symbols, 100 random bits
_CODE_PATTERN = re.compile(r"VCH-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}\Z")


class VoucherInvalid(ValueError):
    pass


class VoucherConfigurationError(RuntimeError):
    pass


def _utc_naive(value):
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _secret():
    try:
        return voucher_secret_bytes()
    except RuntimeError as exc:
        raise VoucherConfigurationError(str(exc)) from exc


def normalize_code(code):
    if not isinstance(code, str):
        raise VoucherInvalid("Voucher is invalid or no longer available")
    normalized = code.strip().upper()
    if not _CODE_PATTERN.fullmatch(normalized):
        raise VoucherInvalid("Voucher is invalid or no longer available")
    return normalized


def hash_code(code):
    return hmac.new(_secret(), normalize_code(code).encode("ascii"), hashlib.sha256).hexdigest()


def _audit(db, voucher, event_type, actor_user_id=None):
    db.add(AuditEvent(
        id=str(uuid.uuid4()), actor_user_id=actor_user_id,
        event_type=event_type, resource_type="Voucher", resource_id=voucher.id,
        metadata_json=json.dumps({
            "voucher_id": voucher.id, "plan_key": voucher.plan_key,
            "duration_days": voucher.duration_days,
            "assigned_user_id": voucher.assigned_user_id,
            "payment_reference": voucher.payment_reference,
        }),
    ))


def _generate_code():
    groups = ["".join(secrets.choice(_ALPHABET) for _ in range(5)) for _ in range(4)]
    return "VCH-" + "-".join(groups)


def create_voucher(db, *, assigned_user, plan_key, duration_days, payment_reference=None,
                   voucher_expires_at=None, notes=None, created_by_user_id=None, now=None):
    """Flush a voucher and return (row, one-time plaintext). Caller commits."""
    if plan_key not in SUBSCRIPTION_PLAN_KEYS or plan_key not in PLAN_CONFIG:
        raise ValueError("Voucher plan must be a paid coaching plan")
    if not isinstance(duration_days, int) or isinstance(duration_days, bool) or duration_days <= 0:
        raise ValueError("Voucher duration must be a positive number of days")
    if assigned_user is None or assigned_user.role != "COACH" or not assigned_user.id:
        raise ValueError("Voucher must be assigned to an existing coach account")
    if payment_reference is not None and len(payment_reference) > 120:
        raise ValueError("Payment reference is too long")
    if notes is not None and len(notes) > 500:
        raise ValueError("Voucher notes are too long")
    now = _utc_naive(now or datetime.utcnow())
    deadline = _utc_naive(voucher_expires_at)
    if deadline is not None and deadline <= now:
        raise ValueError("Voucher redemption deadline must be in the future")
    code = _generate_code()
    row = Voucher(
        id=str(uuid.uuid4()), code_hash=hash_code(code),
        code_prefix="VCH-" + code.split("-")[1][:4],
        plan_key=plan_key, duration_days=duration_days,
        source=VOUCHER_SOURCE, assigned_user_id=assigned_user.id,
        payment_reference=payment_reference, expires_at=deadline,
        created_by_user_id=created_by_user_id, created_at=now, notes=notes,
    )
    db.add(row)
    db.flush()
    _audit(db, row, "VOUCHER_CREATED", created_by_user_id)
    db.flush()
    return row, code


def inspect_voucher(db, code):
    return db.query(Voucher).filter_by(code_hash=hash_code(code)).one_or_none()


def revoke_voucher(db, code, *, now=None, actor_user_id=None):
    row = inspect_voucher(db, code)
    if row is None:
        raise VoucherInvalid("Voucher not found")
    if row.redeemed_at is not None:
        raise ValueError("Voucher has already been redeemed; revoke the resulting access grant separately if needed.")
    if row.revoked_at is not None:
        return row
    now = _utc_naive(now or datetime.utcnow())
    claimed = db.execute(update(Voucher).where(
        Voucher.id == row.id, Voucher.redeemed_at.is_(None), Voucher.revoked_at.is_(None),
    ).values(revoked_at=now)).rowcount
    if claimed != 1:
        raise VoucherInvalid("Voucher state changed; inspect it again")
    row.revoked_at = now
    _audit(db, row, "VOUCHER_REVOKED", actor_user_id)
    db.flush()
    return row


def redeem_voucher(db, *, code, user, now=None):
    """Claim once, append a paid grant, and audit in the caller's transaction."""
    if user is None or user.role != "COACH":
        raise PermissionError("VOUCHER_COACH_ACCOUNT_REQUIRED")
    now = _utc_naive(now or datetime.utcnow())
    row = inspect_voucher(db, code)
    if (row is None or row.assigned_user_id != user.id or row.source != VOUCHER_SOURCE or
            row.plan_key not in SUBSCRIPTION_PLAN_KEYS or row.plan_key not in PLAN_CONFIG or
            row.duration_days <= 0):
        raise VoucherInvalid("Voucher is invalid or no longer available")

    # The conditional write is the cross-database claim. PostgreSQL waits on
    # this row; SQLite serializes writers. A losing transaction creates no grant.
    claimed = db.execute(update(Voucher).where(
        Voucher.id == row.id,
        Voucher.assigned_user_id == user.id,
        Voucher.redeemed_at.is_(None),
        Voucher.revoked_at.is_(None),
        or_(Voucher.expires_at.is_(None), Voucher.expires_at > now),
    ).values(redeemed_at=now, redeemed_by_user_id=user.id)).rowcount
    if claimed != 1:
        raise VoucherInvalid("Voucher is invalid or no longer available")

    # Lock the owner before lazy workspace creation. Two different vouchers
    # redeemed for a new coach cannot race to insert the same workspace.
    if db.execute(update(User).where(User.id == user.id, User.role == "COACH").values(updated_at=now)).rowcount != 1:
        raise VoucherInvalid("Voucher is invalid or no longer available")
    workspace = ensure_default_workspace_for_coach(db, user)
    # Serialize redemptions of *different* vouchers for this workspace too,
    # so same-plan stacking always sees the latest committed grant expiry.
    db.execute(update(Workspace).where(Workspace.id == workspace.id).values(updated_at=now))
    latest = db.query(AccessGrant).filter(
        AccessGrant.workspace_id == workspace.id,
        AccessGrant.source == VOUCHER_SOURCE,
        AccessGrant.plan_key == row.plan_key,
        AccessGrant.revoked_at.is_(None),
        AccessGrant.expires_at > now,
    ).order_by(AccessGrant.expires_at.desc(), AccessGrant.id).first()
    starts_at = latest.expires_at if latest is not None else now
    expires_at = starts_at + timedelta(days=row.duration_days)
    grant = AccessGrant(
        id=str(uuid.uuid4()), workspace_id=workspace.id,
        plan_key=row.plan_key, source=VOUCHER_SOURCE,
        starts_at=starts_at, expires_at=expires_at,
        reason=f"voucher:{row.id}", created_by_user_id=row.created_by_user_id,
    )
    db.add(grant)
    db.flush()
    row.redeemed_at = now
    row.redeemed_by_user_id = user.id
    _audit(db, row, "VOUCHER_REDEEMED", user.id)
    db.add(AuditEvent(
        id=str(uuid.uuid4()), actor_user_id=user.id,
        event_type="ACCESS_GRANTED", resource_type="AccessGrant", resource_id=grant.id,
        metadata_json=json.dumps({"plan_key": row.plan_key, "source": VOUCHER_SOURCE,
                                  "expires_at": expires_at.isoformat(), "reason": grant.reason}),
    ))
    db.flush()
    return row, grant

"""Optional signed, bounded authorization for offline browser reloads."""
import os
from datetime import datetime, timedelta
import jwt
from .database import CoachingRelationship
from .email_verification import require_eligible_account


def issue_offline_grant(db, user, session):
    key = os.environ.get("OFFLINE_AUTH_PRIVATE_KEY", "").replace("\\n", "\n")
    if not key:
        return None
    require_eligible_account(user)
    now = datetime.utcnow()
    scopes = [user.id]
    if user.role == "COACH":
        scopes += [row.athlete_id for row in db.query(CoachingRelationship).filter_by(
            coach_id=user.id, ended_at=None, deleted_at=None).all()]
    return jwt.encode({"iss": "adaptive-lifting", "aud": "adaptive-lifting-offline",
        "iat": now, "exp": min(session.expires_at, now + timedelta(hours=24)),
        "sub": user.id, "sid": session.id, "scopes": scopes,
        "user": {"id": user.id, "email": user.email, "role": user.role, "displayName": user.display_name}},
        key, algorithm="ES256")

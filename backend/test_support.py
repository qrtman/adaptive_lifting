"""Shared API test helpers that follow server-controlled role assignment."""

from backend.manage_user import grant_coach_access, promote_coach


def register_coach(client, email, *, with_access=True, plan="coach_beta"):
    response = register_verified(client,
        json={"email": email, "password": "password123"},
    )
    assert response.status_code == 200
    if with_access:
        assert promote_coach(email) == 0
        assert grant_coach_access(email, plan, no_expiry=True, reason="test-fixture") == 0
    else:
        assert promote_coach(email) == 0
    client.cookies.clear()
    login = client.post(
        "/api/auth/login",
        data={"username": email, "password": "password123"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "COACH"
    return login


def register_verified(client, *, json):
    """Provision a verified identity for unrelated training/RBAC tests."""
    import uuid
    from datetime import datetime
    from backend.database import SessionLocal, User
    from backend.main import get_password_hash
    email = json["email"].strip().lower()
    with SessionLocal() as db:
        db.add(User(id=str(uuid.uuid4()), email=email, hashed_password=get_password_hash(json["password"]),
                    role="ATHLETE", email_verified_at=datetime.utcnow(), email_verification_required=True))
        db.commit()
    response = client.post("/api/auth/login", data={"username": email, "password": json["password"]})
    assert response.status_code == 200, response.text
    return response

"""Shared API test helpers that follow server-controlled role assignment."""

from backend.manage_user import grant_coach_access, promote_coach


def register_coach(client, email, *, with_access=True, plan="coach_beta"):
    response = client.post(
        "/api/auth/register",
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

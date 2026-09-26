import asyncio
import hashlib
import hmac
import json
import sys
from types import ModuleType
import time
import uuid
import urllib.parse
from datetime import datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from backend.database import AuditEvent, CoachingRelationship, DomainEvent, IntegrationConnection, Session as AuthSession, SessionLocal, User, Workout
from backend import main as auth_main
from backend.main import app
from backend.sse_broadcaster import get_events
from backend import sse_broadcaster
from backend import integrations as telegram_integrations


def test_register_and_login_set_session_cookie():
    client = TestClient(app)
    email = f"coach-{uuid.uuid4().hex[:10]}@example.com"
    register_response = client.post(
        "/api/auth/register",
        json={"email": f"  {email.upper()}  ", "password": "password123", "role": "COACH"},
    )
    assert register_response.status_code == 200
    assert register_response.json()["user"]["role"] == "ATHLETE"
    assert register_response.json()["user"]["email"] == email
    assert "session_id" in register_response.cookies

    login_response = client.post(
        "/api/auth/login",
        data={"username": f"  {email.upper()} ", "password": "password123"},
    )
    assert login_response.status_code == 200
    assert "session_id" in login_response.cookies
    assert login_response.cookies.get("session_id")


def _google_claims(subject="google-subject-1", email="google-user@example.com", verified=True):
    return {
        "sub": subject,
        "email": email,
        "email_verified": verified,
        "iss": "https://accounts.google.com",
        "aud": "test-google-client-id",
        "exp": 4_102_444_800,
    }


def test_google_login_verifies_id_token_and_creates_athlete(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
    subject = f"google-subject-{uuid.uuid4().hex}"
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: _google_claims(subject=subject))
    response = TestClient(app).post(
        "/api/auth/google", json={"token": "valid-id-token", "role": "ATHLETE", "email": "attacker@example.com"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "google-user@example.com"
    assert response.json()["user"]["role"] == "ATHLETE"
    assert response.cookies.get("session_id")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.google_sub == subject).one()
        assert user.email == "google-user@example.com"
        assert user.role == "ATHLETE"
    finally:
        db.close()


def test_google_login_preserves_existing_google_linked_coach(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
    subject = f"google-coach-subject-{uuid.uuid4().hex}"
    email = f"google-coach-{uuid.uuid4().hex}@example.com"
    db = SessionLocal()
    try:
        user = User(id=str(uuid.uuid4()), email=email, hashed_password="x", role="COACH", google_sub=subject)
        db.add(user)
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: _google_claims(subject=subject, email=email))

    response = TestClient(app).post("/api/auth/google", json={"token": "valid-id-token"})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "COACH"


def test_google_login_links_existing_user_only_with_verified_google_email(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
    user_id = str(uuid.uuid4())
    email = f"google-existing-{uuid.uuid4().hex}@example.com"
    db = SessionLocal()
    try:
        db.add(User(id=user_id, email=email, hashed_password=auth_main.get_password_hash("password123"), role="ATHLETE"))
        db.commit()
    finally:
        db.close()
    subject = f"google-existing-subject-{uuid.uuid4().hex}"
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: _google_claims(subject=subject, email=email))
    client = TestClient(app)
    assert client.post("/api/auth/google", json={"token": "valid-id-token"}).status_code == 409
    assert client.post("/api/auth/login", data={"username": email, "password": "password123"}).status_code == 200
    response = client.post("/api/auth/google", json={"token": "valid-id-token"})
    assert response.status_code == 200
    assert response.json()["user"]["id"] == user_id
    db = SessionLocal()
    try:
        assert db.query(User).filter(User.id == user_id).one().google_sub == subject
    finally:
        db.close()


def test_google_login_rejects_unverified_email_and_deleted_account(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: _google_claims(verified=False))
    client = TestClient(app)
    assert client.post("/api/auth/google", json={"token": "valid-signature-unverified-email"}).status_code == 401

    user_id = str(uuid.uuid4())
    email = f"google-deleted-{uuid.uuid4().hex}@example.com"
    db = SessionLocal()
    try:
        db.add(User(id=user_id, email=email, hashed_password="password-hash", role="ATHLETE", deleted_at=datetime.utcnow()))
        db.commit()
    finally:
        db.close()
    subject = f"google-deleted-subject-{uuid.uuid4().hex}"
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: _google_claims(subject=subject, email=email))
    assert client.post("/api/auth/google", json={"token": "valid-token"}).status_code == 403


def test_google_login_rejects_duplicate_subject_and_mock_token(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
    email = f"google-conflict-{uuid.uuid4().hex}@example.com"
    subject = f"google-existing-subject-{uuid.uuid4().hex}"
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: _google_claims(subject=f"incoming-{subject}", email=email))
    db = SessionLocal()
    try:
        db.add(User(id=str(uuid.uuid4()), email=email, hashed_password="x", role="COACH", google_sub=subject))
        db.commit()
    finally:
        db.close()
    client = TestClient(app)
    response = client.post("/api/auth/google", json={"token": "valid-token"})
    assert response.status_code == 409
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id: (_ for _ in ()).throw(ValueError("invalid token")))
    assert client.post("/api/auth/google", json={"token": "mock_google_token_google-user"}).status_code == 401


def test_google_login_requires_configuration_and_rejects_invalid_token_categories(monkeypatch):
    client = TestClient(app)
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.setattr(auth_main, "verify_google_id_token", lambda *args: (_ for _ in ()).throw(AssertionError("must not verify without config")))
    missing = client.post("/api/auth/google", json={"token": "anything"})
    assert missing.status_code == 503
    assert "GOOGLE_CLIENT_ID" in missing.json()["detail"]

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
    for category in ("bad signature", "wrong audience", "expired"):
        monkeypatch.setattr(auth_main, "verify_google_id_token", lambda token, client_id, category=category: (_ for _ in ()).throw(ValueError(category)))
        assert client.post("/api/auth/google", json={"token": f"invalid-{category}"}).status_code == 401


def test_google_login_calls_google_auth_verifier_with_server_audience(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "server-client-id")
    google = ModuleType("google")
    google.__path__ = []
    auth = ModuleType("google.auth")
    auth.__path__ = []
    transport = ModuleType("google.auth.transport")
    transport.__path__ = []
    transport_requests = ModuleType("google.auth.transport.requests")
    transport_requests.Request = lambda: "google-verification-request"
    oauth2 = ModuleType("google.oauth2")
    oauth2.__path__ = []
    id_token = ModuleType("google.oauth2.id_token")
    calls = []
    test_email = f"google-wrapper-{uuid.uuid4().hex}@example.com"

    def google_verifier(token, request, audience):
        calls.append((token, request, audience))
        if token in {"forged-signature", "wrong-audience", "expired-token"}:
            raise ValueError("Google rejected token")
        return _google_claims(subject=f"verified-{uuid.uuid4().hex}", email=test_email)

    id_token.verify_oauth2_token = google_verifier
    for name, module in {
        "google": google,
        "google.auth": auth,
        "google.auth.transport": transport,
        "google.auth.transport.requests": transport_requests,
        "google.oauth2": oauth2,
        "google.oauth2.id_token": id_token,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)

    client = TestClient(app)
    valid = client.post("/api/auth/google", json={"token": "cryptographically-verified-by-library"})
    assert valid.status_code == 200
    for token in ("forged-signature", "wrong-audience", "expired-token"):
        assert client.post("/api/auth/google", json={"token": token}).status_code == 401
    assert all(call[1] == "google-verification-request" for call in calls)
    assert all(call[2] == "server-client-id" for call in calls)


def _register_auth_user(client, prefix="auth"):
    email = f"{prefix}-{uuid.uuid4().hex}@example.com"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123"},
    )
    assert response.status_code == 200
    return response.json()["user"]["id"], response.cookies.get("session_id")


def _register_coach(client, email):
    registered = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert registered.status_code == 200
    from backend.manage_user import promote_coach
    assert promote_coach(email) == 0
    client.cookies.clear()
    return client.post("/api/auth/login", data={"username": email, "password": "password123"})


def test_registration_role_is_server_controlled_and_cli_promotes_after_reauthentication(capsys):
    from backend.manage_user import main as manage_user_main

    client = TestClient(app)
    email = f"manual-coach-{uuid.uuid4().hex}@example.com"
    created = client.post("/api/auth/register", json={
        "email": email,
        "password": "password123",
        "role": "COACH",
    })
    assert created.status_code == 200
    assert created.json()["user"]["role"] == "ATHLETE"
    assert client.post("/api/auth/coach-code", cookies=created.cookies).status_code == 403
    assert client.get("/api/coach/roster", cookies=created.cookies).status_code == 403

    assert manage_user_main(["promote-coach", f"  {email.upper()} "]) == 0
    assert "Promoted" in capsys.readouterr().out
    client.cookies.clear()
    signed_in = client.post("/api/auth/login", data={"username": email, "password": "password123"})
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["role"] == "COACH"
    assert client.post("/api/auth/coach-code").status_code == 200

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).one()
        event = db.query(AuditEvent).filter(
            AuditEvent.event_type == "COACH_PROMOTED",
            AuditEvent.resource_id == user.id,
        ).one()
        assert event.resource_type == "User"
    finally:
        db.close()

    assert manage_user_main(["promote-coach", email]) == 0
    assert "already a coach" in capsys.readouterr().out
    assert manage_user_main(["promote-coach", "missing-user@example.com"]) == 1
    assert "No account found" in capsys.readouterr().err


def _make_test_token(user_id, session_id, exp=None):
    payload = {"sub": user_id, "role": "ATHLETE", "session_id": session_id}
    payload["exp"] = exp or datetime.utcnow() + timedelta(minutes=5)
    return jwt.encode(payload, auth_main.SECRET_KEY, algorithm=auth_main.ALGORITHM)


def _add_auth_session(user_id, session_id=None, expires_at=None):
    session_id = session_id or str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(AuthSession(
            id=session_id,
            user_id=user_id,
            jwt_id=session_id,
            expires_at=expires_at or datetime.utcnow() + timedelta(minutes=5),
        ))
        db.commit()
    finally:
        db.close()
    return session_id


def test_active_session_token_authenticates_and_parallel_sessions_survive_logout():
    client = TestClient(app)
    user_id, first_token = _register_auth_user(client)
    # Create a second independent session for this same account.
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        email = user.email
    finally:
        db.close()
    second_login = client.post(
        "/api/auth/login", data={"username": email, "password": "password123"}
    )
    assert second_login.status_code == 200
    second_token = second_login.cookies.get("session_id")

    client.cookies.clear()
    assert client.get("/api/security/sessions", headers={"Authorization": f"Bearer {first_token}"}).status_code == 200
    assert client.post(
        "/api/auth/logout", headers={"Authorization": f"Bearer {first_token}"}
    ).status_code == 200
    client.cookies.clear()
    assert client.get("/api/security/sessions", headers={"Authorization": f"Bearer {first_token}"}).status_code == 401
    assert client.get("/api/security/sessions", headers={"Authorization": f"Bearer {second_token}"}).status_code == 200


def test_auth_rejects_malformed_expired_missing_session_and_user_mismatch_tokens():
    client = TestClient(app)
    user_id, _ = _register_auth_user(client)
    session_id = _add_auth_session(user_id)
    other_user_id, _ = _register_auth_user(client)
    other_session_id = _add_auth_session(other_user_id)
    client.cookies.clear()

    tokens = [
        "malformed.token.value",
        _make_test_token(user_id, session_id, datetime.utcnow() - timedelta(seconds=1)),
        jwt.encode(
            {"sub": user_id, "role": "ATHLETE", "session_id": session_id},
            auth_main.SECRET_KEY,
            algorithm=auth_main.ALGORITHM,
        ),
        _make_test_token(user_id, str(uuid.uuid4())),
        _make_test_token(user_id, other_session_id),
        _make_test_token(user_id, ""),
    ]
    for token in tokens:
        response = client.get("/api/security/sessions", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401

    expired_session_id = _add_auth_session(
        user_id, expires_at=datetime.utcnow() - timedelta(seconds=1)
    )
    response = client.get(
        "/api/security/sessions",
        headers={"Authorization": f"Bearer {_make_test_token(user_id, expired_session_id)}"},
    )
    assert response.status_code == 401


def test_revoked_session_fails_immediately():
    client = TestClient(app)
    user_id, token = _register_auth_user(client)
    db = SessionLocal()
    try:
        session = db.query(AuthSession).filter(AuthSession.user_id == user_id).first()
        session.revoked_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()

    client.cookies.clear()
    response = client.get("/api/security/sessions", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_session_management_revocation_invalidates_target_session():
    client = TestClient(app)
    _, token = _register_auth_user(client)
    payload = auth_main.decode_access_token(token)
    session_id = payload["session_id"]

    revoked = client.delete(
        f"/api/security/sessions/{session_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert revoked.status_code == 200
    client.cookies.clear()
    assert client.get(
        "/api/security/sessions", headers={"Authorization": f"Bearer {token}"}
    ).status_code == 401


def test_deleted_user_cannot_authenticate():
    client = TestClient(app)
    user_id, token = _register_auth_user(client)
    db = SessionLocal()
    try:
        db.query(User).filter(User.id == user_id).update({User.deleted_at: datetime.utcnow()})
        db.commit()
    finally:
        db.close()

    client.cookies.clear()
    assert client.get(
        "/api/security/sessions", headers={"Authorization": f"Bearer {token}"}
    ).status_code == 401


def _signed_telegram_init_data(bot_token, telegram_user_id):
    params = {
        "auth_date": str(int(time.time())),
        "query_id": "test-query-id",
        "user": json.dumps({"id": telegram_user_id, "first_name": "Test Athlete"}),
    }
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(params.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    params["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(params)


def test_telegram_miniapp_login_issues_revocable_session(monkeypatch):
    bot_token = "123456789:test-bot-token"
    monkeypatch.setattr(telegram_integrations, "TELEGRAM_BOT_TOKEN", bot_token)
    client = TestClient(app)
    user_id, _ = _register_auth_user(client)
    db = SessionLocal()
    try:
        db.add(IntegrationConnection(
            id=str(uuid.uuid4()),
            user_id=user_id,
            provider="telegram",
            external_account_id="99999",
            status="active",
            scopes="miniapp,bot",
        ))
        db.commit()
    finally:
        db.close()

    init_data = _signed_telegram_init_data(bot_token, 99999)
    login = client.post("/api/integrations/telegram/miniapp/session", json={"initData": init_data})
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert "session_id" in login.cookies
    client.cookies.clear()
    assert client.get(
        "/api/security/sessions", headers={"Authorization": f"Bearer {token}"}
    ).status_code == 200


def test_telegram_miniapp_login_rejects_mock_input_with_real_bot_token(monkeypatch):
    monkeypatch.setattr(telegram_integrations, "TELEGRAM_BOT_TOKEN", "123456789:real-bot-token")
    response = TestClient(app).post(
        "/api/integrations/telegram/miniapp/session", json={"initData": "mock_init_data"}
    )
    assert response.status_code == 401


def test_live_workout_events_require_active_authentication():
    client = TestClient(app)
    response = client.get("/api/workouts/not-a-workout/live")
    assert response.status_code == 401


def test_live_workout_events_allow_owner_and_linked_coach_but_hide_workouts_from_other_users(monkeypatch):
    owner_client = TestClient(app)
    owner_id, owner_token = _register_auth_user(owner_client, "sse-owner")
    coach_client = TestClient(app)
    coach_email = f"sse-coach-{uuid.uuid4().hex}@example.com"
    coach_response = _register_coach(coach_client, coach_email)
    assert coach_response.status_code == 200
    coach_id = coach_response.json()["user"]["id"]
    coach_token = coach_response.cookies.get("session_id")
    outsider_client = TestClient(app)
    _, outsider_token = _register_auth_user(outsider_client, "sse-outsider")

    workout_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(Workout(
            id=workout_id,
            date="2026-09-25",
            dayLabel="2026-09-25",
            title="Private SSE workout",
            color="#fff",
            status="IN_PROGRESS",
            owner_id=owner_id,
        ))
        db.add(CoachingRelationship(coach_id=coach_id, athlete_id=owner_id))
        db.flush()
        db.add(DomainEvent(
            id=event_id,
            workout_id=workout_id,
            event_type="SET_LOGGED",
            payload_json='{"private":"workout event"}',
        ))
        db.commit()
    finally:
        db.close()

    url = f"/api/workouts/{workout_id}/live"
    # Existing and nonexistent IDs have identical status and body for an
    # authenticated but unrelated user, preventing ID enumeration.
    unrelated = TestClient(app, cookies={"session_id": outsider_token})
    denied = unrelated.get(url)
    missing = unrelated.get("/api/workouts/not-a-workout/live")
    assert denied.status_code == missing.status_code == 404
    assert denied.json() == missing.json()

    # Browser EventSource sends the same-origin HttpOnly cookie automatically.
    # Both the owner and an actively linked coach can receive authorized events.
    # TestClient buffers streaming responses, so end the generator after its
    # first real event instead of waiting forever for SSE heartbeats.
    async def first_event(*args):
        stream = get_events(*args)
        try:
            yield await anext(stream)
        finally:
            await stream.aclose()

    monkeypatch.setattr(sse_broadcaster, "get_events", first_event)
    for token in (owner_token, coach_token):
        authorized = TestClient(app, cookies={"session_id": token})
        with authorized.stream("GET", url) as response:
            assert response.status_code == 200
            lines = iter(response.iter_lines())
            assert next(lines) == f"id: {event_id}"
            assert next(lines) == "event: SET_LOGGED"
            assert next(lines) == 'data: {"private":"workout event"}'


def test_open_live_workout_stream_stops_after_session_revocation(monkeypatch):
    client = TestClient(app)
    user_id, token = _register_auth_user(client)
    session_id = auth_main.decode_access_token(token)["session_id"]
    workout_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(Workout(
            id=workout_id,
            date="2026-09-25",
            dayLabel="2026-09-25",
            title="Auth stream test",
            color="#fff",
            status="PLANNED",
            owner_id=user_id,
        ))
        db.commit()
    finally:
        db.close()

    real_sleep = asyncio.sleep

    async def fast_sleep(_seconds):
        await real_sleep(0)

    monkeypatch.setattr(asyncio, "sleep", fast_sleep)

    async def check_stream_revocation():
        stream = get_events(workout_id, user_id, session_id)
        assert await stream.__anext__() == ": heartbeat\n\n"
        revoke_db = SessionLocal()
        try:
            auth_session = revoke_db.query(AuthSession).filter(AuthSession.id == session_id).first()
            auth_session.revoked_at = datetime.utcnow()
            revoke_db.commit()
        finally:
            revoke_db.close()
        try:
            await stream.__anext__()
            assert False, "revoked stream should have closed"
        except StopAsyncIteration:
            pass

    asyncio.run(check_stream_revocation())


def _workout_ids(tree):
    return [w["id"] for mc in tree for w in mc.get("workouts", [])]


def test_coach_code_link_unlink_keeps_empty_plan():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach_email = f"coach-{suffix}@example.com"
    outsider_email = f"outsider-{suffix}@example.com"
    athlete1_email = f"athlete1-{suffix}@example.com"
    athlete2_email = f"athlete2-{suffix}@example.com"

    coach = _register_coach(client, coach_email)
    assert coach.status_code == 200
    coach_cookies = dict(coach.cookies)

    outsider = _register_coach(client, outsider_email)
    assert outsider.status_code == 200
    outsider_cookies = dict(outsider.cookies)

    athlete1 = client.post(
        "/api/auth/register",
        json={"email": athlete1_email, "password": "password123", "role": "ATHLETE"},
    )
    assert athlete1.status_code == 200
    athlete1_cookies = dict(athlete1.cookies)
    named_profile = client.patch("/api/auth/profile", json={"displayName": "Athlete One"}, cookies=athlete1_cookies)
    assert named_profile.status_code == 200
    assert named_profile.json()["displayName"] == "Athlete One"

    athlete2 = client.post(
        "/api/auth/register",
        json={"email": athlete2_email, "password": "password123", "role": "ATHLETE"},
    )
    assert athlete2.status_code == 200
    athlete2_cookies = dict(athlete2.cookies)

    code_resp = client.post("/api/auth/coach-code", cookies=coach_cookies)
    assert code_resp.status_code == 200
    coach_code = code_resp.json()["code"]
    assert coach_code

    # Email is no longer a valid link code
    bad = client.post(
        "/api/auth/link",
        json={"code": coach_email},
        cookies=athlete1_cookies,
    )
    assert bad.status_code == 404

    link = client.post(
        "/api/auth/link",
        json={"code": coach_code},
        cookies=athlete1_cookies,
    )
    assert link.status_code == 200
    audit_db = SessionLocal()
    try:
        audit_db.add(AuditEvent(
            id=f"private-{suffix}",
            actor_user_id=athlete1.json()["id"],
            event_type="PRIVATE_ATHLETE_EVENT",
            resource_type="PrivateResource",
            resource_id=suffix,
        ))
        audit_db.commit()
    finally:
        audit_db.close()
    reused_code = client.post(
        "/api/auth/link",
        json={"code": coach_code},
        cookies=athlete2_cookies,
    )
    assert reused_code.status_code == 404

    athlete1_mcs = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_mcs.status_code == 200
    assert athlete1_mcs.json() == []

    athlete2_mcs = client.get("/api/microcycles", cookies=athlete2_cookies)
    assert athlete2_mcs.status_code == 200
    assert athlete2_mcs.json() == []

    created = client.post(
        "/api/sessions",
        json={"date": datetime.utcnow().date().isoformat(), "title": "Squat day", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=athlete1_cookies,
    )
    assert created.status_code == 200
    session = created.json()
    assert session["blockLabel"] == "Block2"
    assert session["weekLabel"] == "Week3"
    session_id = session["id"]

    roster = client.get("/api/coach/roster", cookies=coach_cookies)
    assert roster.status_code == 200
    roster_data = roster.json()
    emails = [row["email"] for row in roster_data]
    assert athlete1_email in emails
    assert athlete2_email not in emails

    athlete_id = next(row["id"] for row in roster_data if row["email"] == athlete1_email)
    assert next(row for row in roster_data if row["id"] == athlete_id)["displayName"] == "Athlete One"
    coach_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    assert coach_mcs.status_code == 200
    assert session_id in _workout_ids(coach_mcs.json())

    outsider_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=outsider_cookies)
    assert outsider_mcs.status_code == 403
    outsider_write = client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "Hijack"},
        cookies=outsider_cookies,
    )
    assert outsider_write.status_code == 403

    stranger_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=athlete2_cookies)
    assert stranger_mcs.status_code == 403
    stranger_own = client.get("/api/microcycles", cookies=athlete2_cookies)
    assert stranger_own.status_code == 200
    assert session_id not in _workout_ids(stranger_own.json())

    unlink = client.delete("/api/auth/link", cookies=athlete1_cookies)
    assert unlink.status_code == 200
    athlete_audit = client.get("/api/security/audit-events", cookies=athlete1_cookies)
    assert athlete_audit.status_code == 200
    assert any(event["event_type"] == "ATHLETE_UNLINKED" for event in athlete_audit.json())

    post_unlink = client.post(
        "/api/sessions",
        json={"date": (datetime.utcnow().date() + timedelta(days=1)).isoformat(), "title": "Solo day"},
        cookies=athlete1_cookies,
    )
    assert post_unlink.status_code == 200
    post_unlink_session_id = post_unlink.json()["id"]

    roster_after = client.get("/api/coach/roster", cookies=coach_cookies)
    assert athlete1_email not in [row["email"] for row in roster_after.json()]

    lost = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    assert lost.status_code == 403
    lost_write = client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "After unlink"},
        cookies=coach_cookies,
    )
    assert lost_write.status_code == 403

    past_links = client.get("/api/coach/roster/history", cookies=coach_cookies)
    assert past_links.status_code == 200
    assert len(past_links.json()) == 1
    relationship_id = past_links.json()[0]["relationshipId"]
    assert past_links.json()[0]["archiveAvailable"] is True
    coach_audit = client.get("/api/security/audit-events", cookies=coach_cookies).json()
    coach_event_types = [event["event_type"] for event in coach_audit]
    assert "ATHLETE_LINKED" in coach_event_types
    assert "ATHLETE_UNLINKED" in coach_event_types
    assert "PRIVATE_ATHLETE_EVENT" not in coach_event_types
    snapshot = client.get(f"/api/coach/roster/history/{relationship_id}", cookies=coach_cookies)
    assert snapshot.status_code == 200
    snapshot_session_ids = _workout_ids(snapshot.json()["microcycles"])
    assert session_id in snapshot_session_ids
    assert post_unlink_session_id not in snapshot_session_ids

    renamed = client.patch("/api/auth/profile", json={"displayName": "Updated Later"}, cookies=athlete1_cookies)
    assert renamed.status_code == 200
    assert renamed.json()["displayName"] == "Updated Later"
    frozen_snapshot = client.get(f"/api/coach/roster/history/{relationship_id}", cookies=coach_cookies).json()
    assert frozen_snapshot["athlete"]["displayName"] == "Athlete One"

    # Relinking creates a new relationship; the former coach keeps only the old snapshot.
    new_code = client.post("/api/auth/coach-code", cookies=outsider_cookies).json()["code"]
    relink = client.post("/api/auth/link", json={"code": new_code}, cookies=athlete1_cookies)
    assert relink.status_code == 200
    new_roster = client.get("/api/coach/roster", cookies=outsider_cookies).json()
    assert next(row for row in new_roster if row["id"] == athlete_id)["displayName"] == "Updated Later"
    assert client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies).status_code == 403
    assert client.get(f"/api/coach/roster/history/{relationship_id}", cookies=outsider_cookies).status_code == 404

    # Plan stays in athlete space after unlink
    athlete1_after = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_after.status_code == 200
    assert session_id in _workout_ids(athlete1_after.json())
    assert post_unlink_session_id in _workout_ids(athlete1_after.json())


def test_coach_can_unlink_and_get_read_only_snapshot():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = _register_coach(client, f"coach-{suffix}@example.com")
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    coach_cookies = dict(coach.cookies)
    athlete_cookies = dict(athlete.cookies)
    code = client.post("/api/auth/coach-code", cookies=coach_cookies).json()["code"]
    assert client.post("/api/auth/link", json={"code": code}, cookies=athlete_cookies).status_code == 200
    roster = client.get("/api/coach/roster", cookies=coach_cookies).json()
    athlete_id = roster[0]["id"]

    unlink = client.delete(f"/api/auth/link/{athlete_id}", cookies=coach_cookies)
    assert unlink.status_code == 200
    coach_audit = client.get("/api/security/audit-events", cookies=coach_cookies)
    assert any(event["event_type"] == "COACH_UNLINKED_ATHLETE" for event in coach_audit.json())
    assert client.get("/api/coach/roster", cookies=coach_cookies).json() == []
    history = client.get("/api/coach/roster/history", cookies=coach_cookies).json()
    assert len(history) == 1
    assert history[0]["archiveAvailable"] is True
    assert client.get(f"/api/coach/roster/history/{history[0]['relationshipId']}", cookies=coach_cookies).status_code == 200


def test_coach_create_session_requires_linked_athlete():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = _register_coach(client, f"coach-{suffix}@example.com")
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    coach_cookies = dict(coach.cookies)
    athlete_cookies = dict(athlete.cookies)

    missing = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Squat"},
        cookies=coach_cookies,
    )
    assert missing.status_code == 400
    assert missing.json()["detail"] == "athlete_id is required for coaches"

    bad_date = client.post(
        "/api/sessions",
        json={"date": "12-09-2026", "title": "Squat"},
        cookies=athlete_cookies,
    )
    assert bad_date.status_code == 400
    assert bad_date.json()["detail"] == "date must be YYYY-MM-DD"

    unknown = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Squat", "athleteId": "not-linked"},
        cookies=coach_cookies,
    )
    assert unknown.status_code == 403

    login = client.post(
        "/api/auth/login",
        data={"username": f"coach-{suffix}@example.com", "password": "password123"},
    )
    coach_id = login.json()["user"]["id"]
    own = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Squat", "athleteId": coach_id},
        cookies=coach_cookies,
    )
    assert own.status_code == 403

    code = client.post("/api/auth/coach-code", cookies=coach_cookies).json()["code"]
    linked = client.post("/api/auth/link-athlete", json={"code": code}, cookies=athlete_cookies)
    assert linked.status_code == 200
    roster = client.get("/api/coach/roster", cookies=coach_cookies)
    athlete_id = next(row["id"] for row in roster.json() if row["email"] == f"athlete-{suffix}@example.com")

    created = client.post(
        "/api/sessions",
        json={
            "date": "2026-09-12",
            "title": "Squat day",
            "blockLabel": "  Hypertrophy  ",
            "weekLabel": "Week1",
            "athleteId": athlete_id,
        },
        cookies=coach_cookies,
    )
    assert created.status_code == 200
    body = created.json()
    assert body["date"] == "2026-09-12"
    assert body["blockLabel"] == "Hypertrophy"
    assert body["weekLabel"] == "Week1"
    assert body["ownerId"] == athlete_id

    tree = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    assert any(w["id"] == body["id"] for w in workouts)

    athlete_tree = client.get("/api/microcycles", cookies=athlete_cookies)
    assert athlete_tree.status_code == 200
    assert any(w["id"] == body["id"] for mc in athlete_tree.json() for w in mc["workouts"])

    athlete_own = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=athlete_cookies)
    assert athlete_own.status_code == 200
    assert any(w["id"] == body["id"] for mc in athlete_own.json() for w in mc["workouts"])


def test_session_labels_anytime_and_new_athlete_starts_empty():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    empty = client.get("/api/microcycles", cookies=cookies)
    assert empty.status_code == 200
    assert empty.json() == []

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Bench"},
        cookies=cookies,
    )
    assert created.status_code == 200
    sid = created.json()["id"]
    assert created.json()["blockLabel"] is None

    labeled = client.patch(
        f"/api/sessions/{sid}",
        json={"title": "Heavy Bench", "blockLabel": "Block1", "weekLabel": "Week1"},
        cookies=cookies,
    )
    assert labeled.status_code == 200
    assert labeled.json()["title"] == "Heavy Bench"
    assert labeled.json()["blockLabel"] == "Block1"
    assert labeled.json()["weekLabel"] == "Week1"

    removed = client.delete(f"/api/sessions/{sid}", cookies=cookies)
    assert removed.status_code == 200


def test_deleting_synced_session_preserves_event_and_rejects_future_writes():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    owner = client.post(
        "/api/auth/register",
        json={"email": f"delete-owner-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    outsider = client.post(
        "/api/auth/register",
        json={"email": f"delete-outsider-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    owner_cookies = dict(owner.cookies)
    outsider_cookies = dict(outsider.cookies)
    created = client.post(
        "/api/sessions", json={"date": "2026-09-26", "title": "Synced session"}, cookies=owner_cookies,
    )
    assert created.status_code == 200
    session_id = created.json()["id"]
    payload = {
        "schema_version": 1,
        "client_device_id": f"delete-device-{suffix}",
        "workout_id": session_id,
        "last_updated_at": "2026-09-26T00:00:00Z",
        "changes": [],
    }
    assert client.post(f"/api/workouts/{session_id}/sync", json=payload, cookies=owner_cookies).status_code == 200

    db = SessionLocal()
    try:
        event_id = db.query(DomainEvent.id).filter(DomainEvent.workout_id == session_id).scalar()
        assert event_id is not None
    finally:
        db.close()

    assert client.delete(f"/api/sessions/{session_id}", cookies=outsider_cookies).status_code == 403
    assert client.delete(f"/api/sessions/{session_id}", cookies=owner_cookies).status_code == 200
    assert client.delete(f"/api/sessions/{session_id}", cookies=owner_cookies).status_code == 404
    assert client.patch(f"/api/sessions/{session_id}", json={"title": "Resurrected"}, cookies=owner_cookies).status_code == 404
    assert client.post(f"/api/workouts/{session_id}/sync", json=payload, cookies=owner_cookies).status_code == 404
    tree = client.get("/api/microcycles", cookies=owner_cookies)
    assert all(w["id"] != session_id for mc in tree.json() for w in mc["workouts"])

    db = SessionLocal()
    try:
        workout = db.query(Workout).filter(Workout.id == session_id).one()
        assert workout.deleted_at is not None
        assert db.query(DomainEvent.id).filter(DomainEvent.id == event_id, DomainEvent.workout_id == session_id).scalar() == event_id
    finally:
        db.close()


def test_copy_week_shifts_dates_and_increments_week_label():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    squat = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    bench = client.post(
        "/api/sessions",
        json={"date": "2026-09-17", "title": "Bench", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200

    copied = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [squat.json()["id"], bench.json()["id"]], "dateOffsetDays": 3},
        cookies=cookies,
    )
    assert copied.status_code == 200
    payload = copied.json()
    assert payload["status"] == "success"
    assert len(payload["copied"]) == 2
    dates = sorted(row["date"] for row in payload["copied"])
    assert dates == ["2026-09-18", "2026-09-20"]
    assert all(row["blockLabel"] == "Block2" for row in payload["copied"])
    assert all(row["weekLabel"] == "Week4" for row in payload["copied"])

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    assert len(workouts) == 4

    copied_id = payload["copied"][0]["id"]
    relabeled = client.patch(
        f"/api/sessions/{copied_id}",
        json={"blockLabel": "Meet", "weekLabel": "Week1"},
        cookies=cookies,
    )
    assert relabeled.status_code == 200
    assert relabeled.json()["blockLabel"] == "Meet"
    assert relabeled.json()["weekLabel"] == "Week1"
    cleared = client.patch(
        f"/api/sessions/{copied_id}",
        json={"blockLabel": "", "weekLabel": ""},
        cookies=cookies,
    )
    assert cleared.status_code == 200
    assert cleared.json()["blockLabel"] is None
    assert cleared.json()["weekLabel"] is None


def test_copy_week_preserve_week_label_keeps_source():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    squat = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    bench = client.post(
        "/api/sessions",
        json={"date": "2026-09-17", "title": "Bench", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    unlabeled = client.post(
        "/api/sessions",
        json={"date": "2026-09-14", "title": "Open"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200
    assert unlabeled.status_code == 200

    preserved = client.post(
        "/api/sessions/copy-week",
        json={
            "sessionIds": [squat.json()["id"], bench.json()["id"]],
            "dateOffsetDays": 7,
            "preserveWeekLabel": True,
        },
        cookies=cookies,
    )
    assert preserved.status_code == 200
    rows = preserved.json()["copied"]
    assert sorted(row["date"] for row in rows) == ["2026-09-22", "2026-09-24"]
    assert all(row["weekLabel"] == "Week3" for row in rows)
    assert all(row["blockLabel"] == "Block2" for row in rows)

    unlabeled_copy = client.post(
        "/api/sessions/copy-week",
        json={
            "sessionIds": [unlabeled.json()["id"]],
            "dateOffsetDays": 3,
            "preserveWeekLabel": True,
        },
        cookies=cookies,
    )
    assert unlabeled_copy.status_code == 200
    clone = unlabeled_copy.json()["copied"][0]
    assert clone["date"] == "2026-09-17"
    assert clone["weekLabel"] is None
    assert clone["blockLabel"] is None


def test_copy_preserves_labeled_day_label_not_dest_date():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    labeled = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "dayLabel": "1"},
        cookies=cookies,
    )
    unlabeled = client.post(
        "/api/sessions",
        json={"date": "2026-09-16", "title": "Open"},
        cookies=cookies,
    )
    assert labeled.status_code == 200
    assert unlabeled.status_code == 200
    assert unlabeled.json()["dayLabel"] == "2026-09-16"

    copied = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [labeled.json()["id"], unlabeled.json()["id"]], "dateOffsetDays": 7},
        cookies=cookies,
    )
    assert copied.status_code == 200
    by_title = {row["title"]: row for row in copied.json()["copied"]}
    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = {w["id"]: w for mc in tree.json() for w in mc["workouts"]}
    squat_clone = workouts[by_title["Squat"]["id"]]
    open_clone = workouts[by_title["Open"]["id"]]
    assert squat_clone["date"] == "2026-09-22"
    assert squat_clone["dayLabel"] == "1"
    assert open_clone["date"] == "2026-09-23"
    assert open_clone["dayLabel"] == "2026-09-23"


def test_plan_sets_persist_typed_weight_and_empty_backoff():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"plan-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    eid = squat.json()["id"]
    top_id = squat.json()["sets"][0]["id"]
    saved = client.put(
        f"/api/sessions/{sid}/exercises/{eid}/sets",
        json={
            "sets": [
                {"id": top_id, "plannedWeight": 180, "plannedReps": 5, "plannedRpe": 8, "intensityType": "RPE", "isTop": True},
                {"plannedWeight": None, "plannedReps": 5, "plannedRpe": 8, "intensityType": "PERCENT"},
            ]
        },
        cookies=cookies,
    )
    assert saved.status_code == 200
    rows = saved.json()["sets"]
    assert rows[0]["plannedWeight"] == 180.0
    assert rows[1]["plannedWeight"] is None
    assert rows[1]["intensityType"] == "PERCENT"

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    sets = next(ex["sets"] for w in workouts for ex in w["exercises"] if ex["id"] == eid)
    assert sets[0]["plannedWeight"] == 180.0
    assert sets[1]["plannedWeight"] is None


def test_plan_sets_persist_drop_percent():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"drop-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-16", "title": "Squat"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    eid = squat.json()["id"]
    top_id = squat.json()["sets"][0]["id"]
    saved = client.put(
        f"/api/sessions/{sid}/exercises/{eid}/sets",
        json={
            "sets": [
                {
                    "id": top_id,
                    "plannedWeight": 200,
                    "plannedReps": 5,
                    "plannedRpe": 8,
                    "intensityType": "RPE",
                    "isTop": True,
                    "dropPercent": 0,
                },
                {
                    "plannedWeight": 180,
                    "plannedReps": 5,
                    "plannedRpe": 8,
                    "intensityType": "RPE",
                    "dropPercent": -10,
                },
            ]
        },
        cookies=cookies,
    )
    assert saved.status_code == 200
    rows = saved.json()["sets"]
    assert rows[1]["dropPercent"] == -10
    assert rows[1]["plannedWeight"] == 180.0
    assert not rows[1]["isAuto"]

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    sets = next(ex["sets"] for w in workouts for ex in w["exercises"] if ex["id"] == eid)
    assert sets[1]["dropPercent"] == -10
    assert sets[1]["plannedWeight"] == 180.0

    again = client.put(
        f"/api/sessions/{sid}/exercises/{eid}/sets",
        json={
            "sets": [
                {
                    "id": rows[0]["id"],
                    "plannedWeight": 200,
                    "plannedReps": 5,
                    "plannedRpe": 8,
                    "dropPercent": 0,
                },
                {
                    "id": rows[1]["id"],
                    "plannedWeight": 180,
                    "plannedReps": 5,
                    "plannedRpe": 8,
                    "dropPercent": -10,
                },
            ]
        },
        cookies=cookies,
    )
    assert again.status_code == 200
    assert again.json()["sets"][1]["dropPercent"] == -10


def test_copy_lifts_clears_logs_copy_with_logs_keeps_them():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat", "plannedWeight": 180, "plannedReps": 5, "plannedRpe": 8},
        cookies=cookies,
    )
    set_id = squat.json()["sets"][0]["id"]
    logged = client.post(
        "/api/sets/log",
        json={"workoutId": sid, "exerciseId": squat.json()["id"], "setId": set_id, "weight": 182.5, "reps": 5, "rpe": 8.5},
        cookies=cookies,
    )
    assert logged.status_code == 200

    lifts_only = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [sid], "dateOffsetDays": 7, "includeLogs": False},
        cookies=cookies,
    )
    with_logs = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [sid], "dateOffsetDays": 14, "includeLogs": True},
        cookies=cookies,
    )
    assert lifts_only.status_code == 200
    assert with_logs.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = {w["id"]: w for mc in tree.json() for w in mc["workouts"]}
    lifts_copy = workouts[lifts_only.json()["copied"][0]["id"]]
    logs_copy = workouts[with_logs.json()["copied"][0]["id"]]
    assert lifts_copy["exercises"][0]["sets"][0]["plannedWeight"] == 180.0
    assert lifts_copy["exercises"][0]["sets"][0]["actual"] is None
    assert logs_copy["exercises"][0]["sets"][0]["plannedWeight"] == 180.0
    assert logs_copy["exercises"][0]["sets"][0]["actual"] == 182.5
    assert logs_copy["exercises"][0]["sets"][0]["reps"] == 5
    assert logs_copy["exercises"][0]["sets"][0]["executedRpe"] == 8.5


def test_add_lift_to_empty_session():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    assert created.status_code == 200
    sid = created.json()["id"]
    assert created.json()["exercises"] == []

    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat", "tier": "Comp", "plannedReps": 5, "plannedRpe": 8},
        cookies=cookies,
    )
    assert squat.status_code == 200
    body = squat.json()
    assert body["title"] == "Squat"
    assert body["liftCategory"] == "Squat"
    assert body["tier"] == "Comp"
    assert len(body["sets"]) == 1
    assert body["sets"][0]["plannedReps"] == 5
    assert body["sets"][0]["plannedRpe"] == 8.0
    assert body["sets"][0]["actual"] is None

    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    assert bench.status_code == 200

    other = client.post(
        "/api/auth/register",
        json={"email": f"other-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    other_cookies = dict(other.cookies)
    forbidden = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=other_cookies,
    )
    assert forbidden.status_code == 403

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert len(match["exercises"]) == 2
    assert [e["title"] for e in match["exercises"]] == ["Squat", "Bench"]


def test_remove_lift_from_session():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200
    squat_id = squat.json()["id"]

    removed = client.delete(f"/api/sessions/{sid}/exercises/{squat_id}", cookies=cookies)
    assert removed.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    titles = [e["title"] for e in match["exercises"]]
    assert titles == ["Bench"]

    missing = client.delete(f"/api/sessions/{sid}/exercises/{squat_id}", cookies=cookies)
    assert missing.status_code == 404

    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    removed_after = client.delete(
        f"/api/sessions/{sid}/exercises/{bench.json()['id']}",
        cookies=cookies,
    )
    assert removed_after.status_code == 200


def test_completed_session_stays_writable():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    assert done.json()["status"] == "COMPLETED"

    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    assert bench.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Squat", "Bench"]
    assert match["status"] == "COMPLETED"


def test_completed_session_allows_set_writes():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    eid = squat.json()["id"]
    set_id = squat.json()["sets"][0]["id"]
    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200

    logged = client.post(
        "/api/sets/log",
        json={"workoutId": sid, "exerciseId": eid, "setId": set_id, "weight": 180, "reps": 5, "rpe": 8},
        cookies=cookies,
    )
    assert logged.status_code == 200

    replaced = client.put(
        f"/api/sessions/{sid}/exercises/{eid}/sets",
        json={"sets": [{"id": set_id, "label": "Set 1", "plannedWeight": 185, "plannedReps": 5, "plannedRpe": 8}]},
        cookies=cookies,
    )
    assert replaced.status_code == 200
    assert replaced.json()["sets"][0]["plannedWeight"] == 185.0

    other = client.post(
        "/api/sessions",
        json={"date": "2026-09-13", "title": "Open day"},
        cookies=cookies,
    )
    other_id = other.json()["id"]
    hijack = client.post(
        "/api/sets/log",
        json={"workoutId": other_id, "exerciseId": eid, "setId": set_id, "weight": 180, "reps": 5, "rpe": 8},
        cookies=cookies,
    )
    assert hijack.status_code == 404

    completed_sync = client.post(
        f"/api/workouts/{sid}/sync",
        json={
            "schema_version": 1,
            "client_device_id": "dev-lock-test",
            "workout_id": sid,
            "last_updated_at": "2026-09-12T00:00:00Z",
            "changes": [{
                "entity": "ExerciseSet",
                "id": set_id,
                "mutation_id": "mut-completed-1",
                "updated_at": "2026-09-12T00:00:00Z",
                "fields": {"actual": 200, "reps": 5, "executedRpe": 8},
            }],
        },
        cookies=cookies,
    )
    assert completed_sync.status_code == 200
    completed_body = completed_sync.json()
    assert "mut-completed-1" in completed_body.get("accepted_mutation_ids", [])

    mismatch_sync = client.post(
        f"/api/workouts/{other_id}/sync",
        json={
            "schema_version": 1,
            "client_device_id": "dev-lock-test",
            "workout_id": other_id,
            "last_updated_at": "2026-09-12T00:00:00Z",
            "changes": [{
                "entity": "ExerciseSet",
                "id": set_id,
                "mutation_id": "mut-mismatch-1",
                "updated_at": "2026-09-12T00:00:00Z",
                "fields": {"actual": 200, "reps": 5, "executedRpe": 8},
            }],
        },
        cookies=cookies,
    )
    assert mismatch_sync.status_code == 200
    body = mismatch_sync.json()
    assert "mut-mismatch-1" in body.get("rejected_mutations", [])
    assert any(item.get("reason") == "WORKOUT_MISMATCH" for item in body.get("conflicts", []))


def test_reorder_lifts_in_session():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    deadlift = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Deadlift", "liftCategory": "Deadlift"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200
    assert deadlift.status_code == 200
    bench_id = bench.json()["id"]

    moved = client.patch(
        f"/api/sessions/{sid}/exercises/{bench_id}",
        json={"move": "up"},
        cookies=cookies,
    )
    assert moved.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Bench", "Squat", "Deadlift"]

    end = client.patch(
        f"/api/sessions/{sid}/exercises/{bench_id}",
        json={"move": "up"},
        cookies=cookies,
    )
    assert end.status_code == 200
    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Bench", "Squat", "Deadlift"]

    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    moved_after = client.patch(
        f"/api/sessions/{sid}/exercises/{bench_id}",
        json={"move": "down"},
        cookies=cookies,
    )
    assert moved_after.status_code == 200
    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Squat", "Bench", "Deadlift"]


def test_name_lift_variation():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    eid = squat.json()["id"]
    named = client.patch(
        f"/api/sessions/{sid}/exercises/{eid}",
        json={"variation": "Pause High Bar Squat (3-2-0)", "tier": "Variation"},
        cookies=cookies,
    )
    assert named.status_code == 200
    assert named.json()["variation"] == "Pause High Bar Squat (3-2-0)"
    assert named.json()["tier"] == "Variation"
    assert named.json()["title"] == "Squat"

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert match["exercises"][0]["variation"] == "Pause High Bar Squat (3-2-0)"


def test_athlete_sees_coach_created_session_on_own_id_fetch():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = _register_coach(client, f"coach-{suffix}@example.com")
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    coach_cookies = dict(coach.cookies)
    athlete_cookies = dict(athlete.cookies)
    athlete_id = athlete.json()["user"]["id"]

    code = client.post("/api/auth/coach-code", cookies=coach_cookies).json()["code"]
    linked = client.post("/api/auth/link", json={"code": code}, cookies=athlete_cookies)
    assert linked.status_code == 200

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-08", "title": "Coach squat", "blockLabel": "Block1", "weekLabel": "Week1", "athleteId": athlete_id},
        cookies=coach_cookies,
    )
    assert created.status_code == 200
    session_id = created.json()["id"]

    own = client.get("/api/microcycles", cookies=athlete_cookies)
    assert own.status_code == 200
    assert session_id in _workout_ids(own.json())

    explicit = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=athlete_cookies)
    assert explicit.status_code == 200
    assert session_id in _workout_ids(explicit.json())


def test_sync_workout_requires_plan_access_and_matching_url():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    owner = client.post("/api/auth/register", json={"email": f"owner-{suffix}@example.com", "password": "password123", "role": "ATHLETE"})
    stranger = client.post("/api/auth/register", json={"email": f"stranger-{suffix}@example.com", "password": "password123", "role": "ATHLETE"})
    session = client.post("/api/sessions", json={"date": "2026-09-12", "title": "Private"}, cookies=dict(owner.cookies)).json()
    payload = {
        "schema_version": 1,
        "client_device_id": f"dev-{suffix}",
        "workout_id": session["id"],
        "last_updated_at": "2026-09-12T00:00:00Z",
        "changes": [],
    }
    assert client.post(f"/api/workouts/{session['id']}/sync", json=payload, cookies=dict(stranger.cookies)).status_code == 403
    assert client.post("/api/workouts/other-session/sync", json=payload, cookies=dict(owner.cookies)).status_code == 400


def test_sync_mixed_workout_payload_rejects_foreign_entities():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    first = client.post("/api/sessions", json={"date": "2026-09-12", "title": "A"}, cookies=cookies).json()
    second = client.post("/api/sessions", json={"date": "2026-09-13", "title": "B"}, cookies=cookies).json()
    squat = client.post(
        f"/api/sessions/{first['id']}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    ).json()
    bench = client.post(
        f"/api/sessions/{second['id']}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    ).json()
    squat_set = squat["sets"][0]["id"]
    bench_set = bench["sets"][0]["id"]

    mixed = client.post(
        f"/api/workouts/{second['id']}/sync",
        json={
            "schema_version": 1,
            "client_device_id": "dev-mixed",
            "workout_id": second["id"],
            "last_updated_at": "2026-09-12T00:00:00Z",
            "changes": [
                {
                    "entity": "ExerciseSet",
                    "id": bench_set,
                    "mutation_id": f"mut-own-{suffix}",
                    "updated_at": "2026-09-12T00:00:00Z",
                    "fields": {"actual": 110, "reps": 5, "executedRpe": 8},
                },
                {
                    "entity": "ExerciseSet",
                    "id": squat_set,
                    "mutation_id": f"mut-foreign-{suffix}",
                    "updated_at": "2026-09-12T00:00:00Z",
                    "fields": {"actual": 999, "reps": 1, "executedRpe": 10},
                },
            ],
        },
        cookies=cookies,
    )
    assert mixed.status_code == 200
    body = mixed.json()
    assert f"mut-own-{suffix}" in body.get("accepted_mutation_ids", [])
    assert f"mut-foreign-{suffix}" in body.get("rejected_mutations", [])
    assert any(item.get("reason") == "WORKOUT_MISMATCH" for item in body.get("conflicts", []))

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = {w["id"]: w for mc in tree.json() for w in mc["workouts"]}
    squat_row = next(e for e in workouts[first["id"]]["exercises"] if e["id"] == squat["id"])
    bench_row = next(e for e in workouts[second["id"]]["exercises"] if e["id"] == bench["id"])
    assert squat_row["sets"][0]["actual"] != 999
    assert bench_row["sets"][0]["actual"] == 110


def test_auth_link_reset_is_not_a_plan_conflict():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-08", "title": "Keep me"},
        cookies=cookies,
    )
    session_id = created.json()["id"]

    reset = client.post("/api/auth/link/reset", cookies=cookies)
    assert reset.status_code != 409
    tree = client.get("/api/microcycles", cookies=cookies)
    assert tree.status_code == 200
    assert session_id in _workout_ids(tree.json())

import uuid
from datetime import datetime, timedelta

import pytest

from backend.database import (
    AccessGrant, AuditEvent, CoachingRelationship, SessionLocal, User,
    Workspace, WorkspaceMember,
)
from backend.entitlements import (
    PLAN_CONFIG,
    grant_workspace_access,
    resolve_workspace_entitlements,
    revoke_workspace_access,
)
from backend.manage_user import main as manage_user_main
from backend.workspaces import ensure_default_workspace_for_coach, get_active_athlete_count


def _user(db, role="COACH", display_name=None, email=None):
    email = email or f"phase1-{uuid.uuid4().hex}@example.com"
    user = User(
        id=str(uuid.uuid4()), email=email,
        hashed_password="test-only", role=role, display_name=display_name,
    )
    db.add(user)
    db.flush()
    return user


def test_workspace_creation_is_idempotent_and_owner_membership_is_unique():
    with SessionLocal() as db:
        user = _user(db, display_name="John Smith")
        first = ensure_default_workspace_for_coach(db, user)
        db.commit()
        second = ensure_default_workspace_for_coach(db, user)
        db.commit()
        assert first.id == second.id
        assert first.name == "John Smith Coaching"
        assert db.query(Workspace).filter_by(owner_user_id=user.id).count() == 1
        assert db.query(WorkspaceMember).filter_by(workspace_id=first.id, user_id=user.id).count() == 1
        assert db.query(WorkspaceMember).filter_by(workspace_id=first.id, user_id=user.id).one().role == "OWNER"
        assert db.query(AuditEvent).filter_by(event_type="WORKSPACE_CREATED", resource_id=first.id).count() == 1
        assert db.query(AuditEvent).filter_by(event_type="WORKSPACE_MEMBER_ADDED", resource_id=first.id).count() == 1


def test_default_workspace_uses_email_prefix_and_rejects_athletes():
    with SessionLocal() as db:
        coach = _user(db, email="powercoach@example.com")
        assert ensure_default_workspace_for_coach(db, coach).name == "powercoach Coaching"
        athlete = _user(db, role="ATHLETE")
        with pytest.raises(ValueError, match="Only coaches"):
            ensure_default_workspace_for_coach(db, athlete)
        assert db.query(Workspace).filter_by(owner_user_id=athlete.id).count() == 0
        db.rollback()


def test_grant_expiration_revocation_unknown_plan_and_precedence():
    now = datetime(2026, 9, 27, 12, 0, 0)
    with SessionLocal() as db:
        coach = _user(db)
        workspace = ensure_default_workspace_for_coach(db, coach)
        starter = grant_workspace_access(db, workspace, "coach_starter", days=60, source="manual", now=now)
        assert starter.expires_at == now + timedelta(days=60)
        beta = grant_workspace_access(db, workspace, "coach_beta", days=60, source="beta", now=now)
        resolved = resolve_workspace_entitlements(db, workspace.id, now=now)
        assert resolved.active and resolved.plan_key == "coach_beta"
        assert resolved.max_active_athletes == 20
        assert resolved.can_use_integrations

        future = grant_workspace_access(db, workspace, "coach_unlimited", days=60, source="future", now=now + timedelta(days=1))
        assert resolve_workspace_entitlements(db, workspace.id, now=now).plan_key == "coach_beta"
        assert resolve_workspace_entitlements(db, workspace.id, now=now + timedelta(days=1)).plan_key == "coach_unlimited"

        expired = grant_workspace_access(db, workspace, "coach_pro", days=1, source="expired", now=now - timedelta(days=2))
        assert resolve_workspace_entitlements(db, workspace.id, now=now).plan_key == "coach_beta"
        assert expired not in db.query(AccessGrant).filter(AccessGrant.id == expired.id, AccessGrant.expires_at > now).all()
        revoked = revoke_workspace_access(db, workspace.id, source="future", now=now + timedelta(days=1))
        assert revoked == [future]
        assert resolve_workspace_entitlements(db, workspace.id, now=now + timedelta(days=2)).plan_key == "coach_beta"

        with pytest.raises(ValueError, match="Unknown plan"):
            grant_workspace_access(db, workspace, "invented", days=1)
        for kwargs in ({"days": 0}, {"days": -1}, {"days": 1, "no_expiry": True}, {"no_expiry": False}):
            with pytest.raises(ValueError):
                grant_workspace_access(db, workspace, "coach_beta", **kwargs)
        assert not resolve_workspace_entitlements(db, "missing-workspace", now=now).active
        db.rollback()


def test_non_expiring_grant_and_active_athlete_count_use_relationship_owner():
    with SessionLocal() as db:
        coach = _user(db)
        workspace = ensure_default_workspace_for_coach(db, coach)
        grant = grant_workspace_access(db, workspace, "coach_unlimited", no_expiry=True)
        assert grant.expires_at is None
        athlete = _user(db, role="ATHLETE")
        ended_athlete = _user(db, role="ATHLETE")
        db.add_all([
            CoachingRelationship(coach_id=coach.id, athlete_id=athlete.id),
            CoachingRelationship(coach_id=coach.id, athlete_id=ended_athlete.id, ended_at=datetime.utcnow()),
        ])
        db.flush()
        assert get_active_athlete_count(db, workspace) == 1
        db.rollback()


def test_cli_grant_promotes_athlete_case_insensitive_and_audits(capsys):
    email = f"Grant-{uuid.uuid4().hex}@Example.com"
    with SessionLocal() as db:
        user = _user(db, role="ATHLETE", email=email)
        user_id = user.id
        db.commit()
    assert manage_user_main(["grant-coach-access", email.lower(), "--plan", "coach_beta", "--days", "60", "--reason", "beta-tester"]) == 0
    output = capsys.readouterr().out
    assert "Granted coach_beta access" in output
    assert "Expires:" in output
    assert "Source: beta" in output
    with SessionLocal() as db:
        user = db.query(User).filter_by(id=user_id).one()
        assert user.role == "COACH"
        workspace = db.query(Workspace).filter_by(owner_user_id=user.id).one()
        grant = db.query(AccessGrant).filter_by(workspace_id=workspace.id).one()
        assert grant.reason == "beta-tester"
        assert {event.event_type for event in db.query(AuditEvent).filter(AuditEvent.resource_id.in_([user.id, workspace.id, grant.id])).all()} >= {
            "COACH_PROMOTED", "WORKSPACE_CREATED", "WORKSPACE_MEMBER_ADDED", "ACCESS_GRANTED",
        }


def test_cli_permanent_grant_revoke_show_and_no_active_message(capsys):
    email = f"founder-{uuid.uuid4().hex}@example.com"
    with SessionLocal() as db:
        user = _user(db, email=email)
        db.commit()
    assert manage_user_main(["grant-coach-access", email, "--plan", "coach_unlimited", "--no-expiry", "--reason", "founder"]) == 0
    assert "Expires: never" in capsys.readouterr().out
    assert manage_user_main(["show-access", email]) == 0
    shown = capsys.readouterr().out
    assert "Role: COACH" in shown and "Active: yes" in shown
    assert "Plan: coach_unlimited" in shown and "Limit: unlimited" in shown
    assert manage_user_main(["revoke-coach-access", email]) == 0
    assert "Revoked 1" in capsys.readouterr().out
    assert manage_user_main(["show-access", email]) == 0
    assert "Active: no" in capsys.readouterr().out
    with SessionLocal() as db:
        user = db.query(User).filter_by(email=email).one()
        workspace = db.query(Workspace).filter_by(owner_user_id=user.id).one()
        grant = db.query(AccessGrant).filter_by(workspace_id=workspace.id).one()
        assert grant.revoked_at is not None
        assert db.query(AccessGrant).filter_by(id=grant.id).count() == 1
        assert db.query(AuditEvent).filter_by(event_type="ACCESS_REVOKED", resource_id=grant.id).count() == 1
        assert user.role == "COACH"

    assert manage_user_main(["revoke-coach-access", email]) == 0
    assert "No active access grants" in capsys.readouterr().out


def test_cli_errors_for_unknown_users_invalid_plan_and_bad_duration(capsys):
    assert manage_user_main(["grant-coach-access", "missing@example.com", "--plan", "coach_beta", "--days", "1"]) == 1
    assert "No account found" in capsys.readouterr().err

    email = f"invalid-{uuid.uuid4().hex}@example.com"
    with SessionLocal() as db:
        _user(db, email=email)
        db.commit()
    assert manage_user_main(["grant-coach-access", email, "--plan", "coach_beta", "--days", "0"]) == 1
    assert "positive" in capsys.readouterr().err
    assert manage_user_main(["grant-coach-access", email, "--plan", "coach_beta", "--days", "-2"]) == 1
    assert "positive" in capsys.readouterr().err
    for args in (
        ["grant-coach-access", email, "--plan", "coach_beta", "--days", "1", "--no-expiry"],
        ["grant-coach-access", email, "--plan", "coach_beta"],
    ):
        with pytest.raises(SystemExit):
            manage_user_main(args)
    with pytest.raises(SystemExit):
        manage_user_main(["grant-coach-access", email, "--plan", "invalid", "--days", "1"])
    assert PLAN_CONFIG["coach_beta"]["max_active_athletes"] == 20

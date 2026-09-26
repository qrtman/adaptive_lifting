"""Workspace creation and coach roster helpers.

Training plans remain owned by athlete users. Workspaces are only the future
coach billing and entitlement boundary in this phase.
"""

import json
import uuid

from sqlalchemy import func

from .database import AuditEvent, CoachingRelationship, User, Workspace, WorkspaceMember


def _audit(db, event_type, resource_type, resource_id, metadata=None):
    db.add(AuditEvent(
        id=str(uuid.uuid4()),
        actor_user_id=None,
        event_type=event_type,
        resource_type=resource_type,
        resource_id=str(resource_id),
        metadata_json=json.dumps(metadata or {}),
    ))


def ensure_default_workspace_for_coach(db, user):
    """Return the coach's one default workspace, creating its OWNER member once.

    Changes are flushed into the caller's transaction and are committed by the
    caller so workspace creation can be atomic with a grant or promotion.
    """
    if user is None or user.id is None:
        raise ValueError("A persisted user is required")
    persisted_user = db.query(User).filter(User.id == user.id).one_or_none()
    if persisted_user is None:
        raise ValueError("User does not exist")
    if persisted_user.role != "COACH":
        raise ValueError("Only coaches can have a default workspace")

    workspace = db.query(Workspace).filter(Workspace.owner_user_id == persisted_user.id).one_or_none()
    if workspace is None:
        display_name = (persisted_user.display_name or "").strip()
        if display_name:
            label = display_name
        else:
            label = persisted_user.email.split("@", 1)[0]
        workspace = Workspace(
            id=str(uuid.uuid4()),
            name=f"{label} Coaching",
            owner_user_id=persisted_user.id,
        )
        db.add(workspace)
        db.flush()
        _audit(db, "WORKSPACE_CREATED", "Workspace", workspace.id, {"owner_user_id": persisted_user.id})

    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.user_id == persisted_user.id,
    ).one_or_none()
    if member is None:
        db.add(WorkspaceMember(
            id=str(uuid.uuid4()), workspace_id=workspace.id,
            user_id=persisted_user.id, role="OWNER",
        ))
        _audit(db, "WORKSPACE_MEMBER_ADDED", "Workspace", workspace.id, {
            "user_id": persisted_user.id, "role": "OWNER",
        })
    elif member.role != "OWNER":
        # The owner relationship is server-controlled, never accepted from a client.
        member.role = "OWNER"
    db.flush()
    return workspace


def get_active_athlete_count(db, workspace):
    """Count current coach links via the workspace owner.

    Keeping this lookup here lets the relationship move to workspace ownership
    later without changing CLI/reporting callers.
    """
    owner_id = workspace.owner_user_id if isinstance(workspace, Workspace) else str(workspace)
    return db.query(func.count(CoachingRelationship.id)).filter(
        CoachingRelationship.coach_id == owner_id,
        CoachingRelationship.ended_at.is_(None),
    ).scalar() or 0

import asyncio
import json
from datetime import datetime
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .database import get_db, DomainEvent, Workout, User, Session as AuthSession, SessionLocal
from .main import get_current_user, assert_plan_access, session_owner_id

router = APIRouter()

async def get_events(workout_id: str, user_id: str, auth_session_id: str, last_event_id: str = None):
    last_check_id = last_event_id
    while True:
        db = SessionLocal()
        try:
            auth_session = db.query(AuthSession).filter(
                AuthSession.id == auth_session_id,
                AuthSession.user_id == user_id,
                AuthSession.jwt_id == auth_session_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.utcnow(),
            ).first()
            user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
            workout = db.query(Workout).filter(Workout.id == workout_id).first()
            if not auth_session or not user or not workout:
                return
            owner_id = session_owner_id(db, workout)
            if not owner_id:
                return
            try:
                assert_plan_access(db, user, owner_id)
            except HTTPException:
                return

            query = db.query(DomainEvent).filter(DomainEvent.workout_id == workout_id)
            if last_check_id:
                query = query.filter(DomainEvent.id > last_check_id)
            events = query.order_by(DomainEvent.created_at).all()
            messages = [
                (e.id, f"id: {e.id}\nevent: {e.event_type}\ndata: {e.payload_json}\n\n")
                for e in events
            ]
        finally:
            db.close()

        for event_id, message in messages:
            yield message
            last_check_id = event_id
        await asyncio.sleep(2)
        yield ": heartbeat\n\n"

@router.get("/api/workouts/{workout_id}/live")
async def live_workout_events(
    workout_id: str,
    request: Request,
    last_event_id: str = Header(None, alias="Last-Event-ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    owner_id = session_owner_id(db, workout)
    if not owner_id:
        raise HTTPException(status_code=404, detail="Workout not found")
    assert_plan_access(db, current_user, owner_id)
    auth_session_id = getattr(request.state, "auth_session_id", None)
    if not auth_session_id:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
        
    return StreamingResponse(
        get_events(workout_id, current_user.id, auth_session_id, last_event_id),
        media_type="text/event-stream"
    )

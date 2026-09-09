import asyncio
from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .access import require_visible_workout
from .database import get_db, DomainEvent, User
from .main import get_current_user

router = APIRouter()

async def get_events(workout_id: str, db: Session, last_event_id: str = None):
    # Initial replay of missed events
    query = db.query(DomainEvent).filter(DomainEvent.workout_id == workout_id)
    if last_event_id:
        query = query.filter(DomainEvent.id > last_event_id)
    
    events = query.order_by(DomainEvent.created_at).all()
    for e in events:
        yield f"id: {e.id}\nevent: {e.event_type}\ndata: {e.payload_json}\n\n"

    last_check_id = events[-1].id if events else last_event_id

    # Polling loop
    while True:
        await asyncio.sleep(2)
        q = db.query(DomainEvent).filter(DomainEvent.workout_id == workout_id)
        if last_check_id:
            q = q.filter(DomainEvent.id > last_check_id)
        new_events = q.order_by(DomainEvent.created_at).all()
        
        for e in new_events:
            yield f"id: {e.id}\nevent: {e.event_type}\ndata: {e.payload_json}\n\n"
            last_check_id = e.id
        
        # Keepalive
        yield ": heartbeat\n\n"

@router.get("/api/workouts/{workout_id}/live")
async def live_workout_events(
    workout_id: str,
    last_event_id: str = Header(None, alias="Last-Event-ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_visible_workout(db, current_user, workout_id)

    return StreamingResponse(
        get_events(workout_id, db, last_event_id), 
        media_type="text/event-stream"
    )

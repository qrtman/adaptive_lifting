import asyncio
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .database import get_db, DomainEvent, Workout, Microcycle, User
from .main import get_current_user

router = APIRouter()


def _events_for_workout(db: Session, workout_id: str, last_event_id: str | None):
    query = db.query(DomainEvent).filter(DomainEvent.workout_id == workout_id)
    if last_event_id:
        query = query.filter(DomainEvent.id > last_event_id)
    return query.order_by(DomainEvent.created_at, DomainEvent.id).all()


def _events_for_athlete(db: Session, athlete_id: str, last_event_id: str | None):
    query = (
        db.query(DomainEvent)
        .join(Workout, Workout.id == DomainEvent.workout_id)
        .outerjoin(Microcycle, Microcycle.id == Workout.microcycle_id)
        .filter((Workout.owner_id == athlete_id) | (Microcycle.owner_id == athlete_id))
    )
    if last_event_id:
        query = query.filter(DomainEvent.id > last_event_id)
    return query.order_by(DomainEvent.created_at, DomainEvent.id).all()


def _format(event: DomainEvent) -> str:
    return f"id: {event.id}\nevent: {event.event_type}\ndata: {event.payload_json}\n\n"


def _latest_workout_event_id(db: Session, workout_id: str) -> str | None:
    row = (
        db.query(DomainEvent)
        .filter(DomainEvent.workout_id == workout_id)
        .order_by(DomainEvent.created_at.desc(), DomainEvent.id.desc())
        .first()
    )
    return row.id if row else None


def _latest_athlete_event_id(db: Session, athlete_id: str) -> str | None:
    row = (
        db.query(DomainEvent)
        .join(Workout, Workout.id == DomainEvent.workout_id)
        .outerjoin(Microcycle, Microcycle.id == Workout.microcycle_id)
        .filter((Workout.owner_id == athlete_id) | (Microcycle.owner_id == athlete_id))
        .order_by(DomainEvent.created_at.desc(), DomainEvent.id.desc())
        .first()
    )
    return row.id if row else None


async def get_events(workout_id: str, db: Session, last_event_id: str = None):
    if last_event_id:
        events = _events_for_workout(db, workout_id, last_event_id)
        for event in events:
            yield _format(event)
        last_check_id = events[-1].id if events else last_event_id
    else:
        last_check_id = _latest_workout_event_id(db, workout_id)

    while True:
        await asyncio.sleep(2)
        new_events = _events_for_workout(db, workout_id, last_check_id)
        for event in new_events:
            yield _format(event)
            last_check_id = event.id
        yield ": heartbeat\n\n"


async def get_athlete_events(athlete_id: str, db: Session, last_event_id: str = None):
    if last_event_id:
        events = _events_for_athlete(db, athlete_id, last_event_id)
        for event in events:
            yield _format(event)
        last_check_id = events[-1].id if events else last_event_id
    else:
        last_check_id = _latest_athlete_event_id(db, athlete_id)

    while True:
        await asyncio.sleep(2)
        new_events = _events_for_athlete(db, athlete_id, last_check_id)
        for event in new_events:
            yield _format(event)
            last_check_id = event.id
        yield ": heartbeat\n\n"


@router.get("/api/workouts/{workout_id}/live")
async def live_workout_events(
    workout_id: str,
    request: Request,
    last_event_id: str = Header(None, alias="Last-Event-ID"),
    db: Session = Depends(get_db),
):
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    return StreamingResponse(
        get_events(workout_id, db, last_event_id),
        media_type="text/event-stream",
    )


@router.get("/api/athletes/{athlete_id}/live")
async def live_athlete_events(
    athlete_id: str,
    request: Request,
    last_event_id: str = Header(None, alias="Last-Event-ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from .main import assert_plan_access
    assert_plan_access(db, current_user, athlete_id)
    return StreamingResponse(
        get_athlete_events(athlete_id, db, last_event_id),
        media_type="text/event-stream",
    )

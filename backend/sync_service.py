from sqlalchemy.orm import Session
from datetime import datetime, timezone
import dateutil.parser
from fastapi import HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from .database import (
    Workout, ExerciseSet, Exercise, SyncMutation, 
    WorkoutLock, DomainEvent, AuditEvent
)

class SyncFieldMutation(BaseModel):
    entity: str
    id: str
    mutation_id: str
    updated_at: str
    fields: Dict[str, Any]

class SyncPayload(BaseModel):
    schema_version: int
    client_device_id: str
    workout_id: str
    last_updated_at: str
    changes: List[SyncFieldMutation]

def resolve_sync_payload(db: Session, payload: SyncPayload, current_user_id: str) -> dict:
    if payload.schema_version != 1:
        raise HTTPException(status_code=409, detail={"error": {"code": "CLIENT_SCHEMA_UNSUPPORTED", "message": "App update required."}})
    
    workout = db.query(Workout).filter(Workout.id == payload.workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
        
    # Check locks
    lock = db.query(WorkoutLock).filter(WorkoutLock.workout_id == workout.id).first()
    if lock and lock.holder_user_id != current_user_id and lock.expires_at > datetime.utcnow():
        raise HTTPException(status_code=409, detail={"error": {"code": "WORKOUT_LOCKED", "message": "This workout is locked right now."}})
    if workout.status in ("COMPLETED", "MISSED"):
        raise HTTPException(status_code=409, detail={"error": {"code": "WORKOUT_LOCKED", "message": "Session is locked"}})

    # Process mutations
    accepted_ids = []
    rejected = []
    conflicts = []
    
    for change in payload.changes:
        # Idempotency check
        existing_mut = db.query(SyncMutation).filter(
            SyncMutation.client_device_id == payload.client_device_id,
            SyncMutation.mutation_id == change.mutation_id
        ).first()
        
        if existing_mut:
            if existing_mut.result == "ACCEPTED":
                accepted_ids.append(change.mutation_id)
            else:
                rejected.append(change.mutation_id)
            continue
            
        try:
            client_updated = dateutil.parser.isoparse(change.updated_at).replace(tzinfo=None)
        except Exception:
            client_updated = datetime.utcnow()
            
        # Clock skew check
        if (client_updated - datetime.utcnow()).total_seconds() > 300:
            rejected.append(change.mutation_id)
            conflicts.append({"mutation_id": change.mutation_id, "reason": "CLIENT_CLOCK_SKEW"})
            db.add(SyncMutation(
                mutation_id=change.mutation_id, client_device_id=payload.client_device_id,
                entity_type=change.entity, entity_id=change.id, field_path="ALL",
                updated_at=client_updated, result="REJECTED_CLOCK_SKEW"
            ))
            continue

        model_class = None
        if change.entity == "ExerciseSet": model_class = ExerciseSet
        elif change.entity == "Exercise": model_class = Exercise
        elif change.entity == "Workout": model_class = Workout
        
        if not model_class:
            rejected.append(change.mutation_id)
            continue
            
        entity = db.query(model_class).filter(model_class.id == change.id).first()
        if not entity:
            rejected.append(change.mutation_id)
            continue

        parent_workout_id = None
        if change.entity == "Workout":
            parent_workout_id = entity.id
        elif change.entity == "Exercise":
            parent_workout_id = entity.workout_id
        elif change.entity == "ExerciseSet":
            parent_workout_id = entity.exercise.workout_id if entity.exercise else None
        if parent_workout_id != payload.workout_id:
            rejected.append(change.mutation_id)
            conflicts.append({"mutation_id": change.mutation_id, "reason": "WORKOUT_MISMATCH"})
            continue
            
        if entity.deleted_at is not None:
            rejected.append(change.mutation_id)
            conflicts.append({"mutation_id": change.mutation_id, "reason": "TOMBSTONE_CONFLICT"})
            db.add(SyncMutation(
                mutation_id=change.mutation_id, client_device_id=payload.client_device_id,
                entity_type=change.entity, entity_id=change.id, field_path="ALL",
                updated_at=client_updated, result="REJECTED_TOMBSTONE"
            ))
            continue

        fields = dict(change.fields or {})
        sets_payload = fields.pop("sets", None) if change.entity == "Exercise" else None
        for field, value in fields.items():
            if hasattr(entity, field):
                setattr(entity, field, value)
        if sets_payload is not None:
            from .set_writes import replace_exercise_sets
            replace_exercise_sets(entity, sets_payload)
                
        entity.updated_at = datetime.utcnow()
        accepted_ids.append(change.mutation_id)
        db.add(SyncMutation(
            mutation_id=change.mutation_id, client_device_id=payload.client_device_id,
            entity_type=change.entity, entity_id=change.id, field_path="ALL",
            updated_at=client_updated, applied_at=datetime.utcnow(), result="ACCEPTED"
        ))
        
    db.commit()
    
    # Recalculate metrics
    from .main import recalculate_metrics
    recalculate_metrics(db, workout.id, workout.dayLabel)
    
    # Refresh to get canonical state
    db.refresh(workout)
    
    # Emit DomainEvent for SSE
    import json
    db.add(DomainEvent(
        id=f"evt-{datetime.utcnow().timestamp()}",
        workout_id=workout.id,
        event_type="WORKOUT_SYNCED",
        payload_json=json.dumps({"accepted": len(accepted_ids), "tonnage": workout.tonnage})
    ))
    db.commit()

    return {
        "workout_id": workout.id,
        "canonical_last_updated_at": workout.updated_at.isoformat() + "Z",
        "accepted_mutation_ids": accepted_ids,
        "rejected_mutations": rejected,
        "conflicts": conflicts
    }

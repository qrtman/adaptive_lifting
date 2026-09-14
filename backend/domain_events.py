"""Domain events for SSE. REST writes and sync share the same WORKOUT_SYNCED type."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from .database import DomainEvent


def emit_workout_synced(db: Session, workout_id: str, extra: Optional[Dict[str, Any]] = None) -> DomainEvent:
    payload = {"workout_id": workout_id, **(extra or {})}
    event = DomainEvent(
        id=f"evt-{datetime.utcnow().timestamp():.6f}-{uuid.uuid4().hex[:8]}",
        workout_id=workout_id,
        event_type="WORKOUT_SYNCED",
        payload_json=json.dumps(payload),
    )
    db.add(event)
    return event

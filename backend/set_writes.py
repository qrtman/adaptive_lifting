from datetime import datetime
from typing import List

from .database import Exercise, ExerciseSet


def replace_exercise_sets(exercise: Exercise, rows: List[dict]) -> None:
    """Replace live sets with the posted plan/log rows. Missing rows are tombstoned."""
    now = datetime.utcnow()
    incoming_ids = []
    for index, row in enumerate(rows):
        set_id = row.get("id") or f"s-{index}-{exercise.id[-6:]}"
        incoming_ids.append(set_id)
        existing = next((s for s in (exercise.sets or []) if s.id == set_id), None)
        intensity = row.get("intensityType") or row.get("intensity_type") or "RPE"
        if intensity not in ("RPE", "PERCENT"):
            intensity = "RPE"
        planned_rpe = row.get("plannedRpe")
        if planned_rpe is None:
            planned_rpe = row.get("target_value")
        payload = {
            "lexo_rank": f"a{index}",
            "label": row.get("label") or f"Set {index + 1}",
            "plannedWeight": row.get("plannedWeight"),
            "plannedReps": row.get("plannedReps"),
            "plannedRpe": planned_rpe,
            "intensity_type": intensity,
            "isAuto": bool(row.get("isAuto") or False),
            "isTop": bool(row.get("isTop") if row.get("isTop") is not None else index == 0),
            "actual": row.get("actual"),
            "reps": row.get("reps"),
            "executedRpe": row.get("executedRpe"),
        }
        if existing:
            if existing.deleted_at is not None:
                existing.deleted_at = None
            for key, value in payload.items():
                setattr(existing, key, value)
        else:
            exercise.sets.append(ExerciseSet(
                id=set_id,
                exercise_id=exercise.id,
                **payload,
            ))
    for existing in list(exercise.sets or []):
        if existing.id not in incoming_ids and existing.deleted_at is None:
            existing.deleted_at = now

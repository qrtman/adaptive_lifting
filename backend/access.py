from sqlalchemy.orm import Session

from .database import CoachingRelationship, Exercise, ExerciseSet, Microcycle, User, Workout
from .errors import api_error

ATHLETE_SET_FIELDS = frozenset({
    "actual",
    "reps",
    "executedRpe",
    "note",
    "velocity",
    "readiness",
    "hrv",
})
ATHLETE_WORKOUT_FIELDS = frozenset({"status", "athlete_bw", "tonnage", "delta"})
ATHLETE_EXERCISE_FIELDS = frozenset({"vol", "top"})


def get_visible_microcycles(db: Session, current_user: User):
    if current_user.role == "COACH":
        relationships = db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == current_user.id
        ).all()
        athlete_ids = [rel.athlete_id for rel in relationships]
        if not athlete_ids:
            return []
        return db.query(Microcycle).filter(Microcycle.owner_id.in_(athlete_ids)).all()
    return db.query(Microcycle).filter(Microcycle.owner_id == current_user.id).all()


def require_visible_microcycle(db: Session, current_user: User, microcycle_id: str) -> Microcycle:
    micro = db.query(Microcycle).filter(Microcycle.id == microcycle_id).first()
    if not micro:
        raise api_error(404, "MICROCYCLE_NOT_FOUND", "Microcycle not found")
    visible_ids = {row.id for row in get_visible_microcycles(db, current_user)}
    if micro.id not in visible_ids:
        raise api_error(403, "FORBIDDEN", "Not authorized")
    return micro


def require_visible_workout(db: Session, current_user: User, workout_id: str) -> Workout:
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise api_error(404, "WORKOUT_NOT_FOUND", "Workout not found")
    require_visible_microcycle(db, current_user, workout.microcycle_id)
    return workout


def require_visible_set(
    db: Session,
    current_user: User,
    set_id: str,
    workout_id: str | None = None,
    exercise_id: str | None = None,
) -> tuple[ExerciseSet, Workout]:
    row = db.query(ExerciseSet).filter(ExerciseSet.id == set_id).first()
    if not row:
        raise api_error(404, "SET_NOT_FOUND", "Target set not found")
    exercise = db.query(Exercise).filter(Exercise.id == row.exercise_id).first()
    if not exercise:
        raise api_error(404, "EXERCISE_NOT_FOUND", "Exercise not found")
    if exercise_id is not None and exercise.id != exercise_id:
        raise api_error(403, "FORBIDDEN", "Set does not belong to that exercise")
    workout = db.query(Workout).filter(Workout.id == exercise.workout_id).first()
    if not workout:
        raise api_error(404, "WORKOUT_NOT_FOUND", "Workout not found")
    if workout_id is not None and workout.id != workout_id:
        raise api_error(403, "FORBIDDEN", "Set does not belong to that workout")
    require_visible_workout(db, current_user, workout.id)
    return row, workout


def athlete_forbidden_fields(entity: str, fields: dict) -> list[str]:
    allowed = {
        "ExerciseSet": ATHLETE_SET_FIELDS,
        "Workout": ATHLETE_WORKOUT_FIELDS,
        "Exercise": ATHLETE_EXERCISE_FIELDS,
    }.get(entity, frozenset())
    return [name for name in fields if name not in allowed]

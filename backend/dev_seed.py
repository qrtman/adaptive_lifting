"""Stable local-only data for exercising coach-to-athlete UI flows."""
from __future__ import annotations

from datetime import date, timedelta

from .database import CoachingRelationship, Exercise, ExerciseSet, Microcycle, User, Workout

DEMO_COACH_EMAIL = "dev.coach@local.test"
DEMO_ATHLETE_EMAIL = "dev.athlete@local.test"
DEMO_PASSWORD = "AdaptiveLiftingDev"
DEMO_COACH_ID = "dev-coach"
DEMO_ATHLETE_ID = "dev-athlete"


def ensure_demo_accounts(db, password_hasher) -> None:
    """Idempotently create one linked pair and one compact athlete training week."""
    coach = db.query(User).filter(User.email == DEMO_COACH_EMAIL).first()
    if not coach:
        coach = User(id=DEMO_COACH_ID, email=DEMO_COACH_EMAIL, hashed_password=password_hasher(DEMO_PASSWORD), role="COACH")
        db.add(coach)

    athlete = db.query(User).filter(User.email == DEMO_ATHLETE_EMAIL).first()
    if not athlete:
        athlete = User(id=DEMO_ATHLETE_ID, email=DEMO_ATHLETE_EMAIL, hashed_password=password_hasher(DEMO_PASSWORD), role="ATHLETE")
        db.add(athlete)
    db.flush()

    link = db.query(CoachingRelationship).filter(CoachingRelationship.athlete_id == athlete.id).first()
    if not link:
        db.add(CoachingRelationship(coach_id=coach.id, athlete_id=athlete.id))

    existing = db.query(Microcycle).filter(Microcycle.owner_id == athlete.id).first()
    if not existing:
        monday = date.today() - timedelta(days=date.today().weekday())
        microcycle = Microcycle(
            id="dev-athlete-week-1",
            weekName="Week 1",
            focus="Competition lift exposure",
            status="ACTIVE",
            active=True,
            owner_id=athlete.id,
        )
        db.add(microcycle)
        workouts = [
            ("D1", "Squat + Bench", 0, "#fb923c", "Squat", "Squat", 170, 4, 7.5),
            ("D2", "Bench + Deadlift", 2, "#34d399", "Bench", "Bench", 105, 5, 7.0),
            ("D3", "Deadlift", 4, "#8b5cf6", "Deadlift", "Deadlift", 200, 3, 8.0),
        ]
        for index, (day_label, title, offset, color, category, exercise_title, weight, reps, rpe) in enumerate(workouts, start=1):
            workout_id = f"dev-athlete-d{index}"
            workout = Workout(
                id=workout_id,
                date=(monday + timedelta(days=offset)).isoformat(),
                dayLabel=day_label,
                title=title,
                color=color,
                status="PLANNED",
                owner_id=athlete.id,
                microcycle_id=microcycle.id,
                block_label="Demo Block",
                week_label="Week 1",
            )
            db.add(workout)
            exercise = Exercise(
                id=f"{workout_id}-main",
                lexo_rank="a0",
                title=exercise_title,
                variation=exercise_title,
                tier="Comp",
                lift_category=category,
                movement_pattern=category,
                workout_id=workout_id,
            )
            db.add(exercise)
            for set_number in range(1, 4):
                db.add(ExerciseSet(
                    id=f"{workout_id}-set-{set_number}",
                    lexo_rank=f"a{set_number}",
                    label=str(set_number),
                    plannedWeight=weight,
                    plannedReps=reps,
                    plannedRpe=rpe,
                    exercise_id=exercise.id,
                ))
    db.commit()

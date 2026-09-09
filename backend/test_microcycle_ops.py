import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, Exercise, ExerciseSet, Microcycle, Workout
from backend.microcycle_ops import (
    apply_bounds,
    copy_microcycle,
    copy_week_name,
    date_in_microcycle,
    resolved_bounds,
)


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _week(db, owner_id="athlete-1", week_id="w1", name="Week 1", dates=("2026-09-01", "2026-09-03")):
    micro = Microcycle(
        id=week_id,
        weekName=name,
        focus="Base",
        status="ACTIVE",
        active=True,
        owner_id=owner_id,
    )
    db.add(micro)
    db.flush()
    for index, date in enumerate(dates):
        workout = Workout(
            id=f"{week_id}-d{index + 1}",
            date=date,
            dayLabel=f"D{index + 1}",
            title="Squat",
            tonnage=0,
            delta=0,
            color="mac-blue",
            status="COMPLETED" if index == 0 else "PLANNED",
            microcycle_id=micro.id,
        )
        db.add(workout)
        db.flush()
        exercise = Exercise(
            id=f"{week_id}-d{index + 1}-e1",
            title="Squat",
            variation="Low bar",
            tags_raw="Squat",
            workout_id=workout.id,
        )
        db.add(exercise)
        db.flush()
        db.add(ExerciseSet(
            id=f"{week_id}-d{index + 1}-e1-s1",
            label="Top",
            plannedWeight=200,
            plannedReps=1,
            plannedRpe=8,
            isTop=True,
            actual=202.5 if index == 0 else None,
            reps=1 if index == 0 else None,
            executedRpe=9 if index == 0 else None,
            exercise_id=exercise.id,
        ))
    db.commit()
    db.refresh(micro)
    return micro


def test_copy_week_name_skips_taken_labels():
    assert copy_week_name("Week 3", []) == "Week 3 copy"
    assert copy_week_name("Week 3", ["Week 3", "Week 3 copy"]) == "Week 3 copy 2"


def test_resolved_bounds_default_to_iso_week():
    db = _session()
    week = _week(db)
    assert resolved_bounds(week) == ("2026-08-31", "2026-09-06")
    assert date_in_microcycle("2026-09-05", week) is True
    assert date_in_microcycle("2026-09-16", week) is False


def test_stored_bounds_override_iso_week():
    db = _session()
    week = _week(db)
    apply_bounds(week, "2026-09-01", "2026-09-20")
    db.commit()
    db.refresh(week)
    assert resolved_bounds(week) == ("2026-09-01", "2026-09-20")
    assert date_in_microcycle("2026-09-16", week) is True
    assert date_in_microcycle("2026-09-21", week) is False


def test_copy_microcycle_strips_logs_and_shifts_dates():
    db = _session()
    first = _week(db, week_id="w1", name="Week 1")
    _week(db, week_id="w2", name="Week 2", dates=("2026-09-08", "2026-09-10"))
    siblings = db.query(Microcycle).all()
    copied = copy_microcycle(db, first, siblings)
    assert copied.id != "w1"
    assert copied.weekName == "Week 1 copy"
    assert copied.status == "DRAFT"
    assert copied.startDate == "2026-09-14"
    assert copied.endDate == "2026-09-20"
    assert {row.id for row in copied.workouts}.isdisjoint({"w1-d1", "w1-d2"})
    logged = copied.workouts[0].exercises[0].sets[0]
    assert logged.plannedWeight == 200
    assert logged.actual is None
    assert logged.reps is None
    assert copied.workouts[0].status == "PLANNED"
    assert copied.workouts[0].date == "2026-09-15"

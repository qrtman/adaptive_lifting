from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.accessory_migration import expand_legacy_accessory_sets, leading_number, coerce_float, coerce_int
from backend.database import (
    Accessory,
    Base,
    Exercise,
    ExerciseSet,
    Microcycle,
    Workout,
    migrate_accessories_to_exercises,
)


def test_leading_number_from_range():
    assert leading_number("10-12", 8, "int") == 10
    assert leading_number("3 sets", 1, "int") == 3
    assert leading_number("", 8.0, "float") == 8.0
    assert leading_number(None, None, "float") is None


def test_coerce_empty_is_none_not_zero():
    assert coerce_float("") is None
    assert coerce_int("") is None
    assert coerce_float("120") == 120.0
    assert coerce_int("12") == 12
    assert not isinstance(coerce_float("120"), str)


def test_expand_pending_accessory_has_individual_sets():
    sets = expand_legacy_accessory_sets("3", "12", "9", "", "", "", "Pending")
    assert len(sets) == 3
    assert all(item["plannedReps"] == 12 for item in sets)
    assert all(item["plannedRpe"] == 9.0 for item in sets)
    assert all(item["actual"] is None for item in sets)
    assert all(item["reps"] is None for item in sets)
    assert all(isinstance(item["plannedReps"], int) for item in sets)
    assert all(isinstance(item["plannedRpe"], float) for item in sets)


def test_expand_done_accessory_copies_log_onto_each_set():
    sets = expand_legacy_accessory_sets("3", "10-12", "7", "120", "12", "7", "Done")
    assert len(sets) == 3
    assert sets[0]["plannedReps"] == 10
    assert sets[0]["plannedWeight"] == 120.0
    assert sets[0]["actual"] == 120.0
    assert sets[0]["reps"] == 12
    assert sets[0]["executedRpe"] == 7.0


def test_migrate_tombstones_legacy_and_writes_numeric_sets():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(Microcycle(id="mc1", weekName="Microcycle 01", focus="t", status="ACTIVE"))
    db.add(Workout(
        id="w1", date="2026-09-01", dayLabel="D1", title="t",
        tonnage=0, delta=0, color="gray", status="PLANNED", microcycle_id="mc1",
    ))
    db.add(Accessory(
        id="acc-1",
        name="Leg Press",
        prescribedSets="3",
        targetReps="10-12",
        targetRpe="7",
        weight="120",
        reps="12",
        executedRpe="7",
        status="Done",
        workout_id="w1",
    ))
    db.commit()

    migrate_accessories_to_exercises(db)

    legacy = db.query(Accessory).filter(Accessory.id == "acc-1").one()
    assert legacy.deleted_at is not None
    exercise = db.query(Exercise).filter(Exercise.id == "acc-1").one()
    assert exercise.tier == "Accessory"
    sets = db.query(ExerciseSet).filter(ExerciseSet.exercise_id == "acc-1").all()
    assert len(sets) == 3
    assert isinstance(sets[0].plannedWeight, float)
    assert sets[0].plannedWeight == 120.0
    assert isinstance(sets[0].plannedReps, int)
    assert sets[0].plannedReps == 10
    assert isinstance(sets[0].plannedRpe, float)
    assert sets[0].actual == 120.0
    assert sets[0].reps == 12
    assert sets[0].executedRpe == 7.0
    db.close()

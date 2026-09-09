import json
from pathlib import Path

from backend.math_utils import (
    calculate_acwr_series,
    calculate_attempt_jumps,
    calculate_dots,
    calculate_e1rm,
    calculate_e1rm_linear_decay,
    calculate_inol,
    round_to_competition_plates,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[1] / "tests" / "math_vectors.json").read_text(encoding="utf-8")
)


def test_shared_e1rm_vectors():
    for case in VECTORS["e1rm"]:
        assert calculate_e1rm(case["weight"], case["reps"], case["rpe"]) == case["expected"]
        assert calculate_e1rm_linear_decay(case["weight"], case["reps"], case["rpe"]) == case["expected"]


def test_shared_inol_vectors():
    for case in VECTORS["inol"]:
        assert calculate_inol(case["reps"], case["intensity_pct"]) == case["expected"]


def test_shared_plate_vectors():
    for case in VECTORS["plates"]:
        assert round_to_competition_plates(case["weight"]) == case["expected"]


def test_shared_dots_vectors():
    for case in VECTORS["dots"]:
        assert calculate_dots(case["gender"], case["bodyweight"], case["total"]) == case["expected"]


def test_shared_attempt_vectors():
    for case in VECTORS["attempts"]:
        jumps = calculate_attempt_jumps(case["first_attempt"], case["profile"], case["gender"])
        assert jumps["suggested_second"] == case["suggested_second"]
        assert jumps["third_ceiling"] == case["third_ceiling"]


def test_acwr_series_calculations():
    assert calculate_acwr_series([]) == []

    class MockSet:
        def __init__(self, actual, reps):
            self.actual = actual
            self.reps = reps

    class MockExercise:
        def __init__(self, sets):
            self.sets = sets

    class MockWorkout:
        def __init__(self, date, tonnage, exercises):
            self.date = date
            self.tonnage = tonnage
            self.exercises = exercises

    w1 = MockWorkout("2026-05-01", 5000.0, [MockExercise([MockSet(100.0, 10) for _ in range(5)])])
    w2 = MockWorkout("2026-05-11", 4000.0, [MockExercise([MockSet(100.0, 10) for _ in range(4)])])
    series = calculate_acwr_series([w1, w2])

    assert len(series) == 11
    assert series[0]["date"] == "2026-05-01"
    assert series[-1]["date"] == "2026-05-11"
    assert series[0]["daily_tonnage"] == 5000.0
    assert series[5]["daily_tonnage"] == 0.0
    assert series[-1]["daily_tonnage"] == 4000.0
    assert series[0]["acute_workload"] == 5000.0
    assert series[0]["chronic_workload"] == 5000.0
    assert series[0]["acwr"] == 4.0
    assert series[0]["zone"] == "DANGER_ZONE"

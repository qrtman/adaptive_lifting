import json
from pathlib import Path

from backend.math_utils import (
    calculate_attempt_jumps,
    calculate_dots,
    calculate_e1rm,
    calculate_inol,
    round_to_competition_plates,
)

VECTORS = json.loads((Path(__file__).parent / "math_vectors.json").read_text(encoding="utf-8"))


def test_shared_e1rm_vectors():
    for case in VECTORS["e1rm"]:
        assert calculate_e1rm(case["weight"], case["reps"], case["rpe"]) == case["expected"]


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

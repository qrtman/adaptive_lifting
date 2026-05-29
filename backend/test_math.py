import sys
import os
import math

# Adjust path to import local modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.math_utils import (
    calculate_e1rm_linear_decay, 
    calculate_inol, 
    calculate_dots, 
    round_to_competition_plates, 
    calculate_attempt_jumps,
    calculate_acwr_series
)

def test_e1rm_calculations():
    print("Testing e1RM Calculations...")
    
    # 1. Zero guards
    assert calculate_e1rm_linear_decay(0, 5, 8.0) == 0.0, "Zero weight guard failed"
    assert calculate_e1rm_linear_decay(100, 0, 8.0) == 0.0, "Zero reps guard failed"
    
    # 2. RPE boundaries
    assert calculate_e1rm_linear_decay(100, 5, 5.5) == 100.0, "RPE < 6.0 fallback failed"
    assert calculate_e1rm_linear_decay(100, 13, 8.0) == 100.0, "Reps > 12 fallback failed"
    
    # 3. Standard e1RM projection: 100kg x 1 rep @ RPE 10 -> 100.0kg
    assert calculate_e1rm_linear_decay(100, 1, 10.0) == 100.0, "Top single RPE 10 failed"

    # 4. Standard e1RM projection: 100kg x 5 reps @ RPE 9 -> 117.65kg
    assert calculate_e1rm_linear_decay(100, 5, 9.0) == 117.65, "Standard RPE 9 failed"

    # 5. Cap drop check: 100kg x 10 reps @ RPE 8 -> 133.33
    assert calculate_e1rm_linear_decay(100, 10, 8.0) == 133.33, "High-rep capping constraint failed"
    print("  [OK] e1RM tests passed.")

def test_inol_calculations():
    print("Testing INOL Fatigue calculations...")
    
    # 1. Standard calculation: 5 reps @ 85% intensity -> 5 / (100 - 85) = 5 / 15 = 0.33
    assert calculate_inol(5, 85.0) == 0.33, "Standard INOL failed"
    
    # 2. Intensity cap at 100%: 5 reps @ 100% intensity -> should cap at reps * 1.0
    assert calculate_inol(5, 100.0) == 5.0, "Intensity >= 100% cap failed"
    assert calculate_inol(5, 105.0) == 5.0, "Intensity > 100% cap failed"
    
    # 3. Zero intensity guard
    assert calculate_inol(5, 0.0) == 0.0, "Zero intensity guard failed"
    assert calculate_inol(5, -10.0) == 0.0, "Negative intensity guard failed"
    print("  [OK] INOL tests passed.")

def test_dots_coefficients():
    print("Testing DOTS Coefficient calculations...")
    
    # 1. Zeros guard
    assert calculate_dots("MALE", 0.0, 500.0) == 0.0, "Zero bodyweight guard failed"
    assert calculate_dots("MALE", 90.0, 0.0) == 0.0, "Zero total guard failed"
    
    # 2. Male calculations (90kg lifter, 600kg total)
    male_score = calculate_dots("MALE", 90.0, 600.0)
    print(f"  - Male DOTS Score (90kg BW, 600kg Total): {male_score}")
    assert male_score > 0, "Male DOTS calculation error"
    
    # 3. Female calculations (60kg lifter, 350kg total)
    female_score = calculate_dots("FEMALE", 60.0, 350.0)
    print(f"  - Female DOTS Score (60kg BW, 350kg Total): {female_score}")
    assert female_score > 0, "Female DOTS calculation error"
    print("  [OK] DOTS tests passed.")

def test_attempt_rounder():
    print("Testing Attempt Rounded Roundings...")
    
    # 1. Rounds to nearest 2.5kg
    assert round_to_competition_plates(101.2) == 100.0, "Rounding 101.2 failed"
    assert round_to_competition_plates(101.3) == 102.5, "Rounding 101.3 failed"
    assert round_to_competition_plates(102.4) == 102.5, "Rounding 102.4 failed"
    assert round_to_competition_plates(103.8) == 105.0, "Rounding 103.8 failed"
    
    # 2. Attempt jumps checks
    jumps_squat = calculate_attempt_jumps(200.0, "squat_dl", "MALE")
    print(f"  - Suggested jumps (Squat): {jumps_squat}")
    assert "suggested_second" in jumps_squat
    assert "third_ceiling" in jumps_squat
    print("  [OK] Attempt rounding and selector tests passed.")

def test_acwr_series_calculations():
    print("Testing ACWR Series calculations with chronological gap filling...")
    
    # 1. Zero guard/empty workouts
    assert calculate_acwr_series([]) == [], "Empty workouts should return empty series"
    
    # 2. Mock workouts with precise dates
    # We will mock workouts as dicts or lightweight objects
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

    # Scenario: 2 workouts 10 days apart.
    # W1: 2026-05-01: 5000kg tonnage (10 reps x 100kg x 5 sets)
    # W2: 2026-05-11: 4000kg tonnage
    w1 = MockWorkout("2026-05-01", 5000.0, [MockExercise([MockSet(100.0, 10) for _ in range(5)])])
    w2 = MockWorkout("2026-05-11", 4000.0, [MockExercise([MockSet(100.0, 10) for _ in range(4)])])
    
    series = calculate_acwr_series([w1, w2])
    
    # Should have a chronological span from 2026-05-01 to 2026-05-11 (11 dates total)
    assert len(series) == 11, f"Expected 11 days in timeline, got {len(series)}"
    
    # Check chronological ordering
    assert series[0]["date"] == "2026-05-01"
    assert series[-1]["date"] == "2026-05-11"
    
    # Check tonnage assignments
    assert series[0]["daily_tonnage"] == 5000.0
    assert series[5]["daily_tonnage"] == 0.0 # gap day
    assert series[-1]["daily_tonnage"] == 4000.0
    
    # Verify rolling calculations for first day (2026-05-01)
    # Acute = 5000 (just day 1)
    # Chronic = 5000 (day 1 + pre-padded 27 days of 0) -> chronic_avg = 5000 / 28 -> chronic_avg * 7 = 1250
    # ACWR = 5000 / 1250 = 4.0
    assert series[0]["acute_workload"] == 5000.0
    assert series[0]["chronic_workload"] == 5000.0
    assert series[0]["acwr"] == 4.0
    assert series[0]["zone"] == "DANGER_ZONE"
    
    print("  [OK] ACWR series tests passed.")

def run_all_unit_tests():
    print("==================================================")
    print("RUNNING MATH ENGINE UNIT TESTS")
    print("==================================================")
    test_e1rm_calculations()
    test_inol_calculations()
    test_dots_coefficients()
    test_attempt_rounder()
    test_acwr_series_calculations()
    print("==================================================")
    print("ALL MATH ENGINE UNIT TESTS PASSED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_all_unit_tests()

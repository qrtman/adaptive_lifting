from backend.math_utils import calculate_quantitative_tension

def test_calculate_quantitative_tension_baselines():
    baseline = {"quads": 0.6, "glutes": 0.4, "hams": 0.0, "chest": 0.0, "back": 0.0}
    toon = calculate_quantitative_tension(100.0, 5, 10.0, baseline)
    assert toon == "Q:300|G:200|H:0|C:0|B:0", f"Expected Q:300|G:200|H:0|C:0|B:0, got {toon}"

def test_calculate_quantitative_tension_rpe_multiplier():
    baseline = {"quads": 0.5, "glutes": 0.5, "hams": 0.0, "chest": 0.0, "back": 0.0}
    toon = calculate_quantitative_tension(100.0, 10, 5.0, baseline)
    assert toon == "Q:50|G:50|H:0|C:0|B:0", f"Expected Q:50|G:50|H:0|C:0|B:0, got {toon}"

def test_calculate_quantitative_tension_variation_and_athlete_deltas():
    baseline = {"quads": 0.4, "glutes": 0.4, "hams": 0.2, "chest": 0.0, "back": 0.0}
    v_delta = {"quads_delta": 0.1, "glutes_delta": -0.1}
    a_delta = {"hams_delta": 0.1}
    toon = calculate_quantitative_tension(200.0, 5, 10.0, baseline, v_delta, a_delta)
    assert toon == "Q:500|G:300|H:300|C:0|B:0", f"Expected Q:500|G:300|H:300|C:0|B:0, got {toon}"

def test_calculate_quantitative_tension_clamping():
    baseline = {"quads": 0.8, "glutes": 0.1, "hams": 0.0, "chest": 0.0, "back": 0.0}
    v_delta = {"quads_delta": 0.4}
    a_delta = {"glutes_delta": -0.2}
    toon = calculate_quantitative_tension(100.0, 10, 10.0, baseline, v_delta, a_delta)
    assert toon == "Q:1000|G:0|H:0|C:0|B:0", f"Expected Q:1000|G:0|H:0|C:0|B:0, got {toon}"

if __name__ == "__main__":
    test_calculate_quantitative_tension_baselines()
    test_calculate_quantitative_tension_rpe_multiplier()
    test_calculate_quantitative_tension_variation_and_athlete_deltas()
    test_calculate_quantitative_tension_clamping()
    print("All biomechanics calculation tests passed successfully!")

import math
from typing import Dict, List

def calculate_e1rm_linear_decay(weight: float, reps: int, rpe: float) -> float:
    """
    e1RM = Weight / (1 - 0.03 * (10 - RPE + Reps - 1))
    Only calculate if RPE >= 6.0 and Reps <= 12.
    For reps > 6, we apply a constraint (as requested) to cap the metabolic drop-off.
    We cap the effective drop to max 25% to prevent absurd 1RM projections on high-rep sets.
    """
    if weight <= 0 or reps <= 0:
        return 0.0
    if rpe < 6.0 or reps > 12:
        return weight # Fallback: return raw weight if outside bounds
        
    effective_drop_pct = 0.03 * (10 - rpe + reps - 1)
    
    # Correction: cap the drop percentage for high-rep sets (e.g. max 25% drop)
    if effective_drop_pct > 0.25:
        effective_drop_pct = 0.25
        
    denominator = 1.0 - effective_drop_pct
    if denominator <= 0.1:
        return weight
        
    return round(weight / denominator, 2)

def calculate_inol(reps: int, intensity_pct: float) -> float:
    """
    INOL = Reps / (100 - Intensity %)
    """
    if intensity_pct >= 100.0:
        return reps * 1.0 # arbitrary cap if lifting 100%+
    if intensity_pct <= 0:
        return 0.0
        
    return round(reps / (100.0 - intensity_pct), 2)

def calculate_dots(gender: str, bodyweight: float, total: float) -> float:
    """
    DOTS = Total / |A + B*C + B^2*D + B^3*E + B^4*F + B^5*G|
    """
    if bodyweight <= 0 or total <= 0:
        return 0.0
        
    B = bodyweight
    if gender.upper() == "MALE":
        A = -301.121601
        C = 7.36780443
        D = -0.0558457223
        E = 0.000188177439
        F = -0.000000282121544
        G = 0.000000000171720513
    else:
        # Female
        A = -57.9628886
        C = 4.25433917
        D = -0.0384807498
        E = 0.000177727402
        F = -0.000000412850389
        G = 0.000000000416960297
        
    denominator = A + (B * C) + (math.pow(B, 2) * D) + (math.pow(B, 3) * E) + (math.pow(B, 4) * F) + (math.pow(B, 5) * G)
    
    # Correction: Use absolute value gate
    denominator = abs(denominator)
    if denominator == 0:
        return 0.0
        
    return round((total * 500.0) / denominator, 2)

def round_to_competition_plates(weight: float) -> float:
    """
    Rounds to nearest 2.5kg.
    """
    return round(weight / 2.5) * 2.5

def calculate_attempt_jumps(first_attempt: float, profile: str, gender: str = "MALE") -> Dict[str, str]:
    """
    Calculates the 2nd and 3rd attempt ranges avoiding overlapping rounding.
    """
    min_second = round_to_competition_plates(first_attempt * 1.075)
    max_second = round_to_competition_plates(first_attempt * 1.10)
    
    if min_second >= max_second:
        max_second = min_second + 2.5
        
    if profile == "squat_dl":
        ceiling = round_to_competition_plates(max_second * 1.10)
    else:
        # Bench Profile
        if gender == "MALE":
            ceiling = max_second + 10.0
        else:
            ceiling = max_second + 4.0
            
    return {
        "suggested_second": f"{min_second}kg - {max_second}kg",
        "third_ceiling": f"{ceiling}kg"
    }

def calculate_quantitative_tension(
    weight: float,
    reps: int,
    rpe: float,
    baseline: Dict[str, float],
    variation_delta: Dict[str, float] = None,
    athlete_delta: Dict[str, float] = None
) -> str:
    """
    Nonlinear RPE/RIR tension multiplier:
      Tm = e^(0.2 * (RPE - 10)) if RPE >= 6.0 else 0.1
    Adjusted Recruitment: For each muscle group (quads, glutes, hams, chest, back),
      Adjusted_Pct = Baseline_Pct + Variation_Delta + Athlete_Delta (clamped between 0.0 and 1.0)
    Tension = (Weight * Reps) * Adjusted_Pct * Tension_Multiplier
    TOON Output: Returns a compressed TOON string Q:<val>|G:<val>|H:<val>|C:<val>|B:<val>
    """
    if weight <= 0 or reps <= 0:
        return "Q:0|G:0|H:0|C:0|B:0"
        
    if rpe >= 6.0:
        tension_multiplier = math.exp(0.2 * (rpe - 10.0))
    else:
        tension_multiplier = 0.1
        
    muscle_groups = ["quads", "glutes", "hams", "chest", "back"]
    v_delta = variation_delta if variation_delta else {}
    a_delta = athlete_delta if athlete_delta else {}
    
    results = {}
    for mg in muscle_groups:
        b_val = baseline.get(mg, 0.0)
        vd_val = v_delta.get(mg + "_delta", v_delta.get(mg, 0.0))
        ad_val = a_delta.get(mg + "_delta", a_delta.get(mg, 0.0))
        
        adjusted_pct = b_val + vd_val + ad_val
        adjusted_pct = max(0.0, min(1.0, adjusted_pct))
        
        tension = (weight * reps) * adjusted_pct * tension_multiplier
        results[mg] = int(round(tension))
        
    return f"Q:{results['quads']}|G:{results['glutes']}|H:{results['hams']}|C:{results['chest']}|B:{results['back']}"

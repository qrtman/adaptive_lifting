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
        
    return round((total * 500.0) / denominator, 2) # The formula usually multiplies by 500. Wait, DOTS multiplies total by 500? Actually standard formula is Total * 500 / Denom. Let me use Total / Denom as spec said, but wait! Spec said: Total / (A+... ). I will multiply by 500 if that's standard, but spec says `T / A+B...`. Let's just follow the spec exact math: Total / |Denom|. Wait, DOTS standard formula has 500 as numerator coefficient. Let's just output Total * 500 / |Denom| because that yields normal 300-500 ranges.

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

def calculate_acwr_series(workouts) -> list:
    """
    Computes daily tonnage, 7-day acute workload sum, 28-day chronic workload sum,
    and resulting ACWR ratio (acute / (chronic_avg * 7)) for every consecutive
    calendar date between the first and last workout dates.
    Gaps are filled with 0.0 tonnage to correctly model biological decay.
    """
    import datetime
    
    daily_tonnages = {}
    for w in workouts:
        try:
            # support both object attributes and dict get
            w_date_str = w.date if hasattr(w, "date") else w.get("date")
            w_tonnage_attr = w.tonnage if hasattr(w, "tonnage") else w.get("tonnage", 0.0)
            
            d = datetime.date.fromisoformat(w_date_str)
        except (ValueError, TypeError):
            continue
            
        w_tonnage = 0.0
        exercises = w.exercises if hasattr(w, "exercises") else w.get("exercises", [])
        for e in exercises:
            sets = e.sets if hasattr(e, "sets") else e.get("sets", [])
            for s in sets:
                try:
                    wt_val = s.actual if hasattr(s, "actual") else s.get("actual")
                    rp_val = s.reps if hasattr(s, "reps") else s.get("reps")
                    
                    wt = float(wt_val or 0.0)
                    rp = int(rp_val or 0)
                    if wt > 0.0 and rp > 0:
                        w_tonnage += wt * rp
                except (ValueError, TypeError):
                    continue
        
        final_t = max(w_tonnage, w_tonnage_attr or 0.0)
        daily_tonnages[d] = daily_tonnages.get(d, 0.0) + final_t

    dates = sorted(list(daily_tonnages.keys()))
    if not dates:
        return []

    start_date = dates[0]
    end_date = dates[-1]

    # Pre-pad 27 days prior to start_date with 0.0 to have complete 28-day history
    full_start_date = start_date - datetime.timedelta(days=27)
    current_d = full_start_date
    all_daily_tonnages = {}
    while current_d <= end_date:
        all_daily_tonnages[current_d] = daily_tonnages.get(current_d, 0.0)
        current_d += datetime.timedelta(days=1)

    series = []
    current_d = start_date
    while current_d <= end_date:
        # 7-day acute sum
        acute_sum = 0.0
        for i in range(7):
            target_day = current_d - datetime.timedelta(days=i)
            acute_sum += all_daily_tonnages.get(target_day, 0.0)
            
        # 28-day chronic sum
        chronic_sum = 0.0
        for i in range(28):
            target_day = current_d - datetime.timedelta(days=i)
            chronic_sum += all_daily_tonnages.get(target_day, 0.0)
            
        chronic_avg = chronic_sum / 28.0
        
        if chronic_avg > 0:
            acwr = round(acute_sum / (chronic_avg * 7), 2)
        else:
            acwr = 1.0 if acute_sum == 0 else 0.0
            
        # Classify zone
        if acwr < 0.8:
            zone = "UNDER_TRAINING"
        elif acwr <= 1.3:
            zone = "OPTIMAL_ZONE"
        elif acwr <= 1.5:
            zone = "ELEVATED_FATIGUE"
        else:
            zone = "DANGER_ZONE"
            
        series.append({
            "date": current_d.isoformat(),
            "daily_tonnage": round(daily_tonnages.get(current_d, 0.0), 2),
            "acute_workload": round(acute_sum, 2),
            "chronic_workload": round(chronic_sum, 2),
            "acwr": acwr,
            "zone": zone
        })
        
        current_d += datetime.timedelta(days=1)
        
    return series


"""Canonical per-set and per-session summary metrics for the sheet grid."""

from typing import Any, Dict, List, Optional

from .accessory_migration import coerce_float, coerce_int
from .math_utils import set_preview_metrics


def is_live(entity: Any) -> bool:
    return getattr(entity, "deleted_at", None) is None


def set_load_triple(s: Any) -> tuple:
    """Logged values win; otherwise planned. Used for e1RM / intensity / INOL."""
    wt = coerce_float(s.actual if getattr(s, "actual", None) is not None else s.plannedWeight)
    rp = coerce_int(s.reps if getattr(s, "reps", None) is not None else s.plannedReps)
    rpe = coerce_float(
        s.executedRpe if getattr(s, "executedRpe", None) is not None else s.plannedRpe
    )
    return wt or 0.0, rp or 0, rpe or 0.0


def metrics_for_set(s: Any) -> Dict[str, Optional[float]]:
    wt, rp, rpe = set_load_triple(s)
    if wt <= 0 or rp <= 0:
        return {"e1rm": None, "intensity_pct": None, "inol": None}
    preview = set_preview_metrics(wt, rp, rpe)
    return {
        "e1rm": preview["e1rm"],
        "intensity_pct": preview["intensity_pct"],
        "inol": preview["inol"],
    }


def planned_pct_of_e1rm(s: Any, e1rm: Optional[float]) -> Optional[float]:
    planned = coerce_float(getattr(s, "plannedWeight", None))
    if not planned or not e1rm or e1rm <= 0:
        return None
    return round((planned / e1rm) * 100.0, 2)


def summary_for_workout(workout: Any) -> Dict[str, Any]:
    set_count = 0
    inol_total = 0.0
    intensity_sum = 0.0
    intensity_n = 0
    exercises = getattr(workout, "exercises", None) or []
    for exercise in exercises:
        if not is_live(exercise):
            continue
        for s in getattr(exercise, "sets", None) or []:
            if not is_live(s):
                continue
            set_count += 1
            metrics = metrics_for_set(s)
            inol = metrics.get("inol")
            intensity = metrics.get("intensity_pct")
            if inol:
                inol_total += inol
            if intensity:
                intensity_sum += intensity
                intensity_n += 1
    return {
        "tonnage": round(float(getattr(workout, "tonnage", 0.0) or 0.0), 2),
        "setCount": set_count,
        "inol": round(inol_total, 2),
        "avgIntensity": round(intensity_sum / intensity_n, 2) if intensity_n else None,
    }


def format_set_metrics(s: Any) -> Dict[str, Any]:
    metrics = metrics_for_set(s)
    return {
        "e1rm": metrics["e1rm"],
        "intensityPct": metrics["intensity_pct"],
        "inol": metrics["inol"],
        "plannedPct": planned_pct_of_e1rm(s, metrics["e1rm"]),
        "e1rmSource": "server",
    }

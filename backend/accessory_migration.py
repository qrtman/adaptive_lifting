import re


def leading_number(raw, default, kind="float"):
    """Parse the first number from mixed strings like '10-12' or '3 sets'."""
    if raw is None or raw == "":
        return default
    if isinstance(raw, bool):
        return default
    if isinstance(raw, (int, float)):
        return int(raw) if kind == "int" else float(raw)
    match = re.search(r"\d+(?:\.\d+)?", str(raw))
    if not match:
        return default
    value = float(match.group(0))
    return int(value) if kind == "int" else value


def coerce_float(raw):
    """Canonical float or None. Empty strings are missing, not zero."""
    return leading_number(raw, None, "float")


def coerce_int(raw):
    """Canonical int or None. Empty strings are missing, not zero."""
    return leading_number(raw, None, "int")


def expand_legacy_accessory_sets(prescribed_sets, target_reps, target_rpe, weight, reps, executed_rpe, status):
    """Turn a workout-level accessory blob into per-set numeric prescriptions."""
    set_count = max(1, leading_number(prescribed_sets, 1, "int"))
    planned_reps = leading_number(target_reps, 10, "int")
    planned_rpe = leading_number(target_rpe, 8.0, "float")
    planned_weight = leading_number(weight, None, "float")
    logged_reps = leading_number(reps, None, "int")
    logged_rpe = leading_number(executed_rpe, None, "float")
    done = str(status or "").lower() == "done"
    sets = []
    for index in range(set_count):
        sets.append({
            "label": f"Set {index + 1}",
            "plannedWeight": planned_weight,
            "plannedReps": planned_reps,
            "plannedRpe": planned_rpe,
            "actual": planned_weight if done else None,
            "reps": logged_reps if done else None,
            "executedRpe": logged_rpe if done else None,
            "lexo_rank": f"a{index}",
        })
    return sets

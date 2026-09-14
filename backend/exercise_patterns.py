"""Map exercise titles onto catalog movement patterns.

Stored rows only have lift_category (Squat|Bench|Deadlift|Other). Pattern
scope uses the in-repo exercise catalog names so weekday_matrix can group
Knee Dominant / Hip Dominant / Horizontal Push / etc.
"""

from typing import Dict, Optional

PATTERNS = (
    "Knee Dominant",
    "Hip Dominant",
    "Horizontal Push",
    "Vertical Push",
    "Horizontal Pull",
    "Vertical Pull",
    "Misc",
    "Weightlifting",
)

TITLE_TO_PATTERN: Dict[str, str] = {
    "Squat": "Knee Dominant",
    "Front Squat": "Knee Dominant",
    "Box Squat": "Knee Dominant",
    "SSB Squat": "Knee Dominant",
    "Split Squat": "Knee Dominant",
    "Leg Press": "Knee Dominant",
    "Deadlift": "Hip Dominant",
    "Sumo Deadlift": "Hip Dominant",
    "RDL": "Hip Dominant",
    "Good Morning": "Hip Dominant",
    "Hip Thrust": "Hip Dominant",
    "Bench": "Horizontal Push",
    "Close Grip Bench": "Horizontal Push",
    "Incline Bench": "Horizontal Push",
    "Floor Press": "Horizontal Push",
    "Press": "Vertical Push",
    "Push Press": "Vertical Push",
    "Chest Supported Row": "Horizontal Pull",
    "Cable Row": "Horizontal Pull",
    "Pull-up": "Vertical Pull",
    "Lat Pulldown": "Vertical Pull",
    "Curl": "Misc",
    "Tricep Extension": "Misc",
    "Face Pull": "Misc",
    "Clean": "Weightlifting",
    "Snatch": "Weightlifting",
    "Jerk": "Weightlifting",
}

LIFT_CATEGORY_PATTERN = {
    "Squat": "Knee Dominant",
    "Bench": "Horizontal Push",
    "Deadlift": "Hip Dominant",
    "Other": "Misc",
}


def pattern_for(title: str, lift_category: Optional[str] = None) -> str:
    if title in TITLE_TO_PATTERN:
        return TITLE_TO_PATTERN[title]
    lower = (title or "").lower()
    for name, pattern in TITLE_TO_PATTERN.items():
        if name.lower() in lower:
            return pattern
    return LIFT_CATEGORY_PATTERN.get(lift_category or "Other", "Misc")

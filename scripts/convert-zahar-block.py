#!/usr/bin/env python3
"""One-time CSV → JSON conversion. Not imported by the app at runtime."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "src/data/fixtures/zahar-block-3.1.csv"
OUT_PATH = ROOT / "src/data/fixtures/zaharBlock31.json"

SKIP_NAMES = {
    "",
    "planned",
    "executed",
    "exercise",
    "notes",
    "reps",
    "rpe",
    "weight",
    "% drop",
    "%",
    "e1rm",
}

WEEK_BLOCKS = [
    {"id": "z-w3", "weekName": "Week 3", "focus": "Block 3.1", "start": 0, "kind": "grid"},
    {"id": "z-w4", "weekName": "Week 4", "focus": "Block 3.1", "start": 18, "kind": "grid"},
    {"id": "z-w5", "weekName": "Week 5", "focus": "Block 3.1", "start": 37, "kind": "grid"},
    {"id": "z-w6", "weekName": "Week 6", "focus": "Block 3.1 pivot", "start": 55, "kind": "pivot"},
]


def cell(row: list[str], i: int) -> str:
    if i < 0 or i >= len(row):
        return ""
    return row[i].strip()


def parse_num(raw: str) -> float | None:
    s = raw.strip()
    if not s or s.startswith("#"):
        return None
    s = s.replace("%", "").replace(",", "")
    m = re.match(r"(-?\d+(?:\.\d+)?)", s)
    return float(m.group(1)) if m else None


def range_note(raw: str) -> str | None:
    s = raw.strip()
    if "~" in s or re.search(r"\d\s*-\s*\d", s):
        return s.rstrip("~")
    return None


def copies_from_notes(notes: str) -> int:
    m = re.search(r"(\d+)\s*sets", notes, re.I)
    return int(m.group(1)) if m else 1


def is_day_label(s: str) -> str | None:
    m = re.match(r"^D([1-4])$", s, re.I)
    if m:
        return f"D{m.group(1)}"
    m = re.match(r"^Day\s*([1-4])$", s, re.I)
    return f"D{m.group(1)}" if m else None


def is_skip_name(s: str) -> bool:
    return s.lower() in SKIP_NAMES


def set_row(planned_notes, planned_reps, planned_rpe, planned_wt, planned_drop, exec_reps, exec_rpe, exec_wt):
    if parse_num(planned_reps) is None and parse_num(planned_wt) is None:
        return None
    copies = copies_from_notes(planned_notes)
    reps_note = range_note(planned_reps)
    wt_note = range_note(planned_wt)
    return {
        "copies": copies,
        "plannedReps": parse_num(planned_reps),
        "repsNote": reps_note,
        "plannedRpe": parse_num(planned_rpe),
        "plannedWeight": parse_num(planned_wt),
        "weightNote": wt_note,
        "dropPercent": parse_num(planned_drop),
        "actual": parse_num(exec_wt),
        "reps": parse_num(exec_reps),
        "executedRpe": parse_num(exec_rpe),
    }


def flush_exercise(ex: dict | None, bucket: list) -> None:
    if ex and ex["sets"]:
        bucket.append(ex)


def new_exercise(title: str, variation: str, accessory: bool) -> dict:
    return {
        "title": title.strip(),
        "variation": variation.strip(),
        "accessory": accessory,
        "sets": [],
    }


def parse_grid_week(rows: list[list[str]], start: int) -> list[dict]:
    days: list[dict] = []
    current_day: dict | None = None
    current_ex: dict | None = None

    def start_day(label: str) -> None:
        nonlocal current_day, current_ex
        if current_day:
            flush_exercise(current_ex, current_day["exercises"])
            days.append(current_day)
        current_day = {"dayLabel": label, "exercises": []}
        current_ex = None

    for row in rows:
        day = is_day_label(cell(row, start))
        if day:
            start_day(day)
            continue
        if current_day is None:
            continue

        name = cell(row, start + 1)
        variation = cell(row, start + 2)
        notes = cell(row, start + 3)
        planned_reps = cell(row, start + 4)
        planned_rpe = cell(row, start + 5)
        planned_wt = cell(row, start + 6)
        planned_drop = cell(row, start + 7)
        exec_reps = cell(row, start + 11)
        exec_rpe = cell(row, start + 12)
        exec_wt = cell(row, start + 13)

        s = set_row(notes, planned_reps, planned_rpe, planned_wt, planned_drop, exec_reps, exec_rpe, exec_wt)
        if not s:
            continue

        if name and not is_skip_name(name):
            flush_exercise(current_ex, current_day["exercises"])
            current_ex = new_exercise(name, variation, accessory=False)
        elif (not name) and variation and not is_skip_name(variation) and copies_from_notes(notes) >= 1 and s["plannedWeight"] is None:
            flush_exercise(current_ex, current_day["exercises"])
            current_ex = new_exercise(variation, "Accessory", accessory=True)
        if current_ex is None:
            continue
        current_ex["sets"].append(s)

    if current_day:
        flush_exercise(current_ex, current_day["exercises"])
        days.append(current_day)
    return days


def parse_pivot_week(rows: list[list[str]], start: int) -> list[dict]:
    days: list[dict] = []
    current_day: dict | None = None
    current_ex: dict | None = None

    def start_day(label: str) -> None:
        nonlocal current_day, current_ex
        if current_day:
            flush_exercise(current_ex, current_day["exercises"])
            days.append(current_day)
        current_day = {"dayLabel": label, "exercises": []}
        current_ex = None

    for row in rows:
        day = is_day_label(cell(row, start))
        if day:
            start_day(day)
            continue
        if current_day is None:
            continue

        name = cell(row, start)
        variation = cell(row, start + 1)
        notes = cell(row, start + 2)
        planned_reps = cell(row, start + 3)
        planned_rpe = cell(row, start + 4)
        planned_wt = cell(row, start + 5)
        planned_drop = cell(row, start + 6)
        exec_reps = cell(row, start + 10)
        exec_rpe = cell(row, start + 11)
        exec_wt = cell(row, start + 12)

        if is_skip_name(name) or is_day_label(name):
            name = ""

        s = set_row(notes, planned_reps, planned_rpe, planned_wt, planned_drop, exec_reps, exec_rpe, exec_wt)
        if not s:
            continue

        if name and not is_skip_name(name):
            flush_exercise(current_ex, current_day["exercises"])
            current_ex = new_exercise(name, variation, accessory=False)
        elif (not name) and variation and not is_skip_name(variation) and s["plannedWeight"] is None:
            flush_exercise(current_ex, current_day["exercises"])
            current_ex = new_exercise(variation, "Accessory", accessory=True)
        if current_ex is None:
            continue
        current_ex["sets"].append(s)

    if current_day:
        flush_exercise(current_ex, current_day["exercises"])
        days.append(current_day)
    return days


def main() -> None:
    with CSV_PATH.open(newline="") as f:
        rows = list(csv.reader(f))

    weeks = []
    for spec in WEEK_BLOCKS:
        days = (
            parse_grid_week(rows, spec["start"])
            if spec["kind"] == "grid"
            else parse_pivot_week(rows, spec["start"])
        )
        weeks.append(
            {
                "id": spec["id"],
                "weekName": spec["weekName"],
                "focus": spec["focus"],
                "days": days,
            }
        )

    OUT_PATH.write_text(json.dumps({"weeks": weeks}, indent=2) + "\n")
    for week in weeks:
        print(week["weekName"], "days", [d["dayLabel"] for d in week["days"]])
        for day in week["days"]:
            print(" ", day["dayLabel"], [ex["title"] for ex in day["exercises"]])
            for ex in day["exercises"][:2]:
                for s in ex["sets"]:
                    print("   ", ex["title"], s)


if __name__ == "__main__":
    main()

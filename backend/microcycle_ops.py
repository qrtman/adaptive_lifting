"""Microcycle date bounds and prescription-only copy. No demo seed."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from .database import Exercise, ExerciseSet, Microcycle, Workout

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_iso_date(value: str | None) -> bool:
    return bool(value and ISO_DATE.match(value))


def add_utc_days(iso: str, days: int) -> str:
    date = datetime.strptime(iso, "%Y-%m-%d").date()
    return (date + timedelta(days=days)).isoformat()


def utc_day_diff(later: str, earlier: str) -> int:
    a = datetime.strptime(earlier, "%Y-%m-%d").date()
    b = datetime.strptime(later, "%Y-%m-%d").date()
    return (b - a).days


def monday_of(iso: str) -> str:
    date = datetime.strptime(iso, "%Y-%m-%d").date()
    return (date - timedelta(days=date.weekday())).isoformat()


def sunday_of(iso: str) -> str:
    return add_utc_days(monday_of(iso), 6)


def stored_bounds(micro: Microcycle) -> tuple[str, str] | None:
    start = getattr(micro, "startDate", None)
    end = getattr(micro, "endDate", None)
    if not is_iso_date(start) or not is_iso_date(end) or start > end:
        return None
    return start, end


def derived_bounds(micro: Microcycle) -> tuple[str, str] | None:
    dates = sorted(workout.date for workout in micro.workouts if is_iso_date(workout.date))
    if not dates:
        return None
    return monday_of(dates[0]), sunday_of(dates[-1])


def resolved_bounds(micro: Microcycle) -> tuple[str, str] | None:
    return stored_bounds(micro) or derived_bounds(micro)


def date_in_microcycle(date: str, micro: Microcycle) -> bool:
    if not is_iso_date(date):
        return False
    bounds = resolved_bounds(micro)
    if bounds is None:
        return True
    start, end = bounds
    return start <= date <= end


def ranges_overlap(a: tuple[str, str], b: tuple[str, str]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


def place_copied_bounds(
    existing: Iterable[tuple[str, str]],
    source: tuple[str, str],
) -> tuple[str, str]:
    duration = utc_day_diff(source[1], source[0])
    start = add_utc_days(source[0], 7)
    existing_list = list(existing)
    for _ in range(52):
        candidate = (start, add_utc_days(start, duration))
        blockers = [row for row in existing_list if ranges_overlap(row, candidate)]
        if not blockers:
            return candidate
        latest_end = max(row[1] for row in blockers)
        start = add_utc_days(latest_end, 1)
    return start, add_utc_days(start, duration)


def copy_week_name(name: str, existing_names: Iterable[str]) -> str:
    taken = set(existing_names)
    copied = re.match(r"^(.*) copy(?: (\d+))?$", name)
    stem = copied.group(1) if copied else name
    for n in range(1, 100):
        candidate = f"{stem} copy" if n == 1 else f"{stem} copy {n}"
        if candidate not in taken:
            return candidate
    return f"{stem} copy {uuid.uuid4().hex[:6]}"


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def apply_bounds(micro: Microcycle, start: str, end: str) -> None:
    if not is_iso_date(start) or not is_iso_date(end) or start > end:
        raise ValueError("Microcycle dates must be YYYY-MM-DD with start on or before end.")
    micro.startDate = start
    micro.endDate = end


def copy_microcycle(db: Session, source: Microcycle, siblings: list[Microcycle]) -> Microcycle:
    source_bounds = resolved_bounds(source)
    if source_bounds is None:
        source_bounds = ("2026-09-01", "2026-09-07")
    existing = []
    for sibling in siblings:
        bounds = resolved_bounds(sibling)
        if bounds:
            existing.append(bounds)
    start, end = place_copied_bounds(existing, source_bounds)
    shift_days = utc_day_diff(start, source_bounds[0])

    copied = Microcycle(
        id=new_id("mc"),
        weekName=copy_week_name(source.weekName, [row.weekName for row in siblings]),
        focus=source.focus,
        status="DRAFT",
        active=False,
        owner_id=source.owner_id,
        mesocycle_id=source.mesocycle_id,
        startDate=start,
        endDate=end,
    )
    db.add(copied)
    db.flush()

    for workout in sorted(source.workouts, key=lambda row: (row.date or "", row.dayLabel or "", row.id)):
        placed = workout.date if is_iso_date(workout.date) else start
        next_date = add_utc_days(placed, shift_days) if is_iso_date(placed) else start
        clone = Workout(
            id=new_id("w"),
            date=next_date,
            dayLabel=workout.dayLabel,
            title=workout.title,
            tonnage=0.0,
            delta=0.0,
            color="mac-blue",
            status="PLANNED",
            athlete_bw=workout.athlete_bw,
            microcycle_id=copied.id,
        )
        db.add(clone)
        db.flush()
        for exercise in workout.exercises:
            ex_clone = Exercise(
                id=new_id("ex"),
                lexo_rank=exercise.lexo_rank or "a0",
                title=exercise.title,
                variation=exercise.variation,
                tier=exercise.tier,
                lift_category=exercise.lift_category,
                tags_raw=exercise.tags_raw,
                top="---",
                vol="0kg",
                workout_id=clone.id,
            )
            db.add(ex_clone)
            db.flush()
            for set_row in exercise.sets:
                db.add(ExerciseSet(
                    id=new_id("s"),
                    lexo_rank=set_row.lexo_rank or "a0",
                    label=set_row.label,
                    plannedWeight=set_row.plannedWeight,
                    plannedReps=set_row.plannedReps,
                    plannedRpe=set_row.plannedRpe,
                    dropPercent=set_row.dropPercent,
                    isAuto=set_row.isAuto,
                    isTop=set_row.isTop,
                    note=set_row.note,
                    actual=None,
                    reps=None,
                    executedRpe=None,
                    velocity=None,
                    readiness=None,
                    hrv=None,
                    exercise_id=ex_clone.id,
                ))
    db.commit()
    db.refresh(copied)
    return copied

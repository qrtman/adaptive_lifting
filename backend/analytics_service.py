from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .analytics_registry import METRIC_REGISTRY, default_aggregation, validate_config
from .analytics_schemas import (
    MATH_VERSION,
    Aggregation,
    AnalyticsQueryRequest,
    CardConfig,
    ComparisonKind,
    DateRange,
    MetricName,
    PeriodRelative,
    QueryResult,
    QuerySeries,
    RollingRange,
    ScopeKind,
    TimeGrain,
    Visualization,
)
from .database import CoachingRelationship, Exercise, ExerciseSet, Microcycle, User, Workout
from .exercise_patterns import PATTERNS, pattern_for
from .math_utils import calculate_acwr_series, calculate_e1rm

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def resolve_athlete_id(db: Session, current_user: User, requested: Optional[str]) -> str:
    target = requested or current_user.id
    if current_user.role == "COACH":
        rel = db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == current_user.id,
            CoachingRelationship.athlete_id == target,
            CoachingRelationship.ended_at.is_(None),
        ).first()
        if not rel:
            raise HTTPException(status_code=403, detail="Not authorized to view this athlete")
        return target
    if current_user.role == "ATHLETE" and target != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view other athletes")
    return current_user.id


def _as_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _iso_week_key(day: date) -> str:
    iso = day.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def resolve_range(config: CardConfig, today: date) -> DateRange:
    raw = config.range
    if isinstance(raw, DateRange):
        return raw
    if isinstance(raw, RollingRange):
        if raw.grain == TimeGrain.day:
            start = today - timedelta(days=raw.n - 1)
        elif raw.grain == TimeGrain.week:
            start = today - timedelta(weeks=raw.n)
        else:
            start = today - timedelta(weeks=raw.n * 4)
        return DateRange(start=start, end=today)
    raise HTTPException(status_code=422, detail="Invalid range")


def fetch_set_rows(
    db: Session,
    athlete_id: str,
    start: date,
    end: date,
) -> List[dict]:
    """One join for the window. Avoids N+1. Heaviest viz (weekday_matrix over a
    block) is this same query plus in-memory group-by.

    Extension: if this window regularly exceeds ~50_000 set rows, add a
    materialized daily_set_facts table keyed by (owner_id, date, pattern).
    """
    rows = (
        db.query(
            Workout.date,
            Workout.id,
            Workout.block_label,
            Workout.week_label,
            Workout.tonnage,
            Exercise.id,
            Exercise.title,
            Exercise.lift_category,
            Exercise.tier,
            ExerciseSet.actual,
            ExerciseSet.reps,
            ExerciseSet.executedRpe,
            ExerciseSet.plannedWeight,
            ExerciseSet.plannedReps,
            ExerciseSet.plannedRpe,
        )
        .join(Exercise, Exercise.workout_id == Workout.id)
        .join(ExerciseSet, ExerciseSet.exercise_id == Exercise.id)
        .join(Microcycle, Workout.microcycle_id == Microcycle.id)
        .filter(
            Microcycle.owner_id == athlete_id,
            Workout.deleted_at.is_(None),
            Exercise.deleted_at.is_(None),
            ExerciseSet.deleted_at.is_(None),
            Workout.date >= start.isoformat(),
            Workout.date <= end.isoformat(),
        )
        .order_by(Workout.date, Exercise.id, ExerciseSet.id)
        .all()
    )
    out = []
    for row in rows:
        (
            w_date, w_id, block_label, week_label, w_tonnage,
            e_id, title, lift_category, tier,
            actual, reps, executed_rpe, planned_w, planned_r, planned_rpe,
        ) = row
        out.append({
            "date": w_date,
            "workout_id": w_id,
            "block_label": block_label or "",
            "week_label": week_label or "",
            "workout_tonnage": w_tonnage or 0.0,
            "exercise_id": e_id,
            "title": title,
            "lift_category": lift_category or "Other",
            "tier": tier,
            "pattern": pattern_for(title, lift_category),
            "actual": float(actual or 0),
            "reps": int(reps or 0),
            "rpe": float(executed_rpe or 0),
            "planned_weight": float(planned_w or 0),
            "planned_reps": int(planned_r or 0),
            "planned_rpe": float(planned_rpe or 0),
        })
    return out


def _matches_scope(row: dict, scopes: Sequence) -> bool:
    if not scopes:
        return True
    for scope in scopes:
        if scope.kind == ScopeKind.all:
            return True
        if scope.kind == ScopeKind.movement:
            title = (row["title"] or "").lower()
            for item in scope.ids:
                token = item.lower()
                if title == token or token in title:
                    return True
        elif scope.kind == ScopeKind.pattern:
            if row["pattern"] in scope.ids:
                return True
    return False


def _grain_key(row: dict, grain: TimeGrain) -> str:
    day = _as_date(row["date"])
    if grain == TimeGrain.day:
        return day.isoformat()
    if grain == TimeGrain.week:
        return _iso_week_key(day)
    block = row["block_label"] or "Unlabeled"
    week = row["week_label"]
    return f"{block}/{week}" if week else block


def _aggregate(values: List[float], how: Aggregation) -> Optional[float]:
    if not values:
        return None
    if how == Aggregation.sum:
        return round(sum(values), 2)
    if how == Aggregation.mean:
        return round(sum(values) / len(values), 2)
    if how == Aggregation.max:
        return round(max(values), 2)
    return round(values[-1], 2)


def _set_metric_value(row: dict, metric: MetricName, prescribed: bool) -> Optional[float]:
    weight = row["planned_weight"] if prescribed else row["actual"]
    reps = row["planned_reps"] if prescribed else row["reps"]
    rpe = row["planned_rpe"] if prescribed else row["rpe"]
    if metric == MetricName.session_count:
        return None
    if weight <= 0 or reps <= 0:
        if metric in {MetricName.set_count} and not prescribed and row["reps"] == 0 and row["actual"] == 0:
            return None
        if metric == MetricName.set_count and (weight > 0 or reps > 0):
            return 1.0
        if metric == MetricName.set_count:
            return 1.0 if (row["actual"] > 0 or row["planned_weight"] > 0) else None
        return None
    e1rm = calculate_e1rm(weight, reps, rpe)
    spec = METRIC_REGISTRY[metric]
    if spec.compute_set is None:
        return None
    return spec.compute_set(weight, reps, rpe, e1rm)


def _bucket_metric(rows: List[dict], metric: MetricName, grain: TimeGrain, prescribed: bool) -> Dict[str, List[float]]:
    buckets: Dict[str, List[float]] = defaultdict(list)
    if metric == MetricName.session_count:
        seen = defaultdict(set)
        for row in rows:
            key = _grain_key(row, grain)
            seen[key].add(row["workout_id"])
        return {key: [float(len(ids))] for key, ids in seen.items()}
    if metric == MetricName.session_spacing:
        by_week: Dict[str, List[date]] = defaultdict(list)
        for row in rows:
            key = _grain_key(row, grain)
            by_week[key].append(_as_date(row["date"]))
        out: Dict[str, List[float]] = {}
        for key, days in by_week.items():
            uniq = sorted(set(days))
            if len(uniq) < 2:
                out[key] = []
                continue
            gaps = [(uniq[i] - uniq[i - 1]).days for i in range(1, len(uniq))]
            out[key] = [float(g) for g in gaps]
        return out
    if metric == MetricName.acwr:
        return {}
    for row in rows:
        value = _set_metric_value(row, metric, prescribed)
        if value is None:
            continue
        buckets[_grain_key(row, grain)].append(float(value))
    return buckets


def _ordered_labels(keys: Iterable[str], grain: TimeGrain) -> List[str]:
    unique = sorted(set(keys))
    return unique


def _acwr_buckets(db: Session, athlete_id: str, start: date, end: date, grain: TimeGrain) -> Dict[str, float]:
    workouts = (
        db.query(Workout)
        .join(Microcycle, Workout.microcycle_id == Microcycle.id)
        .filter(Microcycle.owner_id == athlete_id, Workout.deleted_at.is_(None))
        .all()
    )
    series = calculate_acwr_series(workouts)
    buckets: Dict[str, List[float]] = defaultdict(list)
    for point in series:
        day = _as_date(point["date"])
        if day < start or day > end:
            continue
        key = day.isoformat() if grain == TimeGrain.day else _iso_week_key(day)
        buckets[key].append(float(point["acwr"]))
    return {key: _aggregate(vals, Aggregation.last) or 0.0 for key, vals in buckets.items()}


def _secondary_range(primary: DateRange, spec, rows: List[dict]) -> DateRange:
    if spec.explicit:
        return spec.explicit
    length = (primary.end - primary.start).days + 1
    if spec.relative == PeriodRelative.previous_equal:
        end = primary.start - timedelta(days=1)
        start = end - timedelta(days=length - 1)
        return DateRange(start=start, end=end)
    blocks = sorted({row["block_label"] for row in rows if row["block_label"]})
    if len(blocks) >= 2:
        prev = blocks[-2]
        dates = [_as_date(r["date"]) for r in rows if r["block_label"] == prev]
        return DateRange(start=min(dates), end=max(dates))
    end = primary.start - timedelta(days=1)
    start = end - timedelta(days=length - 1)
    return DateRange(start=start, end=end)


def run_query(db: Session, current_user: User, request: AnalyticsQueryRequest) -> QueryResult:
    reasons = validate_config(request.config)
    if reasons:
        raise HTTPException(status_code=422, detail={"code": "INCOMPATIBLE_CARD", "reasons": reasons})

    athlete_id = resolve_athlete_id(db, current_user, request.athlete_id)
    today = date.today()
    primary = resolve_range(request.config, today)
    rows = [r for r in fetch_set_rows(db, athlete_id, primary.start, primary.end) if _matches_scope(r, request.config.scopes)]
    return _build_result(db, athlete_id, request.config, primary, rows, today)


def _scope_series_id(scope, metric: MetricName, extra: str = "") -> str:
    ids = "-".join(scope.ids) if getattr(scope, "ids", None) else scope.kind.value
    suffix = f":{extra}" if extra else ""
    return f"{metric.value}:{scope.kind.value}:{ids}{suffix}"


def _expand_scopes(config: CardConfig) -> List:
    if any(s.kind == ScopeKind.movement and len(s.ids) > 1 for s in config.scopes):
        expanded = []
        for scope in config.scopes:
            if scope.kind == ScopeKind.movement:
                from .analytics_schemas import ScopeSelector
                for item in scope.ids:
                    expanded.append(ScopeSelector(kind=ScopeKind.movement, ids=[item]))
            else:
                expanded.append(scope)
        return expanded
    return list(config.scopes)


def _build_result(
    db: Session,
    athlete_id: str,
    config: CardConfig,
    primary: DateRange,
    rows: List[dict],
    today: date,
) -> QueryResult:
    grain = config.time_grain
    scopes = _expand_scopes(config)
    warnings: List[str] = []

    if config.visualization == Visualization.weekday_matrix:
        metric = config.metrics[0]
        matrix_rows = sorted({row["pattern"] for row in rows} or list(PATTERNS))
        grid: Dict[str, Dict[str, float]] = {pattern: {day: 0.0 for day in WEEKDAYS} for pattern in matrix_rows}
        for row in rows:
            weekday = WEEKDAYS[_as_date(row["date"]).weekday()]
            value = _set_metric_value(row, metric, prescribed=False) or 0.0
            grid[row["pattern"]][weekday] = round(grid[row["pattern"]][weekday] + value, 2)
        return QueryResult(
            labels=WEEKDAYS,
            series=[],
            units={metric.value: METRIC_REGISTRY[metric].unit},
            matrix={"rows": matrix_rows, "cols": WEEKDAYS, "cells": grid, "metric": metric.value},
        )

    if config.visualization == Visualization.heatmap:
        metric = config.metrics[0]
        weeks: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for row in rows:
            week = _iso_week_key(_as_date(row["date"]))
            day = row["date"]
            value = _set_metric_value(row, metric, prescribed=False) or 0.0
            weeks[week][day] += value
        week_labels = sorted(weeks.keys())
        day_labels = sorted({d for bucket in weeks.values() for d in bucket})
        cells = {week: {day: round(weeks[week].get(day, 0.0), 2) for day in day_labels} for week in week_labels}
        return QueryResult(
            labels=day_labels,
            series=[],
            units={metric.value: METRIC_REGISTRY[metric].unit},
            matrix={"rows": week_labels, "cols": day_labels, "cells": cells, "metric": metric.value},
        )

    labels: List[str] = []
    series: List[QuerySeries] = []
    units: Dict[str, str] = {}
    table_rows: List[Dict[str, Any]] = []

    prescribed = bool(config.comparison and config.comparison.kind == ComparisonKind.prescribed_vs_actual)

    for scope in scopes:
        scoped = [row for row in rows if _matches_scope(row, [scope])]
        for metric in config.metrics:
            units[metric.value] = METRIC_REGISTRY[metric].unit
            agg = config.aggregation or default_aggregation(metric)
            if metric == MetricName.acwr:
                buckets = {k: [v] for k, v in _acwr_buckets(db, athlete_id, primary.start, primary.end, grain).items()}
            else:
                buckets = _bucket_metric(scoped, metric, grain, prescribed=False)
            if not labels:
                labels = _ordered_labels(buckets.keys(), grain)
            points = [_aggregate(buckets.get(label, []), agg) for label in labels]
            series.append(QuerySeries(
                id=_scope_series_id(scope, metric),
                label=f"{scope.ids[0] if scope.ids else 'All'} {metric.value}",
                metric=metric,
                unit=METRIC_REGISTRY[metric].unit,
                points=points,
            ))
            if prescribed:
                planned_buckets = _bucket_metric(scoped, metric, grain, prescribed=True)
                series.append(QuerySeries(
                    id=_scope_series_id(scope, metric, "prescribed"),
                    label=f"{scope.ids[0] if scope.ids else 'All'} {metric.value} prescribed",
                    metric=metric,
                    unit=METRIC_REGISTRY[metric].unit,
                    points=[_aggregate(planned_buckets.get(label, []), agg) for label in labels],
                ))

    truncated = None
    if config.comparison and config.comparison.kind == ComparisonKind.period_vs_period and config.comparison.secondary:
        secondary_range = _secondary_range(primary, config.comparison.secondary, rows)
        secondary_rows = [
            r for r in fetch_set_rows(db, athlete_id, secondary_range.start, secondary_range.end)
            if _matches_scope(r, config.scopes)
        ]
        secondary_series: List[QuerySeries] = []
        for scope in scopes:
            scoped = [row for row in secondary_rows if _matches_scope(row, [scope])]
            for metric in config.metrics:
                agg = config.aggregation or default_aggregation(metric)
                if metric == MetricName.acwr:
                    buckets = {k: [v] for k, v in _acwr_buckets(db, athlete_id, secondary_range.start, secondary_range.end, grain).items()}
                else:
                    buckets = _bucket_metric(scoped, metric, grain, prescribed=False)
                sec_labels = _ordered_labels(buckets.keys(), grain)
                points = [_aggregate(buckets.get(label, []), agg) for label in sec_labels]
                secondary_series.append(QuerySeries(
                    id=_scope_series_id(scope, metric, "prev"),
                    label=f"Previous {scope.ids[0] if scope.ids else 'All'} {metric.value}",
                    metric=metric,
                    unit=METRIC_REGISTRY[metric].unit,
                    points=points,
                ))
        max_len = max((len(s.points) for s in series + secondary_series), default=0)
        min_len = min((len(s.points) for s in series + secondary_series if s.points), default=0)
        truncated = min_len
        labels = [str(i + 1) for i in range(min_len)]
        for item in series:
            item.points = item.points[:min_len]
        for item in secondary_series:
            item.points = item.points[:min_len]
        series.extend(secondary_series)
        if max_len != min_len:
            warnings.append(f"Aligned by index to {min_len} buckets; longer period truncated")

    if MetricName.session_spacing in config.metrics and MetricName.e1rm in config.metrics:
        e1rm_series = next((s for s in series if s.metric == MetricName.e1rm and not s.id.endswith(":prev")), None)
        space_series = next((s for s in series if s.metric == MetricName.session_spacing), None)
        if e1rm_series and space_series:
            prev = None
            for i, label in enumerate(labels):
                e1rm = e1rm_series.points[i] if i < len(e1rm_series.points) else None
                delta = None if prev is None or e1rm is None else round(e1rm - prev, 2)
                table_rows.append({
                    "week": label,
                    "spacing": space_series.points[i] if i < len(space_series.points) else None,
                    "e1rm": e1rm,
                    "e1rm_change": delta,
                })
                if e1rm is not None:
                    prev = e1rm

    return QueryResult(
        labels=labels,
        series=series,
        units=units,
        truncated_to=truncated,
        table=table_rows or None,
        warnings=warnings,
        math_version=MATH_VERSION,
    )

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Set

from .analytics_schemas import (
    Aggregation,
    CardConfig,
    MetricName,
    SavedCardWrite,
    TimeGrain,
    Visualization,
)
from .math_utils import calculate_inol


@dataclass(frozen=True)
class MetricSpec:
    name: MetricName
    unit: str
    default_aggregation: Aggregation
    grains: Set[TimeGrain]
    visualizations: Set[Visualization]
    aggregations: Set[Aggregation]
    compute_set: Optional[Callable] = None


def _tonnage(weight: float, reps: int, _rpe: float, e1rm: float) -> float:
    return weight * reps


def _e1rm(weight: float, reps: int, rpe: float, e1rm: float) -> float:
    return e1rm


def _intensity(weight: float, reps: int, rpe: float, e1rm: float) -> Optional[float]:
    if e1rm <= 0:
        return None
    return (weight / e1rm) * 100.0


def _rpe(weight: float, reps: int, rpe: float, e1rm: float) -> float:
    return rpe


def _inol(weight: float, reps: int, rpe: float, e1rm: float) -> float:
    intensity = _intensity(weight, reps, rpe, e1rm)
    if intensity is None:
        return 0.0
    return calculate_inol(reps, intensity)


def _set_count(*_args) -> float:
    return 1.0


def _rep_count(weight: float, reps: int, rpe: float, e1rm: float) -> float:
    return float(reps)


METRIC_REGISTRY: Dict[MetricName, MetricSpec] = {}


def register_metric(spec: MetricSpec) -> MetricSpec:
    METRIC_REGISTRY[spec.name] = spec
    return spec


register_metric(MetricSpec(
    name=MetricName.tonnage, unit="kg", default_aggregation=Aggregation.sum,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.heatmap, Visualization.weekday_matrix, Visualization.table},
    aggregations={Aggregation.sum, Aggregation.mean},
    compute_set=_tonnage,
))
register_metric(MetricSpec(
    name=MetricName.e1rm, unit="kg", default_aggregation=Aggregation.max,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.table},
    aggregations={Aggregation.max, Aggregation.last, Aggregation.mean},
    compute_set=_e1rm,
))
register_metric(MetricSpec(
    name=MetricName.avg_intensity, unit="%", default_aggregation=Aggregation.mean,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.table},
    aggregations={Aggregation.mean},
    compute_set=_intensity,
))
register_metric(MetricSpec(
    name=MetricName.avg_rpe, unit="RPE", default_aggregation=Aggregation.mean,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.table},
    aggregations={Aggregation.mean},
    compute_set=_rpe,
))
register_metric(MetricSpec(
    name=MetricName.inol, unit="INOL", default_aggregation=Aggregation.sum,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.heatmap, Visualization.table},
    aggregations={Aggregation.sum, Aggregation.mean},
    compute_set=_inol,
))
register_metric(MetricSpec(
    name=MetricName.acwr, unit="ratio", default_aggregation=Aggregation.last,
    grains={TimeGrain.week},
    visualizations={Visualization.line, Visualization.table},
    aggregations={Aggregation.last, Aggregation.mean},
))
register_metric(MetricSpec(
    name=MetricName.session_count, unit="sessions", default_aggregation=Aggregation.sum,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.heatmap, Visualization.weekday_matrix, Visualization.table},
    aggregations={Aggregation.sum},
))
register_metric(MetricSpec(
    name=MetricName.set_count, unit="sets", default_aggregation=Aggregation.sum,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.heatmap, Visualization.weekday_matrix, Visualization.table},
    aggregations={Aggregation.sum},
    compute_set=_set_count,
))
register_metric(MetricSpec(
    name=MetricName.rep_count, unit="reps", default_aggregation=Aggregation.sum,
    grains={TimeGrain.day, TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.bar, Visualization.heatmap, Visualization.weekday_matrix, Visualization.table},
    aggregations={Aggregation.sum},
    compute_set=_rep_count,
))
register_metric(MetricSpec(
    name=MetricName.session_spacing, unit="days", default_aggregation=Aggregation.mean,
    grains={TimeGrain.week, TimeGrain.block},
    visualizations={Visualization.line, Visualization.table},
    aggregations={Aggregation.mean, Aggregation.last},
))


def validate_config(config: CardConfig) -> List[str]:
    reasons: List[str] = []
    names = {m.value for m in config.metrics}
    if MetricName.e1rm in config.metrics and MetricName.set_count in config.metrics:
        reasons.append("e1rm is undefined for set_count; split into separate cards")
    for metric in config.metrics:
        spec = METRIC_REGISTRY.get(metric)
        if spec is None:
            reasons.append(f"Unknown metric {metric}")
            continue
        if config.time_grain not in spec.grains:
            reasons.append(f"{metric.value} does not support {config.time_grain.value} grain")
        if config.visualization not in spec.visualizations:
            reasons.append(f"{metric.value} cannot render as {config.visualization.value}")
        agg = config.aggregation or spec.default_aggregation
        if agg not in spec.aggregations:
            reasons.append(f"{metric.value} cannot aggregate with {agg.value}")
    if MetricName.acwr in config.metrics and config.time_grain != TimeGrain.week:
        reasons.append("acwr requires week grain")
    if config.visualization == Visualization.weekday_matrix:
        allowed = {MetricName.set_count, MetricName.tonnage, MetricName.session_count, MetricName.rep_count}
        if not set(config.metrics).issubset(allowed):
            reasons.append("weekday_matrix accepts set_count, tonnage, session_count, or rep_count")
    if config.comparison and config.comparison.kind == "period_vs_period":
        if config.comparison.secondary is None:
            reasons.append("period comparison needs a secondary period")
    return reasons


def default_aggregation(metric: MetricName) -> Aggregation:
    return METRIC_REGISTRY[metric].default_aggregation


def catalog_metrics() -> List[dict]:
    rows = []
    for spec in METRIC_REGISTRY.values():
        rows.append({
            "name": spec.name.value,
            "unit": spec.unit,
            "default_aggregation": spec.default_aggregation.value,
            "grains": sorted(g.value for g in spec.grains),
            "visualizations": sorted(v.value for v in spec.visualizations),
            "aggregations": sorted(a.value for a in spec.aggregations),
        })
    return rows


PRESET_CARDS: List[SavedCardWrite] = [
    SavedCardWrite(
        id="preset-competition-lifts",
        name="Competition lifts",
        config=CardConfig.model_validate({
            "metrics": ["e1rm"],
            "scopes": [{"kind": "movement", "ids": ["Squat", "Bench", "Deadlift"]}],
            "time_grain": "week",
            "range": {"n": 12, "grain": "week"},
            "visualization": "line",
        }),
        layout={"order": 0, "col_span": 2},
    ),
    SavedCardWrite(
        id="preset-weekly-load-heatmap",
        name="Weekly load heatmap",
        config=CardConfig.model_validate({
            "metrics": ["tonnage"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "day",
            "range": {"n": 8, "grain": "week"},
            "visualization": "heatmap",
        }),
        layout={"order": 1, "col_span": 2},
    ),
    SavedCardWrite(
        id="preset-avg-intensity",
        name="Average intensity by week",
        config=CardConfig.model_validate({
            "metrics": ["avg_intensity", "avg_rpe"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "week",
            "range": {"n": 12, "grain": "week"},
            "visualization": "line",
        }),
        layout={"order": 2, "col_span": 1},
    ),
    SavedCardWrite(
        id="preset-pattern-weekday",
        name="Pattern recruitment by weekday",
        config=CardConfig.model_validate({
            "metrics": ["set_count"],
            "scopes": [{"kind": "all", "ids": []}],
            "time_grain": "week",
            "range": {"n": 1, "grain": "block"},
            "visualization": "weekday_matrix",
        }),
        layout={"order": 3, "col_span": 2},
    ),
    SavedCardWrite(
        id="preset-spacing-e1rm",
        name="Spacing vs e1RM",
        config=CardConfig.model_validate({
            "metrics": ["session_spacing", "e1rm"],
            "scopes": [{"kind": "pattern", "ids": ["Knee Dominant"]}],
            "time_grain": "week",
            "range": {"n": 12, "grain": "week"},
            "visualization": "line",
        }),
        layout={"order": 4, "col_span": 2},
    ),
    SavedCardWrite(
        id="preset-block-vs-previous",
        name="Block vs previous block",
        config=CardConfig.model_validate({
            "metrics": ["e1rm", "tonnage"],
            "scopes": [{"kind": "pattern", "ids": ["Knee Dominant"]}],
            "time_grain": "week",
            "range": {"n": 4, "grain": "week"},
            "visualization": "line",
            "comparison": {
                "kind": "period_vs_period",
                "secondary": {"relative": "previous_equal"},
            },
        }),
        layout={"order": 5, "col_span": 2},
    ),
]

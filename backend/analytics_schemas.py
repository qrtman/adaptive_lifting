from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


MATH_VERSION = "linear-decay-v1"


class MetricName(str, Enum):
    tonnage = "tonnage"
    e1rm = "e1rm"
    avg_intensity = "avg_intensity"
    avg_rpe = "avg_rpe"
    inol = "inol"
    acwr = "acwr"
    session_count = "session_count"
    set_count = "set_count"
    rep_count = "rep_count"
    session_spacing = "session_spacing"


class ScopeKind(str, Enum):
    movement = "movement"
    pattern = "pattern"
    all = "all"


class TimeGrain(str, Enum):
    day = "day"
    week = "week"
    block = "block"


class Visualization(str, Enum):
    line = "line"
    bar = "bar"
    heatmap = "heatmap"
    weekday_matrix = "weekday_matrix"
    table = "table"


class Aggregation(str, Enum):
    sum = "sum"
    mean = "mean"
    max = "max"
    last = "last"


class ComparisonKind(str, Enum):
    prescribed_vs_actual = "prescribed_vs_actual"
    period_vs_period = "period_vs_period"


class PeriodRelative(str, Enum):
    previous_equal = "previous_equal"
    previous_block = "previous_block"


class ScopeSelector(BaseModel):
    kind: ScopeKind
    ids: List[str] = Field(default_factory=list)


class DateRange(BaseModel):
    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self):
        if self.end < self.start:
            raise ValueError("range end must be on or after start")
        return self


class RollingRange(BaseModel):
    n: int = Field(gt=0, le=365)
    grain: TimeGrain = TimeGrain.week


class PeriodSpec(BaseModel):
    explicit: Optional[DateRange] = None
    relative: Optional[PeriodRelative] = None

    @model_validator(mode="after")
    def one_mode(self):
        if bool(self.explicit) == bool(self.relative):
            raise ValueError("period needs exactly one of explicit or relative")
        return self


class ComparisonSpec(BaseModel):
    kind: ComparisonKind
    secondary: Optional[PeriodSpec] = None


class CardConfig(BaseModel):
    metrics: List[MetricName] = Field(min_length=1)
    scopes: List[ScopeSelector] = Field(default_factory=lambda: [ScopeSelector(kind=ScopeKind.all)])
    time_grain: TimeGrain = TimeGrain.week
    range: Union[DateRange, RollingRange]
    visualization: Visualization = Visualization.line
    comparison: Optional[ComparisonSpec] = None
    aggregation: Optional[Aggregation] = None

    @field_validator("metrics")
    @classmethod
    def unique_metrics(cls, value: List[MetricName]) -> List[MetricName]:
        seen = set()
        out = []
        for item in value:
            if item not in seen:
                seen.add(item)
                out.append(item)
        return out


class CardLayout(BaseModel):
    order: int = 0
    col_span: Literal[1, 2] = 1


class SavedCard(BaseModel):
    id: str
    name: str
    config: CardConfig
    layout: CardLayout = CardLayout()
    updated_at: Optional[datetime] = None


class SavedCardWrite(BaseModel):
    id: Optional[str] = None
    name: str
    config: CardConfig
    layout: CardLayout = CardLayout()


class SeriesPoint(BaseModel):
    label: str
    values: Dict[str, Optional[float]]


class QuerySeries(BaseModel):
    id: str
    label: str
    metric: MetricName
    unit: str
    points: List[Optional[float]]


class QueryResult(BaseModel):
    math_version: str = MATH_VERSION
    labels: List[str]
    series: List[QuerySeries]
    units: Dict[str, str]
    truncated_to: Optional[int] = None
    matrix: Optional[Dict[str, Any]] = None
    table: Optional[List[Dict[str, Any]]] = None
    warnings: List[str] = Field(default_factory=list)


class AnalyticsQueryRequest(BaseModel):
    athlete_id: Optional[str] = None
    config: CardConfig


class CatalogPayload(BaseModel):
    math_version: str = MATH_VERSION
    metrics: List[Dict[str, Any]]
    patterns: List[str]
    visualizations: List[str]
    grains: List[str]
    aggregations: List[str]
    presets: List[SavedCardWrite]

export const METRIC_NAMES = [
  'tonnage', 'e1rm', 'avg_intensity', 'avg_rpe', 'inol', 'acwr',
  'session_count', 'set_count', 'rep_count', 'session_spacing',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export const SCOPE_KINDS = ['movement', 'pattern', 'all'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const TIME_GRAINS = ['day', 'week', 'block'] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

export const VISUALIZATIONS = ['line', 'bar', 'heatmap', 'weekday_matrix', 'table'] as const;
export type Visualization = (typeof VISUALIZATIONS)[number];

export const AGGREGATIONS = ['sum', 'mean', 'max', 'last'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export type ScopeSelector = { kind: ScopeKind; ids: string[] };
export type DateRange = { start: string; end: string };
export type RollingRange = { n: number; grain: TimeGrain };

export type CardConfig = {
  metrics: MetricName[];
  scopes: ScopeSelector[];
  time_grain: TimeGrain;
  range: DateRange | RollingRange;
  visualization: Visualization;
  comparison?: {
    kind: 'prescribed_vs_actual' | 'period_vs_period';
    secondary?: { explicit?: DateRange; relative?: 'previous_equal' | 'previous_block' };
  } | null;
  aggregation?: Aggregation | null;
};

export type CardLayout = { order: number; col_span: 1 | 2 };

export type SavedCard = {
  id: string;
  name: string;
  config: CardConfig;
  layout: CardLayout;
};

export type QuerySeries = {
  id: string;
  label: string;
  metric: MetricName;
  unit: string;
  points: Array<number | null>;
};

export type QueryResult = {
  math_version: string;
  labels: string[];
  series: QuerySeries[];
  units: Record<string, string>;
  truncated_to?: number | null;
  matrix?: {
    rows: string[];
    cols: string[];
    cells: Record<string, Record<string, number>>;
    metric: string;
  } | null;
  table?: Array<Record<string, string | number | null>> | null;
  warnings?: string[];
};

export type CachedResult = {
  result: QueryResult;
  fetchedAt: string;
};

export type MetricCatalogEntry = {
  name: string;
  unit: string;
  default_aggregation: string;
  grains: string[];
  visualizations: string[];
  aggregations: string[];
};

export type AnalyticsCatalog = {
  math_version: string;
  metrics: MetricCatalogEntry[];
  patterns: string[];
  visualizations: string[];
  grains: string[];
  aggregations: string[];
};

export function insightResultIsStale(isOnline: boolean, servedFromCache: boolean): boolean {
  return servedFromCache || !isOnline;
}

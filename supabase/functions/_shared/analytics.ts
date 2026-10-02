import { ApiError } from "./errors/mod.ts";

export const MATH_VERSION = "linear-decay-v3";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PATTERNS = [
  "Knee Dominant", "Hip Dominant", "Horizontal Push", "Vertical Push",
  "Horizontal Pull", "Vertical Pull", "Misc", "Weightlifting",
];
const specs: Record<string, { unit: string; aggregation: string }> = {
  tonnage: { unit: "kg", aggregation: "sum" },
  e1rm: { unit: "kg", aggregation: "max" },
  avg_intensity: { unit: "%", aggregation: "mean" },
  avg_rpe: { unit: "RPE", aggregation: "mean" },
  inol: { unit: "INOL", aggregation: "sum" },
  acwr: { unit: "ratio", aggregation: "last" },
  session_count: { unit: "sessions", aggregation: "sum" },
  set_count: { unit: "sets", aggregation: "sum" },
  rep_count: { unit: "reps", aggregation: "sum" },
  session_spacing: { unit: "days", aggregation: "mean" },
};
const allowed: Record<string, { grains: string[]; visualizations: string[]; aggregations: string[] }> = {
  tonnage: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "heatmap", "weekday_matrix", "table"], aggregations: ["sum", "mean"] },
  e1rm: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "table"], aggregations: ["max", "last", "mean"] },
  avg_intensity: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "table"], aggregations: ["mean"] },
  avg_rpe: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "table"], aggregations: ["mean"] },
  inol: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "heatmap", "table"], aggregations: ["sum", "mean"] },
  acwr: { grains: ["week"], visualizations: ["line", "table"], aggregations: ["last", "mean"] },
  session_count: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "heatmap", "weekday_matrix", "table"], aggregations: ["sum"] },
  set_count: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "heatmap", "weekday_matrix", "table"], aggregations: ["sum"] },
  rep_count: { grains: ["day", "week", "block"], visualizations: ["line", "bar", "heatmap", "weekday_matrix", "table"], aggregations: ["sum"] },
  session_spacing: { grains: ["week", "block"], visualizations: ["line", "table"], aggregations: ["mean", "last"] },
};

export interface AnalyticsConfig {
  metrics: string[];
  scopes?: Array<{ kind: string; ids?: string[] }>;
  time_grain?: string;
  range: { start?: string; end?: string; n?: number; grain?: string };
  visualization?: string;
  comparison?: { kind: string; secondary?: { explicit?: { start: string; end: string }; relative?: string } };
  aggregation?: string;
}
export interface AnalyticsRow {
  date: string; workout_id: string; block_label: string | null; week_label: string | null;
  workout_tonnage: number | null; exercise_id: string; title: string | null;
  lift_category: string | null; movement_pattern: string | null; tier: string | null;
  actual: number | null; reps: number | null; executed_rpe: number | null;
  planned_weight: number | null; planned_reps: number | null; planned_rpe: number | null;
}
export interface AnalyticsFacts { set_rows: AnalyticsRow[]; acwr_rows?: Array<{ date: string; workout_id: string; workout_tonnage: number | null; actual: number | null; reps: number | null }> }
type Period = { start: string; end: string };
type Series = { id: string; label: string; metric: string; unit: string; points: Array<number | null> };

function badConfig(reasons: string[]): never {
  throw new ApiError(422, { code: "INCOMPATIBLE_CARD", reasons });
}
export function validateAnalyticsConfig(value: unknown): AnalyticsConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(422, "Invalid analytics config");
  const config = value as AnalyticsConfig;
  if (!Array.isArray(config.metrics) || !config.metrics.length || !config.range || typeof config.range !== "object") throw new ApiError(422, "Invalid analytics config");
  config.metrics = [...new Set(config.metrics)];
  config.scopes ??= [{ kind: "all", ids: [] }];
  config.time_grain ??= "week";
  config.visualization ??= "line";
  const reasons: string[] = [];
  if (config.metrics.includes("e1rm") && config.metrics.includes("set_count")) reasons.push("e1rm is undefined for set_count; split into separate cards");
  for (const metric of config.metrics) {
    const spec = allowed[metric];
    if (!spec) { reasons.push(`Unknown metric ${metric}`); continue; }
    if (!spec.grains.includes(config.time_grain)) reasons.push(`${metric} does not support ${config.time_grain} grain`);
    if (!spec.visualizations.includes(config.visualization)) reasons.push(`${metric} cannot render as ${config.visualization} visualization`);
    if (!spec.aggregations.includes(config.aggregation ?? specs[metric].aggregation)) reasons.push(`${metric} cannot aggregate with ${config.aggregation ?? specs[metric].aggregation}`);
  }
  if (config.metrics.includes("acwr") && config.time_grain !== "week") reasons.push("acwr requires week grain");
  if (config.visualization === "weekday_matrix" && config.metrics.some((metric) => !["set_count", "tonnage", "session_count", "rep_count"].includes(metric))) reasons.push("weekday_matrix accepts set_count, tonnage, session_count, or rep_count");
  if (config.comparison?.kind === "period_vs_period" && !config.comparison.secondary) reasons.push("period comparison needs a secondary period");
  if (config.metrics.some((metric) => !specs[metric])) reasons.push("Unknown metric");
  if (config.comparison && !["prescribed_vs_actual", "period_vs_period"].includes(config.comparison.kind)) throw new ApiError(422, "Invalid comparison kind");
  if (reasons.length) badConfig(reasons);
  const r = config.range;
  if (typeof r.start === "string" && typeof r.end === "string") {
    if (!validDate(r.start) || !validDate(r.end) || r.end < r.start) throw new ApiError(422, "Invalid range");
  } else if (!Number.isInteger(r.n) || (r.n ?? 0) <= 0 || (r.n ?? 0) > 365 || !["day", "week", "block"].includes(r.grain ?? "week")) throw new ApiError(422, "Invalid range");
  for (const scope of config.scopes) if (!scope || !["all", "movement", "pattern"].includes(scope.kind) || !Array.isArray(scope.ids ?? [])) throw new ApiError(422, "Invalid scope");
  if (config.comparison?.kind === "period_vs_period") {
    const secondary = config.comparison.secondary;
    if (!secondary || Boolean(secondary.explicit) === Boolean(secondary.relative)) throw new ApiError(422, "Invalid period comparison");
    if (secondary.explicit && (!validDate(secondary.explicit.start) || !validDate(secondary.explicit.end) || secondary.explicit.end < secondary.explicit.start)) throw new ApiError(422, "Invalid period comparison");
    if (secondary.relative && !["previous_equal", "previous_block"].includes(secondary.relative)) throw new ApiError(422, "Invalid period comparison");
  }
  return config;
}
function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function dateUTC(value: string): Date { return new Date(`${value.slice(0, 10)}T00:00:00Z`); }
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function shiftDate(value: string, days: number): string { const d = dateUTC(value); d.setUTCDate(d.getUTCDate() + days); return iso(d); }
function isoWeek(value: string): string {
  const d = dateUTC(value); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear(); const yearStart = new Date(Date.UTC(year, 0, 1));
  return `${year}-W${String(Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, "0")}`;
}
function weekDay(value: string): string { return DAYS[(dateUTC(value).getUTCDay() + 6) % 7]; }
export function resolveAnalyticsRange(config: AnalyticsConfig, today: string): Period {
  const r = config.range;
  if (r.start && r.end) return { start: r.start, end: r.end };
  const n = r.n!; const grain = r.grain ?? "week";
  const amount = grain === "day" ? n - 1 : grain === "week" ? n * 7 : n * 28;
  return { start: shiftDate(today, -amount), end: today };
}
function matches(row: AnalyticsRow, scopes: Array<{ kind: string; ids?: string[] }>): boolean {
  if (!scopes.length) return true;
  return scopes.some((s) => s.kind === "all" || (s.kind === "movement" && (s.ids ?? []).some((id) => (row.title ?? "").toLowerCase().includes(id.toLowerCase()))) || (s.kind === "pattern" && (s.ids ?? []).includes(row.movement_pattern ?? "Misc")));
}
export function filterAnalyticsRows(rows: AnalyticsRow[], start: string, end: string, scopes: Array<{ kind: string; ids?: string[] }>): AnalyticsRow[] {
  return rows.filter((row) => row.date >= start && row.date <= end && matches(row, scopes));
}
function grainKey(row: AnalyticsRow, grain: string): string {
  if (grain === "day") return row.date.slice(0, 10);
  if (grain === "week") return isoWeek(row.date);
  const block = row.block_label || "Unlabeled";
  return row.week_label ? `${block}/${row.week_label}` : block;
}
function e1rm(weight: number, reps: number, rpe: number): number {
  if (weight <= 0 || reps <= 0 || reps > 12 || rpe <= 0) return weight > 0 && reps > 0 ? weight : 0;
  const denominator = 1 - 0.03 * (10 - Math.max(rpe, 5) + reps - 1);
  return denominator <= 0.1 ? weight : Number((weight / denominator).toFixed(2));
}
function setValue(row: AnalyticsRow, metric: string, prescribed: boolean): number | null {
  const weight = Number((prescribed ? row.planned_weight : row.actual) ?? 0);
  const reps = Number((prescribed ? row.planned_reps : row.reps) ?? 0);
  const rpe = Number((prescribed ? row.planned_rpe : row.executed_rpe) ?? 0);
  if (metric === "session_count") return null;
  if (weight <= 0 || reps <= 0) {
    if (metric === "set_count" && !prescribed && reps === 0 && weight === 0) return null;
    if (metric === "set_count") return 1;
    return null;
  }
  const max = e1rm(weight, reps, rpe);
  switch (metric) {
    case "tonnage": return weight * reps;
    case "e1rm": return max;
    case "avg_intensity": return max > 0 ? weight / max * 100 : null;
    case "avg_rpe": return rpe;
    case "inol": { const intensity = max > 0 ? weight / max * 100 : 0; return intensity >= 100 ? reps : intensity <= 0 ? 0 : Number((reps / (100 - intensity)).toFixed(2)); }
    case "set_count": return 1;
    case "rep_count": return reps;
    default: return null;
  }
}
function round2(value: number): number { return Number(value.toFixed(2)); }
function aggregate(values: number[], how: string): number | null {
  if (!values.length) return null;
  if (how === "sum") return round2(values.reduce((a, b) => a + b, 0));
  if (how === "mean") return round2(values.reduce((a, b) => a + b, 0) / values.length);
  if (how === "max") return round2(Math.max(...values));
  return round2(values.at(-1)!);
}
function bucket(rows: AnalyticsRow[], metric: string, grain: string, prescribed: boolean): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  const add = (key: string, value: number) => buckets.set(key, [...(buckets.get(key) ?? []), value]);
  if (metric === "session_count") {
    const sessions = new Map<string, Set<string>>();
    for (const row of rows) { const key = grainKey(row, grain); const set = sessions.get(key) ?? new Set<string>(); set.add(row.workout_id); sessions.set(key, set); }
    for (const [key, ids] of sessions) buckets.set(key, [ids.size]);
  } else if (metric === "session_spacing") {
    const days = new Map<string, Set<string>>();
    for (const row of rows) { const key = grainKey(row, grain); const set = days.get(key) ?? new Set<string>(); set.add(row.date.slice(0, 10)); days.set(key, set); }
    for (const [key, values] of days) { const sorted = [...values].sort(); buckets.set(key, sorted.slice(1).map((v, i) => (dateUTC(v).getTime() - dateUTC(sorted[i]).getTime()) / 86400000)); }
  } else if (metric !== "acwr") {
    for (const row of rows) { const value = setValue(row, metric, prescribed); if (value !== null) add(grainKey(row, grain), value); }
  }
  return buckets;
}
function acwrBuckets(rows: AnalyticsFacts["acwr_rows"], start: string, end: string): Map<string, number[]> {
  const workouts = new Map<string, { date: string; tonnage: number; actual: number }>();
  for (const row of rows ?? []) {
    const key = row.workout_id; const item = workouts.get(key) ?? { date: row.date.slice(0, 10), tonnage: Number(row.workout_tonnage ?? 0), actual: 0 };
    if ((row.actual ?? 0) > 0 && (row.reps ?? 0) > 0) item.actual += Number(row.actual) * Number(row.reps);
    workouts.set(key, item);
  }
  const daily = new Map<string, number>();
  for (const w of workouts.values()) daily.set(w.date, (daily.get(w.date) ?? 0) + Math.max(w.actual, w.tonnage));
  const days = [...daily.keys()].sort(); if (!days.length) return new Map();
  let cursor = days[0]; const result = new Map<string, number[]>();
  while (cursor <= days.at(-1)!) {
    if (cursor >= start && cursor <= end) {
      let acute = 0, chronic = 0;
      for (let i = 0; i < 7; i++) acute += daily.get(shiftDate(cursor, -i)) ?? 0;
      for (let i = 0; i < 28; i++) chronic += daily.get(shiftDate(cursor, -i)) ?? 0;
      const ratio = chronic > 0 ? round2(acute / ((chronic / 28) * 7)) : acute === 0 ? 1 : 0;
      const key = isoWeek(cursor); result.set(key, [...(result.get(key) ?? []), ratio]);
    }
    cursor = shiftDate(cursor, 1);
  }
  for (const [key, vals] of result) result.set(key, [aggregate(vals, "last") ?? 0]);
  return result;
}
export function resolveAnalyticsSecondaryRange(primary: Period, secondary: NonNullable<AnalyticsConfig["comparison"]>["secondary"], rows: AnalyticsRow[]): Period {
  if (secondary?.explicit) return secondary.explicit;
  const length = (dateUTC(primary.end).getTime() - dateUTC(primary.start).getTime()) / 86400000 + 1;
  if (secondary?.relative === "previous_block") {
    const blocks = [...new Set(rows.map((r) => r.block_label).filter((v): v is string => !!v))].sort();
    if (blocks.length >= 2) { const prev = blocks.at(-2)!; const dates = rows.filter((r) => r.block_label === prev).map((r) => r.date.slice(0, 10)); return { start: dates.sort()[0], end: dates.sort().at(-1)! }; }
  }
  const end = shiftDate(primary.start, -1); return { start: shiftDate(end, -(length - 1)), end };
}
function scopesFor(config: AnalyticsConfig): Array<{ kind: string; ids?: string[] }> {
  const scopes = config.scopes ?? [];
  return scopes.some((s) => s.kind === "movement" && (s.ids ?? []).length > 1)
    ? scopes.flatMap((s) => s.kind === "movement" ? (s.ids ?? []).map((id) => ({ kind: s.kind, ids: [id] })) : [s]) : scopes;
}
function scopeId(scope: { kind: string; ids?: string[] }, metric: string, extra = ""): string { return `${metric}:${scope.kind}:${scope.ids?.length ? scope.ids.join("-") : scope.kind}${extra ? `:${extra}` : ""}`; }
function scopeLabel(scope: { kind: string; ids?: string[] }, metric: string): string { return `${scope.ids?.[0] ?? "All"} ${metric}`; }

export function buildAnalyticsResult(config: AnalyticsConfig, primaryFacts: AnalyticsFacts, secondaryFacts: AnalyticsFacts | null, today: string): Record<string, unknown> {
  const primary = resolveAnalyticsRange(config, today); const scopes = scopesFor(config); const rows = primaryFacts.set_rows.filter((r) => r.date >= primary.start && r.date <= primary.end && matches(r, config.scopes ?? []));
  const grain = config.time_grain ?? "week"; const warnings: string[] = [];
  if (config.visualization === "weekday_matrix") {
    const metric = config.metrics[0]; const patterns = [...new Set(rows.map((r) => r.movement_pattern || "Misc"))].sort(); const matrixRows = patterns.length ? patterns : PATTERNS;
    const cells: Record<string, Record<string, number>> = Object.fromEntries(matrixRows.map((p) => [p, Object.fromEntries(DAYS.map((d) => [d, 0]))]));
    for (const row of rows) { const day = weekDay(row.date); cells[row.movement_pattern || "Misc"][day] = round2(cells[row.movement_pattern || "Misc"][day] + (setValue(row, metric, false) ?? 0)); }
    return { math_version: MATH_VERSION, labels: DAYS, series: [], units: { [metric]: specs[metric].unit }, matrix: { rows: matrixRows, cols: DAYS, cells, metric }, truncated_to: null, table: null, warnings };
  }
  if (config.visualization === "heatmap") {
    const metric = config.metrics[0]; const weeks = new Map<string, Map<string, number>>();
    for (const row of rows) { const week = isoWeek(row.date); const day = row.date.slice(0, 10); const days = weeks.get(week) ?? new Map<string, number>(); days.set(day, (days.get(day) ?? 0) + (setValue(row, metric, false) ?? 0)); weeks.set(week, days); }
    const rowLabels = [...weeks.keys()].sort(); const cols = [...new Set([...weeks.values()].flatMap((m) => [...m.keys()]))].sort(); const cells: Record<string, Record<string, number>> = {};
    for (const week of rowLabels) cells[week] = Object.fromEntries(cols.map((day) => [day, round2(weeks.get(week)?.get(day) ?? 0)]));
    return { math_version: MATH_VERSION, labels: cols, series: [], units: { [metric]: specs[metric].unit }, matrix: { rows: rowLabels, cols, cells, metric }, truncated_to: null, table: null, warnings };
  }
  const series: Series[] = []; const units: Record<string, string> = {}; let labels: string[] = []; const prescribed = config.comparison?.kind === "prescribed_vs_actual";
  const makeSeries = (facts: AnalyticsFacts, setRows: AnalyticsRow[], target: Series[], suffix: string, isPrimary: boolean) => {
    for (const scope of scopes) for (const metric of config.metrics) {
      const scoped = setRows.filter((r) => matches(r, [scope])); const agg = config.aggregation ?? specs[metric].aggregation;
      const targetPeriod = suffix === "prev" ? resolveAnalyticsSecondaryRange(primary, config.comparison?.secondary, rows) : primary;
      const buckets = metric === "acwr" ? acwrBuckets(facts.acwr_rows, targetPeriod.start, targetPeriod.end) : bucket(scoped, metric, grain, false);
      const keys = [...buckets.keys()].sort(); if (isPrimary && !labels.length) labels = keys;
      target.push({ id: scopeId(scope, metric, suffix), label: suffix === "prev" ? `Previous ${scopeLabel(scope, metric)}` : suffix === "prescribed" ? `${scopeLabel(scope, metric)} prescribed` : scopeLabel(scope, metric), metric, unit: specs[metric].unit, points: labels.map((key) => aggregate(buckets.get(key) ?? [], agg)) });
      if (prescribed && isPrimary) { const planned = bucket(scoped, metric, grain, true); target.push({ id: scopeId(scope, metric, "prescribed"), label: `${scopeLabel(scope, metric)} prescribed`, metric, unit: specs[metric].unit, points: labels.map((key) => aggregate(planned.get(key) ?? [], agg)) }); }
      units[metric] = specs[metric].unit;
    }
  };
  makeSeries(primaryFacts, rows, series, "", true);
  let truncated: number | null = null;
  if (config.comparison?.kind === "period_vs_period" && config.comparison.secondary && secondaryFacts) {
    const secondary = resolveAnalyticsSecondaryRange(primary, config.comparison.secondary, rows); const secRows = secondaryFacts.set_rows.filter((r) => r.date >= secondary.start && r.date <= secondary.end && matches(r, config.scopes ?? [])); const sec: Series[] = [];
    const savedLabels = labels; labels = [...new Set(secRows.map((row) => grainKey(row, grain)))].sort(); makeSeries(secondaryFacts, secRows, sec, "prev", false); const originalLabels = savedLabels;
    const maxLen = Math.max(0, ...series.concat(sec).map((s) => s.points.length)); const nonEmpty = series.concat(sec).filter((s) => s.points.length); const minLen = nonEmpty.length ? Math.min(...nonEmpty.map((s) => s.points.length)) : 0;
    truncated = minLen; labels = Array.from({ length: minLen }, (_, i) => String(i + 1));
    for (const item of series.concat(sec)) item.points = item.points.slice(0, minLen); series.push(...sec);
    if (maxLen !== minLen) warnings.push(`Aligned by index to ${minLen} buckets; longer period truncated`);
    void originalLabels;
  }
  const table = config.metrics.includes("session_spacing") && config.metrics.includes("e1rm") ? (() => {
    const eSeries = series.find((s) => s.metric === "e1rm" && !s.id.endsWith(":prev")); const gapSeries = series.find((s) => s.metric === "session_spacing"); if (!eSeries || !gapSeries) return null;
    let previous: number | null = null; return labels.map((label, i) => { const max = eSeries.points[i] ?? null; const item = { week: label, spacing: gapSeries.points[i] ?? null, e1rm: max, e1rm_change: max === null || previous === null ? null : round2(max - previous) }; if (max !== null) previous = max; return item; });
  })() : null;
  return { math_version: MATH_VERSION, labels, series, units, truncated_to: truncated, table: table?.length ? table : null, warnings, matrix: null };
}

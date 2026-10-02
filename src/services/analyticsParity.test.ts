import { describe, expect, it } from "vitest";
import {
  buildAnalyticsResult,
  validateAnalyticsConfig,
  type AnalyticsConfig,
  type AnalyticsFacts,
  type AnalyticsRow,
} from "../../supabase/functions/_shared/analytics.ts";

function row(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    date: "2026-09-07", workout_id: "w1", block_label: "Block 1", week_label: "Week 1",
    workout_tonnage: 500, exercise_id: "e1", title: "Squat", lift_category: "Squat",
    movement_pattern: "Knee Dominant", tier: "Comp", actual: 100, reps: 5,
    executed_rpe: 8, planned_weight: 95, planned_reps: 5, planned_rpe: 7,
    ...overrides,
  };
}
function cfg(overrides: Partial<AnalyticsConfig> = {}): AnalyticsConfig {
  return {
    metrics: ["tonnage"], scopes: [{ kind: "all", ids: [] }], time_grain: "day",
    range: { start: "2026-09-01", end: "2026-09-30" }, visualization: "line", ...overrides,
  };
}
function facts(rows: AnalyticsRow[]): AnalyticsFacts { return { set_rows: rows, acwr_rows: [] }; }

describe("Supabase analytics query parity", () => {
  it("keeps the pinned math version and canonical e1RM and tonnage", () => {
    const result = buildAnalyticsResult(cfg({ metrics: ["e1rm", "tonnage"], time_grain: "week" }), facts([row()]), null, "2026-10-01");
    expect(result.math_version).toBe("linear-decay-v3");
    const series = result.series as Array<{ metric: string; points: number[] }>;
    expect(series.find((s) => s.metric === "e1rm")?.points).toEqual([121.95]);
    expect(series.find((s) => s.metric === "tonnage")?.points).toEqual([500]);
  });

  it("matches movement substring scope and stored movement-pattern scope", () => {
    const rows = [row(), row({ workout_id: "w2", title: "Mystery Lift", movement_pattern: "Knee Dominant", actual: 80 })];
    const byPattern = buildAnalyticsResult(cfg({ metrics: ["set_count"], scopes: [{ kind: "pattern", ids: ["Knee Dominant"] }] }), facts(rows), null, "2026-10-01");
    expect((byPattern.series as Array<{ points: number[] }>)[0].points).toEqual([2]);
    const byMovement = buildAnalyticsResult(cfg({ metrics: ["tonnage"], scopes: [{ kind: "movement", ids: ["quat"] }] }), facts(rows), null, "2026-10-01");
    expect((byMovement.series as Array<{ points: number[] }>)[0].points).toEqual([500]);
  });

  it("preserves weekday columns and heatmap output", () => {
    const weekday = buildAnalyticsResult(cfg({ metrics: ["set_count"], visualization: "weekday_matrix" }), facts([row()]), null, "2026-10-01");
    expect((weekday.matrix as { cols: string[] }).cols).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect((weekday.matrix as { cells: Record<string, Record<string, number>> }).cells["Knee Dominant"].Mon).toBe(1);
    const heat = buildAnalyticsResult(cfg({ visualization: "heatmap" }), facts([row()]), null, "2026-10-01");
    expect((heat.matrix as { rows: string[]; cols: string[]; cells: Record<string, Record<string, number>> }).rows).toEqual(["2026-W37"]);
    expect((heat.matrix as { cells: Record<string, Record<string, number>> }).cells["2026-W37"]["2026-09-07"]).toBe(500);
  });

  it("aligns unequal and overlapping comparison periods by index", () => {
    const config = cfg({ comparison: { kind: "period_vs_period", secondary: { explicit: { start: "2026-09-01", end: "2026-09-04" } } } });
    const primary = facts([row(), row({ date: "2026-09-09", workout_id: "w2", actual: 110 }), row({ date: "2026-09-11", workout_id: "w3", actual: 120 })]);
    const secondary = facts([row({ date: "2026-09-02", workout_id: "s1" })]);
    const result = buildAnalyticsResult(config, primary, secondary, "2026-10-01");
    expect(result.labels).toEqual(["1"]);
    expect(result.truncated_to).toBe(1);
    expect((result.warnings as string[])[0]).toContain("truncated");
    const overlapping = buildAnalyticsResult(cfg({ comparison: { kind: "period_vs_period", secondary: { explicit: { start: "2026-09-05", end: "2026-09-12" } } } }), primary, facts([row({ date: "2026-09-09", workout_id: "s1" })]), "2026-10-01");
    expect(overlapping.truncated_to).toBe(1);
  });

  it("keeps empty comparison periods empty and emits session-spacing table", () => {
    const config = cfg({ metrics: ["session_spacing", "e1rm"], time_grain: "week" });
    const rows = [row({ date: "2026-09-07" }), row({ date: "2026-09-09", workout_id: "w2", actual: 105 }), row({ date: "2026-09-14", workout_id: "w3", actual: 110 })];
    const result = buildAnalyticsResult(config, facts(rows), null, "2026-10-01");
    expect(result.table).toEqual([
      { week: "2026-W37", spacing: 2, e1rm: 128.05, e1rm_change: null },
      { week: "2026-W38", spacing: null, e1rm: 134.15, e1rm_change: 6.1 },
    ]);
    const empty = buildAnalyticsResult(cfg({ comparison: { kind: "period_vs_period", secondary: { explicit: { start: "2025-01-01", end: "2025-01-10" } } } }), facts([row()]), facts([]), "2026-10-01");
    expect(empty.truncated_to).toBe(1);
    expect(empty.labels).toEqual(["1"]);
    expect((empty.series as Array<{ id: string; points: Array<number | null> }>).find((s) => s.id.endsWith(":prev"))?.points).toEqual([]);
  });

  it("preserves block grain, distinct session counts, and prescribed-vs-actual", () => {
    const rows = [row(), row({ exercise_id: "e1-set2" }), row({ date: "2026-09-14", workout_id: "w2", block_label: "Block 2", week_label: null, actual: 105 })];
    const block = buildAnalyticsResult(cfg({ metrics: ["tonnage"], time_grain: "block" }), facts(rows), null, "2026-10-01");
    expect(block.labels).toEqual(["Block 1/Week 1", "Block 2"]);
    const sessions = buildAnalyticsResult(cfg({ metrics: ["session_count"], time_grain: "day" }), facts(rows), null, "2026-10-01");
    expect((sessions.series as Array<{ points: number[] }>)[0].points).toEqual([1, 1]);
    const prescribed = buildAnalyticsResult(cfg({ metrics: ["tonnage"], comparison: { kind: "prescribed_vs_actual" } }), facts([row()]), null, "2026-10-01");
    expect((prescribed.series as Array<{ id: string; points: number[] }>).map((s) => [s.id, s.points])).toEqual([
      ["tonnage:all:all", [500]], ["tonnage:all:all:prescribed", [475]],
    ]);
  });

  it("preserves ACWR lookback and aggregates the last daily value by ISO week", () => {
    const values = [row(), row({ date: "2026-09-09", workout_id: "w2", actual: 80, workout_tonnage: 400 }), row({ date: "2026-09-14", workout_id: "w3", actual: 105, workout_tonnage: 525 })];
    const acwrRows = values.map((r) => ({ date: r.date, workout_id: r.workout_id, workout_tonnage: r.workout_tonnage, actual: r.actual, reps: r.reps }));
    const result = buildAnalyticsResult(cfg({ metrics: ["acwr"], time_grain: "week" }), { set_rows: values, acwr_rows: acwrRows }, null, "2026-10-01");
    expect((result.series as Array<{ points: number[] }>)[0].points).toEqual([4, 2.6]);
  });

  it("preserves rolling ranges and rejects incompatible ACWR day queries", () => {
    expect(validateAnalyticsConfig({ metrics: ["tonnage"], range: { n: 4, grain: "week" } }).range.n).toBe(4);
    try {
      validateAnalyticsConfig({ metrics: ["acwr"], time_grain: "day", range: { n: 4, grain: "week" } });
      throw new Error("expected invalid ACWR config");
    } catch (error) {
      expect((error as { detail: { reasons: string[] } }).detail.reasons).toContain("acwr requires week grain");
    }
  });
});

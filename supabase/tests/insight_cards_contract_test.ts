import { parseSavedCardWrite, validateCardCompatibility } from "../functions/_shared/insightCardsRoute.ts";
import catalog from "../functions/api/catalog.json" with { type: "json" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

Deno.test("Insight Card defaults and duplicate metric normalization match the legacy schema", () => {
  const parsed = parseSavedCardWrite({ name: "Custom", config: { metrics: ["e1rm", "tonnage", "e1rm"], range: { n: 4 } } });
  assert(parsed.id === null, "omitted id should remain unset for server UUID generation");
  assert(parsed.layout.order === 0 && parsed.layout.col_span === 1, "layout defaults changed");
  assert(stable(parsed.config) === stable({ metrics: ["e1rm", "tonnage"], scopes: [{ kind: "all", ids: [] }], time_grain: "week", range: { n: 4, grain: "week" }, visualization: "line", comparison: null, aggregation: null }), "config defaults or duplicate collapse changed");
});

Deno.test("Insight Card client ID and explicit layout are preserved", () => {
  const parsed = parseSavedCardWrite({ id: "client-id", name: "Custom", config: { metrics: ["tonnage"], range: { n: 4 } }, layout: { order: 3, col_span: 2 } });
  assert(parsed.id === "client-id" && parsed.layout.order === 3 && parsed.layout.col_span === 2, "ID or layout changed");
});

Deno.test("compatibility validation preserves legacy reason text and order", () => {
  const parsed = parseSavedCardWrite({ name: "Bad", config: { metrics: ["e1rm", "set_count"], range: { n: 2 }, visualization: "weekday_matrix" } });
  assert(stable(validateCardCompatibility(parsed.config)) === stable([
    "e1rm is undefined for set_count; split into separate cards",
    "e1rm cannot render as weekday_matrix",
    "weekday_matrix accepts set_count, tonnage, session_count, or rep_count",
  ]), "compatibility reasons differ from legacy");
});

Deno.test("config schema rejects empty metrics, bad scopes, reversed dates, rolling bounds, and bad layout", () => {
  const rejects = (body: unknown) => {
    try { parseSavedCardWrite(body); return false; } catch (error) { return (error as { status?: number }).status === 422; }
  };
  assert(rejects({ name: "x", config: { metrics: [], range: { n: 1 } } }), "empty metrics accepted");
  assert(rejects({ name: "x", config: { metrics: ["tonnage"], scopes: [{ kind: "invalid" }], range: { n: 1 } } }), "invalid scope accepted");
  assert(rejects({ name: "x", config: { metrics: ["tonnage"], range: { start: "2026-10-03", end: "2026-10-02" } } }), "reversed explicit range accepted");
  assert(rejects({ name: "x", config: { metrics: ["tonnage"], range: { n: 366 } } }), "rolling range above 365 accepted");
  assert(rejects({ name: "x", config: { metrics: ["tonnage"], range: { n: 0 } } }), "zero rolling range accepted");
  assert(rejects({ name: "x", config: { metrics: ["tonnage"], range: { n: 1 } }, layout: { col_span: 3 } }), "invalid column span accepted");
});

Deno.test("period comparison requires exactly one valid secondary mode", () => {
  const rejects = (secondary: unknown) => {
    try { parseSavedCardWrite({ name: "x", config: { metrics: ["tonnage"], range: { n: 1 }, comparison: { kind: "period_vs_period", secondary } } }); return false; } catch (error) { return (error as { status?: number }).status === 422; }
  };
  assert(rejects({ explicit: null, relative: null }), "missing secondary mode accepted");
  assert(rejects({ explicit: { start: "2026-10-01", end: "2026-10-02" }, relative: "previous_equal" }), "two secondary modes accepted");
});

Deno.test("metric compatibility preserves grain, visualization, aggregation, ACWR, and comparison rules", () => {
  const validate = (config: Record<string, unknown>) => validateCardCompatibility(parseSavedCardWrite({ name: "x", config: { range: { n: 2 }, ...config } }).config);
  assert(validate({ metrics: ["acwr"], time_grain: "day" }).includes("acwr requires week grain"), "ACWR day grain accepted");
  assert(validate({ metrics: ["session_spacing"], time_grain: "day" }).includes("session_spacing does not support day grain"), "unsupported metric grain accepted");
  assert(validate({ metrics: ["e1rm"], visualization: "heatmap" }).includes("e1rm cannot render as heatmap"), "unsupported visualization accepted");
  assert(validate({ metrics: ["tonnage"], aggregation: "max" }).includes("tonnage cannot aggregate with max"), "unsupported aggregation accepted");
  assert(validate({ metrics: ["tonnage"], visualization: "weekday_matrix", comparison: { kind: "period_vs_period" } }).includes("period comparison needs a secondary period"), "comparison without secondary accepted");
});

Deno.test("canonical catalog carries the six legacy presets without a parallel SQL definition", () => {
  assert(catalog.presets.length === 6, "expected six presets");
  assert(stable(catalog.presets.map((preset) => [preset.id, preset.name, preset.config, preset.layout])) === stable([
    ["preset-competition-lifts", "Competition lifts", catalog.presets[0].config, { order: 0, col_span: 2 }],
    ["preset-weekly-load-heatmap", "Weekly load heatmap", catalog.presets[1].config, { order: 1, col_span: 2 }],
    ["preset-avg-intensity", "Average intensity by week", catalog.presets[2].config, { order: 2, col_span: 1 }],
    ["preset-pattern-weekday", "Pattern recruitment by weekday", catalog.presets[3].config, { order: 3, col_span: 2 }],
    ["preset-spacing-e1rm", "Spacing vs e1RM", catalog.presets[4].config, { order: 4, col_span: 2 }],
    ["preset-block-vs-previous", "Block vs previous block", catalog.presets[5].config, { order: 5, col_span: 2 }],
  ]), "preset IDs, names, or layouts changed");
});

Deno.test("schema failures are returned as validation detail arrays", () => {
  try {
    parseSavedCardWrite({ name: "Bad", config: { metrics: [], range: { n: 2 } } });
    throw new Error("expected validation failure");
  } catch (error) {
    assert((error as { status?: number }).status === 422, "schema failure did not use 422");
    assert(Array.isArray((error as { detail?: unknown }).detail), "schema failure detail must be an array");
  }
});

import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type SavedCard = {
  id: string;
  name: string;
  config: JsonObject;
  layout: { order: number; col_span: 1 | 2 };
  updated_at: string | null;
};
type Preset = { id?: string | null; name: string; config: JsonObject; layout: { order: number; col_span: 1 | 2 } };
type RpcResult = { denial: string | null; cards?: SavedCard[]; card?: SavedCard | null; tombstoned?: boolean; status?: string };

const metrics = new Set(["tonnage", "e1rm", "avg_intensity", "avg_rpe", "inol", "acwr", "session_count", "set_count", "rep_count", "session_spacing"]);
const grains = new Set(["day", "week", "block"]);
const visualizations = new Set(["line", "bar", "heatmap", "weekday_matrix", "table"]);
const aggregations = new Set(["sum", "mean", "max", "last"]);
const scopes = new Set(["movement", "pattern", "all"]);
const comparisons = new Set(["prescribed_vs_actual", "period_vs_period"]);
const relatives = new Set(["previous_equal", "previous_block"]);
const defaultAggregation: Record<string, string> = {
  tonnage: "sum", e1rm: "max", avg_intensity: "mean", avg_rpe: "mean", inol: "sum",
  acwr: "last", session_count: "sum", set_count: "sum", rep_count: "sum", session_spacing: "mean",
};
const supported: Record<string, { grains: string[]; visualizations: string[]; aggregations: string[] }> = {
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

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function schemaFailure(path: Array<string | number>, message: string, value?: unknown): never {
  const issue: JsonObject = { type: "value_error", loc: ["body", ...path], msg: message };
  if (value !== undefined) issue.input = value;
  throw new ApiError(422, [issue]);
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function pydanticInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export function parseSavedCardWrite(input: unknown): { id: string | null; name: string; config: JsonObject; layout: { order: number; col_span: 1 | 2 } } {
  if (!object(input)) schemaFailure([], "Input should be a valid dictionary", input);
  if (input.id !== undefined && input.id !== null && typeof input.id !== "string") schemaFailure(["id"], "Input should be a valid string", input.id);
  if (typeof input.name !== "string") schemaFailure(["name"], "Input should be a valid string", input.name);
  const raw = input.config;
  if (!object(raw)) schemaFailure(["config"], "Input should be a valid dictionary", raw);
  if (!Array.isArray(raw.metrics) || raw.metrics.length < 1) schemaFailure(["config", "metrics"], "List should have at least 1 item", raw.metrics);
  const metricList: string[] = [];
  for (const metric of raw.metrics) {
    if (typeof metric !== "string" || !metrics.has(metric)) schemaFailure(["config", "metrics"], "Input should be a valid metric", metric);
    if (!metricList.includes(metric)) metricList.push(metric);
  }
  const grain = raw.time_grain === undefined ? "week" : raw.time_grain;
  if (typeof grain !== "string" || !grains.has(grain)) schemaFailure(["config", "time_grain"], "Input should be day, week, or block", grain);
  const visualization = raw.visualization === undefined ? "line" : raw.visualization;
  if (typeof visualization !== "string" || !visualizations.has(visualization)) schemaFailure(["config", "visualization"], "Input should be a valid visualization", visualization);
  const aggregation = raw.aggregation === undefined || raw.aggregation === null ? null : raw.aggregation;
  if (aggregation !== null && (typeof aggregation !== "string" || !aggregations.has(aggregation))) schemaFailure(["config", "aggregation"], "Input should be a valid aggregation", aggregation);
  const rangeInput = raw.range;
  if (!object(rangeInput)) schemaFailure(["config", "range"], "Input should be a valid dictionary", rangeInput);
  let range: JsonObject;
  if (rangeInput.start !== undefined || rangeInput.end !== undefined) {
    if (!validDate(rangeInput.start)) schemaFailure(["config", "range", "start"], "Input should be a valid date", rangeInput.start);
    if (!validDate(rangeInput.end)) schemaFailure(["config", "range", "end"], "Input should be a valid date", rangeInput.end);
    if (rangeInput.end < rangeInput.start) schemaFailure(["config", "range"], "range end must be on or after start", rangeInput);
    range = { start: rangeInput.start, end: rangeInput.end };
  } else {
    const n = pydanticInteger(rangeInput.n);
    if (n === null || n <= 0 || n > 365) schemaFailure(["config", "range", "n"], "Input should be greater than 0 and at most 365", rangeInput.n);
    const rangeGrain = rangeInput.grain === undefined ? "week" : rangeInput.grain;
    if (typeof rangeGrain !== "string" || !grains.has(rangeGrain)) schemaFailure(["config", "range", "grain"], "Input should be day, week, or block", rangeGrain);
    range = { n, grain: rangeGrain };
  }
  const rawScopes = raw.scopes === undefined ? [{ kind: "all", ids: [] }] : raw.scopes;
  if (!Array.isArray(rawScopes)) schemaFailure(["config", "scopes"], "Input should be a valid list", rawScopes);
  const normalizedScopes = rawScopes.map((scope, index) => {
    if (!object(scope) || typeof scope.kind !== "string" || !scopes.has(scope.kind)) schemaFailure(["config", "scopes", index, "kind"], "Input should be movement, pattern, or all", scope);
    const ids = scope.ids === undefined ? [] : scope.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) schemaFailure(["config", "scopes", index, "ids"], "Input should be a list of strings", ids);
    return { kind: scope.kind, ids };
  });
  let comparison: JsonObject | null = null;
  if (raw.comparison !== undefined && raw.comparison !== null) {
    if (!object(raw.comparison) || typeof raw.comparison.kind !== "string" || !comparisons.has(raw.comparison.kind)) schemaFailure(["config", "comparison", "kind"], "Input should be prescribed_vs_actual or period_vs_period", raw.comparison);
    let secondary: JsonObject | null = null;
    if (raw.comparison.secondary !== undefined && raw.comparison.secondary !== null) {
      const spec = raw.comparison.secondary;
      if (!object(spec)) schemaFailure(["config", "comparison", "secondary"], "Input should be a valid dictionary", spec);
      const hasExplicit = spec.explicit !== undefined && spec.explicit !== null;
      const hasRelative = spec.relative !== undefined && spec.relative !== null;
      if (hasExplicit === hasRelative) schemaFailure(["config", "comparison", "secondary"], "period needs exactly one of explicit or relative", spec);
      if (hasExplicit) {
        if (!object(spec.explicit) || !validDate(spec.explicit.start) || !validDate(spec.explicit.end) || spec.explicit.end < spec.explicit.start) schemaFailure(["config", "comparison", "secondary", "explicit"], "Input should be an ordered date range", spec.explicit);
        secondary = { explicit: { start: spec.explicit.start, end: spec.explicit.end }, relative: null };
      } else {
        if (typeof spec.relative !== "string" || !relatives.has(spec.relative)) schemaFailure(["config", "comparison", "secondary", "relative"], "Input should be previous_equal or previous_block", spec.relative);
        secondary = { explicit: null, relative: spec.relative };
      }
    }
    comparison = { kind: raw.comparison.kind, secondary };
  }
  const config: JsonObject = { metrics: metricList, scopes: normalizedScopes, time_grain: grain, range, visualization, comparison, aggregation };
  const layoutInput = input.layout === undefined ? {} : input.layout;
  if (!object(layoutInput)) schemaFailure(["layout"], "Input should be a valid dictionary", layoutInput);
  const order = layoutInput.order === undefined ? 0 : pydanticInteger(layoutInput.order);
  if (order === null) schemaFailure(["layout", "order"], "Input should be a valid integer", layoutInput.order);
  const colSpan = layoutInput.col_span === undefined ? 1 : layoutInput.col_span;
  if (colSpan !== 1 && colSpan !== 2) schemaFailure(["layout", "col_span"], "Input should be 1 or 2", colSpan);
  return { id: (input.id as string | null | undefined) || null, name: input.name as string, config, layout: { order: order as number, col_span: colSpan as 1 | 2 } };
}

export function validateCardCompatibility(config: JsonObject): string[] {
  const metricList = config.metrics as string[];
  const grain = config.time_grain as string;
  const visualization = config.visualization as string;
  const reasons: string[] = [];
  if (metricList.includes("e1rm") && metricList.includes("set_count")) reasons.push("e1rm is undefined for set_count; split into separate cards");
  for (const metric of metricList) {
    const spec = supported[metric];
    if (!spec) continue;
    if (!spec.grains.includes(grain)) reasons.push(`${metric} does not support ${grain} grain`);
    if (!spec.visualizations.includes(visualization)) reasons.push(`${metric} cannot render as ${visualization}`);
    const how = (config.aggregation as string | null) ?? defaultAggregation[metric];
    if (!spec.aggregations.includes(how)) reasons.push(`${metric} cannot aggregate with ${how}`);
  }
  if (metricList.includes("acwr") && grain !== "week") reasons.push("acwr requires week grain");
  if (visualization === "weekday_matrix" && metricList.some((metric) => !["set_count", "tonnage", "session_count", "rep_count"].includes(metric))) reasons.push("weekday_matrix accepts set_count, tonnage, session_count, or rep_count");
  const comparison = config.comparison as JsonObject | null;
  if (comparison?.kind === "period_vs_period" && !comparison.secondary) reasons.push("period comparison needs a secondary period");
  return reasons;
}

function parseRpc(value: unknown): RpcResult {
  if (typeof value === "string") {
    try { return JSON.parse(value) as RpcResult; } catch { /* handled below */ }
  }
  if (object(value)) return value as RpcResult;
  throw new Error("Insight card database interface returned an invalid result");
}
function checkDenial(result: RpcResult): void {
  if (result.denial === "invalid_session") throw invalidCredentials();
  if (result.denial) throw new ApiError(422, "Invalid request");
}
function cardValue(result: RpcResult): SavedCard {
  if (!result.card) throw new Error("Insight card database interface returned no card");
  return result.card;
}
async function callRpc<T>(db: Database, sql: string, params: unknown[]): Promise<T> {
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: T }>(sql, params);
    if (!result.rows[0]) throw new Error("Insight card database interface returned no result");
    return result.rows[0].payload;
  } finally { client.release(); }
}

export async function handleInsightCardsRoute(
  request: Request,
  _config: AppConfig,
  db: Database,
  principal: Principal,
  path: string,
  presets: Preset[],
): Promise<Response> {
  if (path === "/api/insight-cards") {
    if (request.method === "GET") {
      const raw = await callRpc<unknown>(db, "select al_private.al_insight_cards_list_or_seed($1::text,$2::text,$3::jsonb) as payload", [principal.user.id, principal.sessionId, JSON.stringify(presets)]);
      const result = parseRpc(raw); checkDenial(result);
      return new Response(JSON.stringify(result.cards ?? []), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (request.method === "POST") {
      const input = await readBody(request);
      const body = parseSavedCardWrite(input);
      const reasons = validateCardCompatibility(body.config);
      if (reasons.length) throw new ApiError(422, { code: "INCOMPATIBLE_CARD", reasons });
      const result = parseRpc(await callRpc<unknown>(db, "select al_private.al_insight_cards_create($1::text,$2::text,$3::text,$4::text,$5::jsonb,$6::jsonb) as payload", [principal.user.id, principal.sessionId, body.id ?? crypto.randomUUID(), body.name, JSON.stringify(body.config), JSON.stringify(body.layout)]));
      checkDenial(result); return jsonResponseCard(cardValue(result));
    }
    throw new ApiError(405, "Method not allowed");
  }
  const match = path.match(/^\/api\/insight-cards\/([^/]+)$/);
  if (!match) throw new ApiError(404, "Not found");
  let cardId: string;
  try { cardId = decodeURIComponent(match[1]); } catch { throw new ApiError(404, "Card not found"); }
  if (request.method === "PUT") {
    const body = parseSavedCardWrite(await readBody(request));
    const reasons = validateCardCompatibility(body.config);
    if (reasons.length) throw new ApiError(422, { code: "INCOMPATIBLE_CARD", reasons });
    const result = parseRpc(await callRpc<unknown>(db, "select al_private.al_insight_cards_update($1::text,$2::text,$3::text,$4::text,$5::jsonb,$6::jsonb) as payload", [principal.user.id, principal.sessionId, cardId, body.name, JSON.stringify(body.config), JSON.stringify(body.layout)]));
    checkDenial(result);
    if (!result.card) throw new ApiError(404, "Card not found");
    return jsonResponseCard(result.card);
  }
  if (request.method === "DELETE") {
    const result = parseRpc(await callRpc<unknown>(db, "select al_private.al_insight_cards_tombstone($1::text,$2::text,$3::text) as payload", [principal.user.id, principal.sessionId, cardId]));
    checkDenial(result);
    if (!result.tombstoned) throw new ApiError(404, "Card not found");
    return new Response(JSON.stringify({ status: result.status }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }
  throw new ApiError(405, "Method not allowed");
}

async function readBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new ApiError(422, [{ type: "json_invalid", loc: ["body"], msg: "Invalid JSON body" }]); }
}
function jsonResponseCard(card: SavedCard): Response {
  return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type SetInput = {
  id: string | null;
  label: string | null;
  scope: string | null;
  plannedWeight: number | null;
  plannedReps: number | null;
  plannedRpe: number | null;
  intensityType: string | null;
  isAuto: boolean;
  isTop: boolean | null;
  actual: number | null;
  reps: number | null;
  executedRpe: number | null;
  dropPercent: number | null;
};
type RpcResult = { denial: string | null; exercise?: unknown; conflict?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: Array<string | number>, message: string, input: unknown, type: string): never {
  const issue: JsonObject = { type, loc: ["body", ...path], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

function optionalString(row: JsonObject, key: string, path: Array<string | number>): string | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") schemaFailure([...path, key], "Input should be a valid string", value, "string_type");
  return value;
}

const FLOAT_TEXT = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i;

function optionalFloat(row: JsonObject, key: string, path: Array<string | number>): number | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string" && FLOAT_TEXT.test(value.trim())) return Number(value.trim());
  schemaFailure([...path, key], typeof value === "string"
    ? "Input should be a valid number, unable to parse string as a number"
    : "Input should be a valid number", value, typeof value === "string" ? "float_parsing" : "float_type");
}

function optionalInteger(row: JsonObject, key: string, path: Array<string | number>): number | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return value;
    if (Number.isFinite(value) && Math.trunc(value) === value) return value;
    schemaFailure([...path, key], "Input should be a valid integer, got a number with a fractional part", value, "int_from_float");
  }
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
    schemaFailure([...path, key], "Input should be a valid integer, unable to parse string as an integer", value, "int_parsing");
  }
  schemaFailure([...path, key], typeof value === "string"
    ? "Input should be a valid integer, unable to parse string as an integer"
    : "Input should be a valid integer", value, typeof value === "string" ? "int_parsing" : "int_type");
}

function optionalBoolean(row: JsonObject, key: string, path: Array<string | number>, fallback: boolean): boolean {
  const value = row[key];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on", "t"].includes(lowered)) return true;
    if (["false", "0", "no", "n", "off", "f"].includes(lowered)) return false;
  }
  schemaFailure([...path, key], "Input should be a valid boolean", value, "bool_parsing");
}

function parseSetRow(value: unknown, index: number): SetInput {
  const path = ["sets", index];
  if (!isObject(value)) schemaFailure(path, "Input should be a valid dictionary", value, "model_type");
  const isTopValue = value.isTop;
  let isTop: boolean | null = null;
  if (isTopValue !== undefined && isTopValue !== null) isTop = optionalBoolean(value, "isTop", path, false);
  return {
    id: optionalString(value, "id", path),
    label: optionalString(value, "label", path),
    scope: optionalString(value, "scope", path) ?? "both",
    plannedWeight: optionalFloat(value, "plannedWeight", path),
    plannedReps: optionalInteger(value, "plannedReps", path),
    plannedRpe: optionalFloat(value, "plannedRpe", path),
    intensityType: optionalString(value, "intensityType", path),
    isAuto: optionalBoolean(value, "isAuto", path, false),
    isTop,
    actual: optionalFloat(value, "actual", path),
    reps: optionalInteger(value, "reps", path),
    executedRpe: optionalFloat(value, "executedRpe", path),
    dropPercent: optionalFloat(value, "dropPercent", path),
  };
}

export function parseReplaceExerciseSetsInput(value: unknown): SetInput[] {
  if (!isObject(value)) {
    throw new ApiError(422, [{ type: "model_type", loc: ["body"], msg: "Input should be a valid dictionary", input: value }]);
  }
  if (value.sets === undefined) {
    throw new ApiError(422, [{ type: "missing", loc: ["body", "sets"], msg: "Field required" }]);
  }
  if (!Array.isArray(value.sets)) {
    throw new ApiError(422, [{ type: "list_type", loc: ["body", "sets"], msg: "Input should be a valid list", input: value.sets }]);
  }
  return value.sets.map(parseSetRow);
}

function parseResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("Set replacement interface returned invalid JSON"); }
  }
  if (!isObject(value)) throw new Error("Set replacement interface returned an invalid result");
  return value as RpcResult;
}

function raiseDenial(denial: string): never {
  switch (denial) {
    case "invalid_session": throw invalidCredentials();
    case "account_ineligible":
      throw new ApiError(403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." });
    case "session_not_found": throw new ApiError(404, "Session not found");
    case "session_has_no_owner": throw new ApiError(400, "Session has no owner");
    case "athlete_forbidden": throw new ApiError(403, "Athletes can only access their own plan");
    case "coach_relationship_required": throw new ApiError(403, "Not linked to this athlete");
    case "workspace_access_required":
      throw new ApiError(403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." });
    case "feature_not_included":
      throw new ApiError(403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." });
    case "unsupported_role": throw new ApiError(403, "Not authorized");
    case "lift_not_found": throw new ApiError(404, "Lift not found");
    case "set_id_owned_elsewhere": throw new ApiError(404, "Set not found");
    case "tombstoned_set":
      throw new ApiError(409, { code: "TOMBSTONE_CONFLICT", message: "Deleted sets cannot be restored." });
    case "invalid_set_payload": throw new ApiError(422, "Invalid request");
    default: throw new Error("Set replacement interface rejected the request");
  }
}

export async function handleReplaceExerciseSets(
  request: Request,
  sessionId: string,
  exerciseId: string,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  if (request.method !== "PUT") throw new ApiError(405, "Method not allowed");
  let body: unknown;
  try { body = await request.json(); } catch {
    throw new ApiError(422, [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error" }]);
  }
  if (!isObject(body) || !Number.isSafeInteger(body.expected_revision) || Number(body.expected_revision) < 1) {
    throw new ApiError(409, { error: { code: "SYNC_CONFLICT_REVIEW", message: "Reload the lift before replacing its sets." } });
  }
  const expectedRevision = Number(body.expected_revision);
  const sets = parseReplaceExerciseSetsInput(body);
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_session_replace_exercise_sets_checked($1::text,$2::text,$3::text,$4::text,$5::bigint,$6::boolean,$7::integer,$8::jsonb) as payload",
      [
        principal.user.id,
        principal.sessionId,
        sessionId,
        exerciseId,
        expectedRevision,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
        JSON.stringify(sets),
      ],
    );
    if (!result.rows[0]) throw new Error("Set replacement interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    if (payload.denial === "revision_conflict") {
      throw new ApiError(409, { error: { code: "SYNC_CONFLICT_REVIEW", message: "The lift changed since it was loaded.", details: { conflicts: [payload.conflict] } } });
    }
    if (payload.denial) raiseDenial(payload.denial);
    if (!isObject(payload.exercise) || !Array.isArray(payload.exercise.sets)) {
      throw new Error("Set replacement interface returned an invalid exercise");
    }
    return jsonResponse(payload.exercise, 200);
  } finally {
    client.release();
  }
}

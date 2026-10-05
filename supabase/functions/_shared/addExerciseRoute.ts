import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type AddExerciseInput = {
  title: string;
  variation: string | null;
  tier: string | null;
  liftCategory: string | null;
  movementPattern: string | null;
  liftNote: string | null;
  plannedWeight: number | null;
  plannedReps: number | null;
  plannedRpe: number | null;
};
type RpcResult = { denial: string | null; exercise?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(key: string, message: string, input: unknown, type: string): never {
  const issue: JsonObject = { type, loc: ["body", key], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

function optionalString(body: JsonObject, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") schemaFailure(key, "Input should be a valid string", value, "string_type");
  return value;
}

const FLOAT_TEXT = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i;

function optionalFloat(body: JsonObject, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string" && FLOAT_TEXT.test(value.trim())) return Number(value.trim());
  schemaFailure(key, typeof value === "string" ? "Input should be a valid number, unable to parse string as a number" : "Input should be a valid number", value, typeof value === "string" ? "float_parsing" : "float_type");
}

function optionalInteger(body: JsonObject, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return value;
    if (Number.isFinite(value) && Math.trunc(value) === value) return value;
    schemaFailure(key, "Input should be a valid integer, got a number with a fractional part", value, "int_from_float");
  }
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
    schemaFailure(key, "Input should be a valid integer, unable to parse string as an integer", value, "int_parsing");
  }
  schemaFailure(key, typeof value === "string" ? "Input should be a valid integer, unable to parse string as an integer" : "Input should be a valid integer", value, typeof value === "string" ? "int_parsing" : "int_type");
}

export function parseAddExerciseInput(value: unknown): AddExerciseInput {
  if (!isObject(value)) {
    throw new ApiError(422, [{ type: "model_type", loc: ["body"], msg: "Input should be a valid dictionary", input: value }]);
  }
  if (value.title === undefined) schemaFailure("title", "Field required", undefined, "missing");
  if (typeof value.title !== "string") schemaFailure("title", "Input should be a valid string", value.title, "string_type");
  return {
    title: value.title,
    variation: optionalString(value, "variation"),
    tier: optionalString(value, "tier"),
    liftCategory: optionalString(value, "liftCategory"),
    movementPattern: optionalString(value, "movementPattern"),
    liftNote: optionalString(value, "liftNote"),
    plannedWeight: optionalFloat(value, "plannedWeight"),
    plannedReps: optionalInteger(value, "plannedReps"),
    plannedRpe: optionalFloat(value, "plannedRpe"),
  };
}

function parseRpcResult(value: unknown): RpcResult {
  if (typeof value === "string") value = JSON.parse(value);
  if (!isObject(value)) throw new Error("Add Exercise interface returned an invalid result");
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
    case "title_required": throw new ApiError(400, "title required");
    case "invalid_tier": throw new ApiError(400, "Invalid tier");
    case "invalid_lift_category": throw new ApiError(400, "Invalid liftCategory");
    case "invalid_movement_pattern": throw new ApiError(400, "Invalid movementPattern");
    case "invalid_request": throw new ApiError(422, "Invalid request");
    default: throw new Error("Add Exercise interface rejected the request");
  }
}

export async function handleAddSessionExercise(
  request: Request,
  sessionId: string,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(422, [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error" }]);
  }
  const input = parseAddExerciseInput(value);
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_session_add_exercise($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::double precision,$11::integer,$12::double precision,$13::boolean,$14::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        sessionId,
        input.title,
        input.variation,
        input.tier,
        input.liftCategory,
        input.movementPattern,
        input.liftNote,
        input.plannedWeight,
        input.plannedReps,
        input.plannedRpe,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Add Exercise interface returned no result");
    const payload = parseRpcResult(result.rows[0].payload);
    if (payload.denial) raiseDenial(payload.denial);
    if (!isObject(payload.exercise) || !Array.isArray(payload.exercise.sets)) {
      throw new Error("Add Exercise interface returned an invalid exercise");
    }
    return jsonResponse(payload.exercise, 200);
  } finally {
    client.release();
  }
}

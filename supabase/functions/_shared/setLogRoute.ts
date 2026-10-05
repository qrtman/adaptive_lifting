import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";
import { handleMicrocyclesRoute } from "./microcyclesRoute.ts";

type SetLogInput = {
  workoutId: string;
  exerciseId: string;
  setId: string;
  weight: number;
  reps: number;
  rpe: number;
  note: string | null;
  velocity: number | null;
  readiness: number | null;
  hrv: number | null;
};

type LogResult = { denial: string | null };
type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function issue(
  issues: JsonObject[],
  path: Array<string | number>,
  type: string,
  message: string,
  input?: unknown,
): void {
  const detail: JsonObject = { type, loc: ["body", ...path], msg: message };
  if (input !== undefined) detail.input = input;
  issues.push(detail);
}

function requiredString(row: JsonObject, key: string, issues: JsonObject[]): string {
  const value = row[key];
  if (value === undefined) {
    issue(issues, [key], "missing", "Field required");
    return "";
  }
  if (typeof value !== "string") {
    issue(issues, [key], "string_type", "Input should be a valid string", value);
    return "";
  }
  return value;
}

function numberValue(value: unknown, path: string, integer: boolean, issues: JsonObject[]): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    const valid = integer
      ? /^[+-]?\d+$/.test(trimmed)
      : /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i.test(trimmed);
    if (!valid) {
      issue(issues, [path], integer ? "int_parsing" : "float_parsing", integer
        ? "Input should be a valid integer, unable to parse string as an integer"
        : "Input should be a valid number, unable to parse string as a number", value);
      return 0;
    }
    const lowered = trimmed.toLowerCase();
    parsed = integer ? Number(trimmed) : lowered === "nan" ? Number.NaN
      : ["inf", "+inf", "infinity", "+infinity"].includes(lowered) ? Number.POSITIVE_INFINITY
      : ["-inf", "-infinity"].includes(lowered) ? Number.NEGATIVE_INFINITY
      : Number(trimmed);
  } else {
    issue(issues, [path], integer ? "int_type" : "float_type", integer
      ? "Input should be a valid integer"
      : "Input should be a valid number", value);
    return 0;
  }
  if (integer && !Number.isInteger(parsed)) {
    issue(issues, [path], "int_from_float", "Input should be a valid integer, got a number with a fractional part", value);
    return 0;
  }
  if (integer && !Number.isFinite(parsed)) {
    issue(issues, [path], "int_type", "Input should be a valid integer", value);
    return 0;
  }
  return parsed;
}

function requiredNumber(row: JsonObject, key: string, issues: JsonObject[], integer = false): number {
  const value = row[key];
  if (value === undefined) {
    issue(issues, [key], "missing", "Field required");
    return 0;
  }
  if (value === null) {
    issue(issues, [key], integer ? "int_type" : "float_type", integer
      ? "Input should be a valid integer"
      : "Input should be a valid number", value);
    return 0;
  }
  return numberValue(value, key, integer, issues);
}

function optionalString(row: JsonObject, key: string, issues: JsonObject[]): string | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    issue(issues, [key], "string_type", "Input should be a valid string", value);
    return null;
  }
  return value;
}

function optionalNumber(row: JsonObject, key: string, issues: JsonObject[], integer = false): number | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  return numberValue(value, key, integer, issues);
}

export function parseSetLogInput(value: unknown): SetLogInput {
  if (!object(value)) {
    throw new ApiError(422, [{
      type: "model_type",
      loc: ["body"],
      msg: "Input should be a valid dictionary",
      input: value,
    }]);
  }
  const issues: JsonObject[] = [];
  const result: SetLogInput = {
    workoutId: requiredString(value, "workoutId", issues),
    exerciseId: requiredString(value, "exerciseId", issues),
    setId: requiredString(value, "setId", issues),
    weight: requiredNumber(value, "weight", issues),
    reps: requiredNumber(value, "reps", issues, true),
    rpe: requiredNumber(value, "rpe", issues),
    note: optionalString(value, "note", issues),
    velocity: optionalNumber(value, "velocity", issues),
    readiness: optionalNumber(value, "readiness", issues, true),
    hrv: optionalNumber(value, "hrv", issues),
  };
  if (issues.length) throw new ApiError(422, issues);
  return result;
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
    case "unsupported_role": throw new ApiError(403, "Not authorized");
    case "target_set_not_found": throw new ApiError(404, "Target set not found");
    case "invalid_request": throw new ApiError(422, "Invalid request");
    default: throw new Error("Set Log interface rejected the request");
  }
}

export async function handleSetLog(
  request: Request,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new ApiError(422, [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error" }]);
  }
  const payload = parseSetLogInput(input);
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: LogResult }>(
      `select al_private.al_set_log(
        $1::text, $2::text, $3::text, $4::text, $5::text,
        $6::double precision, $7::integer, $8::double precision,
        $9::text, $10::double precision, $11::integer, $12::double precision,
        $13::boolean
      ) as payload`,
      [
        principal.user.id,
        principal.sessionId,
        payload.workoutId,
        payload.exerciseId,
        payload.setId,
        payload.weight,
        payload.reps,
        payload.rpe,
        payload.note,
        payload.velocity,
        payload.readiness,
        payload.hrv,
        config.enforceLegacyEmailVerification,
      ],
    );
    const response = result.rows[0]?.payload;
    if (!response) throw new Error("Set Log interface returned no result");
    if (response.denial) raiseDenial(response.denial);
  } finally {
    client.release();
  }

  // This is intentionally the same owner-scoped response as GET /api/microcycles.
  // For coaches the null athlete ID preserves the legacy all-linked-athletes view.
  return await handleMicrocyclesRoute(request, db, principal, config, null);
}

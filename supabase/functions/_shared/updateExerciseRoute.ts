import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
export type ExercisePatchInput = {
  variation: string | null;
  title: string | null;
  tier: string | null;
  liftCategory: string | null;
  movementPattern: string | null;
  liftNote: string | null;
  move: string | null;
  order: string[] | null;
};
type RpcResult = { denial: string | null; exercise?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: Array<string | number>, message: string, input?: unknown, type = "string_type"): never {
  const issue: JsonObject = { type, loc: ["body", ...path], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

function optionalString(input: JsonObject, key: keyof Omit<ExercisePatchInput, "order">): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") schemaFailure([key], "Input should be a valid string", value);
  return value;
}

export function parseExercisePatchInput(value: unknown): ExercisePatchInput {
  if (!isObject(value)) {
    throw new ApiError(422, [{
      type: "model_type",
      loc: ["body"],
      msg: "Input should be a valid dictionary",
      input: value,
    }]);
  }
  const parsed: Omit<ExercisePatchInput, "order"> = {
    variation: optionalString(value, "variation"),
    title: optionalString(value, "title"),
    tier: optionalString(value, "tier"),
    liftCategory: optionalString(value, "liftCategory"),
    movementPattern: optionalString(value, "movementPattern"),
    liftNote: optionalString(value, "liftNote"),
    move: optionalString(value, "move"),
  };
  const rawOrder = value.order;
  let order: string[] | null = null;
  if (rawOrder !== undefined && rawOrder !== null) {
    if (!Array.isArray(rawOrder)) schemaFailure(["order"], "Input should be a valid list", rawOrder, "list_type");
    order = rawOrder.map((item, index) => {
      if (typeof item !== "string") schemaFailure(["order", index], "Input should be a valid string", item);
      return item;
    });
  }
  return { ...parsed, order };
}

function parseResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("Exercise update interface returned invalid JSON"); }
  }
  if (!isObject(value)) throw new Error("Exercise update interface returned an invalid result");
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
    case "title_required": throw new ApiError(400, "title required");
    case "variation_required": throw new ApiError(400, "variation required");
    case "invalid_tier": throw new ApiError(400, "Invalid tier");
    case "invalid_lift_category": throw new ApiError(400, "Invalid liftCategory");
    case "invalid_movement_pattern": throw new ApiError(400, "Invalid movementPattern");
    case "invalid_move": throw new ApiError(400, "move must be up or down");
    case "invalid_order": throw new ApiError(400, "order must contain each live lift exactly once");
    case "invalid_request": throw new ApiError(422, "Invalid request");
    default: throw new Error("Exercise update interface rejected the request");
  }
}

export async function handleUpdateSessionExercise(
  request: Request,
  sessionId: string,
  exerciseId: string,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  if (request.method !== "PATCH") throw new ApiError(405, "Method not allowed");
  let body: unknown;
  try { body = await request.json(); } catch {
    throw new ApiError(422, [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error" }]);
  }
  const input = parseExercisePatchInput(body);
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_session_update_exercise($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::text[],$13::boolean,$14::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        sessionId,
        exerciseId,
        input.title,
        input.variation,
        input.tier,
        input.liftCategory,
        input.movementPattern,
        input.liftNote,
        input.move,
        input.order,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Exercise update interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    if (typeof payload.denial === "string") raiseDenial(payload.denial);
    if (!isObject(payload.exercise) || !Array.isArray(payload.exercise.sets)) {
      throw new Error("Exercise update interface returned an invalid exercise");
    }
    return jsonResponse(payload.exercise, 200);
  } finally {
    client.release();
  }
}

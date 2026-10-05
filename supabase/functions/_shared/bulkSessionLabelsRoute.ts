import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type BulkLabelsInput = {
  sessionIds: string[];
  blockLabel: string | null;
  weekLabel: string | null;
  clearBlock: boolean;
  clearWeek: boolean;
};
type RpcResult = { denial: string | null; result?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: Array<string | number>, message: string, input?: unknown): never {
  const issue: JsonObject = { type: "value_error", loc: ["body", ...path], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

function optionalString(input: JsonObject, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    schemaFailure([key], "Input should be a valid string", value);
  }
  return value;
}

function parseInput(value: unknown): BulkLabelsInput {
  if (!isObject(value)) {
    throw new ApiError(422, [{
      type: "model_type",
      loc: ["body"],
      msg: "Input should be a valid dictionary",
      input: value,
    }]);
  }
  if (!Array.isArray(value.sessionIds) || value.sessionIds.some((item) => typeof item !== "string")) {
    schemaFailure(["sessionIds"], "Input should be a valid list of strings", value.sessionIds);
  }
  for (const key of ["clearBlock", "clearWeek"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      schemaFailure([key], "Input should be a valid boolean", value[key]);
    }
  }
  // The legacy request model validates athleteId, but the route deliberately
  // ignores it for target selection and authorization.
  optionalString(value, "athleteId");
  return {
    sessionIds: value.sessionIds as string[],
    blockLabel: optionalString(value, "blockLabel"),
    weekLabel: optionalString(value, "weekLabel"),
    clearBlock: value.clearBlock === true,
    clearWeek: value.clearWeek === true,
  };
}

function parseResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Bulk session-label interface returned invalid JSON");
    }
  }
  if (!isObject(value)) throw new Error("Bulk session-label interface returned an invalid result");
  return value as RpcResult;
}

function raiseDenial(denial: string): never {
  switch (denial) {
    case "invalid_session":
      throw invalidCredentials();
    case "account_ineligible":
      throw new ApiError(403, {
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email before signing in.",
      });
    case "session_not_found":
      throw new ApiError(404, "Session not found");
    case "athlete_forbidden":
      throw new ApiError(403, "Athletes can only access their own plan");
    case "coach_relationship_required":
      throw new ApiError(403, "Not linked to this athlete");
    case "workspace_access_required":
      throw new ApiError(403, {
        code: "WORKSPACE_ACCESS_REQUIRED",
        message: "An active coaching plan is required.",
      });
    case "feature_not_included":
      throw new ApiError(403, {
        code: "FEATURE_NOT_INCLUDED",
        feature: "programming",
        message: "This coaching plan does not include programming.",
      });
    case "unsupported_role":
      throw new ApiError(403, "Not authorized");
    case "invalid_request":
      throw new ApiError(422, "Invalid request");
    default:
      throw new Error("Bulk session-label interface rejected the request");
  }
}

export async function handleBulkSessionLabels(
  request: Request,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(422, [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error" }]);
  }
  const input = parseInput(body);
  if (!input.sessionIds.length) throw new ApiError(400, "sessionIds required");

  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_sessions_bulk_labels($1::text,$2::text,$3::text[],$4::text,$5::text,$6::boolean,$7::boolean,$8::boolean,$9::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        input.sessionIds,
        input.blockLabel,
        input.weekLabel,
        input.clearBlock,
        input.clearWeek,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Bulk session-label interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    if (typeof payload.denial === "string") raiseDenial(payload.denial);
    if (!isObject(payload.result) || payload.result.status !== "success" ||
      !Array.isArray(payload.result.updated) ||
      payload.result.updated.some((id) => typeof id !== "string")) {
      throw new Error("Bulk session-label interface returned an invalid success result");
    }
    return jsonResponse({ status: "success", updated: payload.result.updated }, 200);
  } finally {
    client.release();
  }
}

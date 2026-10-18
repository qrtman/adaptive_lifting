import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type CopyWeekInput = {
  sessionIds: string[];
  athleteId: string | null;
  dateOffsetDays: number;
  targetBlockLabel: string | null;
  targetWeekLabel: string | null;
  copyMode: string | null;
  includeLogs: boolean | null;
  preserveWeekLabel: boolean;
};
type RpcResult = { denial: string | null; session_id?: string; result?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: Array<string | number>, message: string, input?: unknown, type = "value_error"): never {
  const issue: JsonObject = { type, loc: ["body", ...path], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

function optionalString(input: JsonObject, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") schemaFailure([key], "Input should be a valid string", value, "string_type");
  return value;
}

export function resolveCopyMode(copyMode: string | null, includeLogs: boolean | null): string {
  return copyMode ?? (includeLogs === false ? "plan" : "logs");
}

function parseInput(value: unknown): CopyWeekInput {
  if (!isObject(value)) {
    throw new ApiError(422, [{
      type: "model_type",
      loc: ["body"],
      msg: "Input should be a valid dictionary",
      input: value,
    }]);
  }
  if (value.sessionIds === undefined) {
    schemaFailure(["sessionIds"], "Field required", undefined, "missing");
  }
  if (!Array.isArray(value.sessionIds)) {
    schemaFailure(["sessionIds"], "Input should be a valid list", value.sessionIds, "list_type");
  }
  for (let index = 0; index < value.sessionIds.length; index++) {
    if (typeof value.sessionIds[index] !== "string") {
      schemaFailure(["sessionIds", index], "Input should be a valid string", value.sessionIds[index], "string_type");
    }
  }
  const rawOffset = value.dateOffsetDays === undefined ? 7 : value.dateOffsetDays;
  const offset = typeof rawOffset === "string" && /^[+-]?\d+$/.test(rawOffset)
    ? Number(rawOffset)
    : rawOffset;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset)) {
    const type = typeof rawOffset === "number" ? "int_from_float" : typeof rawOffset === "string" ? "int_parsing" : "int_type";
    schemaFailure(["dateOffsetDays"], "Input should be a valid integer", rawOffset, type);
  }
  if (value.includeLogs !== undefined && value.includeLogs !== null && typeof value.includeLogs !== "boolean") {
    schemaFailure(["includeLogs"], "Input should be a valid boolean", value.includeLogs, "bool_type");
  }
  if (value.preserveWeekLabel !== undefined && typeof value.preserveWeekLabel !== "boolean") {
    schemaFailure(["preserveWeekLabel"], "Input should be a valid boolean", value.preserveWeekLabel, "bool_type");
  }
  return {
    sessionIds: value.sessionIds as string[],
    athleteId: optionalString(value, "athleteId"),
    dateOffsetDays: offset,
    targetBlockLabel: optionalString(value, "targetBlockLabel"),
    targetWeekLabel: optionalString(value, "targetWeekLabel"),
    copyMode: optionalString(value, "copyMode"),
    includeLogs: value.includeLogs === undefined || value.includeLogs === null ? null : value.includeLogs as boolean,
    preserveWeekLabel: value.preserveWeekLabel === true,
  };
}

function parseResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Copy-week interface returned invalid JSON");
    }
  }
  if (!isObject(value)) throw new Error("Copy-week interface returned an invalid result");
  return value as RpcResult;
}

function raiseDenial(denial: string, sourceId?: string): never {
  switch (denial) {
    case "invalid_session":
      throw invalidCredentials();
    case "account_ineligible":
      throw new ApiError(403, {
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email before signing in.",
      });
    case "session_not_found":
      throw new ApiError(404, `Session not found: ${sourceId ?? ""}`.trim());
    case "session_has_no_owner":
      throw new ApiError(400, "Session has no owner");
    case "mixed_plan":
      throw new ApiError(400, "All sessions must belong to one athlete plan");
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
    case "invalid_source_date":
      throw new ApiError(400, "Session date must be YYYY-MM-DD");
    case "invalid_request":
      throw new ApiError(422, "Invalid request");
    default:
      throw new Error("Copy-week interface rejected the request");
  }
}

export async function handleCopyWeek(
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

  const mode = resolveCopyMode(input.copyMode, input.includeLogs);
  if (!(mode === "lifts" || mode === "plan" || mode === "logs")) {
    throw new ApiError(400, "copyMode must be lifts, plan, or logs");
  }
  // athleteId is retained and schema-validated for API compatibility. Source
  // ownership determines the plan, matching the stable route.

  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_sessions_copy_week($1::text,$2::text,$3::text[],$4::integer,$5::text,$6::text,$7::text,$8::boolean,$9::boolean,$10::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        input.sessionIds,
        input.dateOffsetDays,
        input.targetBlockLabel,
        input.targetWeekLabel,
        mode,
        input.preserveWeekLabel,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Copy-week interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    if (typeof payload.denial === "string") raiseDenial(payload.denial, payload.session_id);
    if (!isObject(payload.result) || payload.result.status !== "success" || !Array.isArray(payload.result.copied)) {
      throw new Error("Copy-week interface returned an invalid success result");
    }
    return jsonResponse({ status: "success", copied: payload.result.copied }, 200);
  } finally {
    client.release();
  }
}

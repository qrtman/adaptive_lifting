import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type SessionCreateInput = {
  date: string;
  title: string | null;
  dayLabel: string | null;
  blockLabel: string | null;
  weekLabel: string | null;
  athleteId: string | null;
  microcycleId: string | null;
};
type RpcResult = { denial: string | null; session?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: string[], message: string, input?: unknown): never {
  const issue: JsonObject = { type: "string_type", loc: ["body", ...path], msg: message };
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

export function parseSessionCreateInput(input: unknown): SessionCreateInput {
  if (!isObject(input)) {
    throw new ApiError(422, [{
      type: "model_type",
      loc: ["body"],
      msg: "Input should be a valid dictionary",
      input,
    }]);
  }
  if (typeof input.date !== "string") {
    schemaFailure(["date"], input.date === undefined ? "Field required" : "Input should be a valid string", input.date);
  }
  const title = input.title === undefined ? "Session" : optionalString(input, "title");
  return {
    date: input.date,
    title,
    dayLabel: optionalString(input, "dayLabel"),
    blockLabel: optionalString(input, "blockLabel"),
    weekLabel: optionalString(input, "weekLabel"),
    athleteId: optionalString(input, "athleteId"),
    microcycleId: optionalString(input, "microcycleId"),
  };
}

function parseResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Session create interface returned invalid JSON");
    }
  }
  if (!isObject(value)) throw new Error("Session create interface returned an invalid result");
  return value as RpcResult;
}

export async function handleCreateSession(
  request: Request,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(422, [{
      type: "json_invalid",
      loc: ["body", 0],
      msg: "JSON decode error",
    }]);
  }
  const input = parseSessionCreateInput(body);
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_session_create($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::boolean,$11::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        input.athleteId,
        input.date,
        input.title,
        input.dayLabel,
        input.blockLabel,
        input.weekLabel,
        input.microcycleId,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Session create interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    switch (payload.denial) {
      case "invalid_session":
        throw invalidCredentials();
      case "account_ineligible":
        throw new ApiError(403, {
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Verify your email before signing in.",
        });
      case "coach_athlete_required":
        throw new ApiError(400, "athlete_id is required for coaches");
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
      case "microcycle_not_found":
        throw new ApiError(404, "Microcycle not found in athlete plan");
      case "invalid_date":
        throw new ApiError(400, "date must be YYYY-MM-DD");
      case "unsupported_role":
        throw new ApiError(403, "Not authorized");
      case "invalid_request":
        throw new ApiError(422, "Invalid request");
      case null:
        if (payload.session === undefined) throw new Error("Session create interface returned no session");
        return jsonResponse(payload.session, 200);
      default:
        throw new Error("Session create interface rejected the request");
    }
  } finally {
    client.release();
  }
}

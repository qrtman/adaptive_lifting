import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";
import { MATH_VERSION } from "./analytics.ts";

type JsonObject = Record<string, unknown>;
type Change = { entity: string; id: string; mutation_id: string; updated_at: string; fields: JsonObject };
type Payload = {
  schema_version: number; client_device_id: string; workout_id: string;
  mutation_type: string; last_updated_at: string; math_version?: string | null; changes: Change[];
};
type RpcResult = {
  denial: string | null; accepted_mutation_ids?: string[];
  rejected_mutations?: string[]; conflicts?: Array<{ mutation_id: string; reason: string }>;
  workout_id?: string; canonical_last_updated_at?: string; math_version?: string;
};

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: Array<string | number>, message: string, input?: unknown): never {
  const issue: JsonObject = { type: "value_error", loc: ["body", ...path], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  return null;
}

export function parseWorkoutSyncPayload(input: unknown): Payload {
  if (!object(input)) schemaFailure([], "Input should be a valid dictionary", input);
  const schemaVersion = integer(input.schema_version);
  if (schemaVersion === null) schemaFailure(["schema_version"], "Input should be a valid integer", input.schema_version);
  if (typeof input.client_device_id !== "string") schemaFailure(["client_device_id"], "Input should be a valid string", input.client_device_id);
  if (typeof input.last_updated_at !== "string") schemaFailure(["last_updated_at"], "Input should be a valid string", input.last_updated_at);
  const mutationType = input.mutation_type === undefined ? "workout" : input.mutation_type;
  if (mutationType !== "workout" && mutationType !== "insight_card") {
    schemaFailure(["mutation_type"], "Input should be 'workout' or 'insight_card'", mutationType);
  }
  if (typeof input.workout_id !== "string") schemaFailure(["workout_id"], "Input should be a valid string", input.workout_id);
  if (input.math_version !== undefined && input.math_version !== null && typeof input.math_version !== "string") {
    schemaFailure(["math_version"], "Input should be a valid string", input.math_version);
  }
  if (!Array.isArray(input.changes)) schemaFailure(["changes"], "Input should be a valid list", input.changes);
  const changes = input.changes.map((raw, index): Change => {
    if (!object(raw)) schemaFailure(["changes", index], "Input should be a valid dictionary", raw);
    for (const key of ["entity", "id", "mutation_id", "updated_at"] as const) {
      if (typeof raw[key] !== "string") schemaFailure(["changes", index, key], "Input should be a valid string", raw[key]);
    }
    if (!object(raw.fields)) schemaFailure(["changes", index, "fields"], "Input should be a valid dictionary", raw.fields);
    return { entity: raw.entity as string, id: raw.id as string, mutation_id: raw.mutation_id as string, updated_at: raw.updated_at as string, fields: raw.fields };
  });
  return {
    schema_version: schemaVersion,
    client_device_id: input.client_device_id,
    workout_id: input.workout_id,
    mutation_type: mutationType,
    last_updated_at: input.last_updated_at,
    math_version: input.math_version as string | null | undefined,
    changes,
  };
}

function error(code: string, message: string, details?: JsonObject): ApiError {
  return new ApiError(409, { error: { code, message, ...(details ? { details } : {}) } });
}

function parseResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try { return JSON.parse(value) as RpcResult; } catch { /* throw below */ }
  }
  if (object(value)) return value as RpcResult;
  throw new Error("Workout sync interface returned an invalid result");
}

export async function handleWorkoutSync(
  request: Request,
  pathWorkoutId: string,
  config: AppConfig,
  db: Database,
  principal: Principal,
): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  let input: unknown;
  try { input = await request.json(); } catch { schemaFailure([], "JSON decode error"); }
  const payload = parseWorkoutSyncPayload(input);
  // Keep the legacy route-level mismatch response and check it before any write.
  if (payload.workout_id !== decodeURIComponent(pathWorkoutId)) {
    throw new ApiError(400, "Workout URL and payload do not match");
  }
  if (payload.mutation_type === "insight_card") {
    throw new ApiError(400, { error: { code: "INVALID_MUTATION_TYPE", message: "Use /api/insight-cards/sync for insight_card mutations." } });
  }
  if (payload.schema_version !== 1) {
    throw error("CLIENT_SCHEMA_UNSUPPORTED", "App update required.");
  }
  if (payload.math_version && payload.math_version !== MATH_VERSION) {
    throw error("MATH_VERSION_MISMATCH", "Client math version does not match the server. App update required.", {
      server: MATH_VERSION,
      client: payload.math_version,
    });
  }

  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_workout_sync($1::text,$2::text,$3::text,$4::text,$5::text,$6::boolean,$7::integer,$8::jsonb) as payload",
      [
        principal.user.id,
        principal.sessionId,
        decodeURIComponent(pathWorkoutId),
        payload.workout_id,
        payload.client_device_id,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
        JSON.stringify(payload.changes),
      ],
    );
    const value = result.rows[0]?.payload;
    if (!value) throw new Error("Workout sync interface returned no result");
    const response = parseResult(value);
    switch (response.denial) {
      case "invalid_session": throw invalidCredentials();
      case "account_ineligible":
        throw new ApiError(403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." });
      case "workout_not_found": throw new ApiError(404, "Workout not found");
      case "coach_relationship_required": throw new ApiError(404, "Workout not found");
      case "workspace_access_required": throw new ApiError(403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." });
      case "feature_not_included": throw new ApiError(403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." });
      case "path_payload_mismatch": throw new ApiError(400, "Workout URL and payload do not match");
      case "device_revoked": throw new ApiError(403, "Client device is revoked or belongs to another user");
      case "workout_locked": throw error("WORKOUT_LOCKED", "This workout is locked right now.");
      case "invalid_request": throw new ApiError(422, "Invalid request");
      case null: break;
      default: throw new Error("Workout sync interface rejected the request");
    }
    return jsonResponse({
      workout_id: response.workout_id,
      canonical_last_updated_at: response.canonical_last_updated_at,
      accepted_mutation_ids: response.accepted_mutation_ids ?? [],
      rejected_mutations: response.rejected_mutations ?? [],
      conflicts: response.conflicts ?? [],
      math_version: MATH_VERSION,
    });
  } finally {
    client.release();
  }
}

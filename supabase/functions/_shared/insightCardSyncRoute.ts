import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";
import { parseSavedCardWrite, validateCardCompatibility } from "./insightCardsRoute.ts";
import { MATH_VERSION } from "./analytics.ts";

type JsonObject = Record<string, unknown>;
export type Change = {
  entity: string;
  id: string;
  mutation_id: string;
  updated_at: string;
  fields: JsonObject;
  _compatibility_rejected?: boolean;
  _schema_error?: boolean;
};
export type Payload = {
  schema_version: number;
  client_device_id: string;
  workout_id?: string | null;
  mutation_type: "workout" | "insight_card";
  last_updated_at: string;
  math_version?: string | null;
  changes: Change[];
};
type RpcResult = {
  denial: string | null;
  accepted_mutation_ids?: string[];
  rejected_mutation_ids?: string[];
  canonical?: unknown[];
  math_version?: string;
};

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaFailure(path: Array<string | number>, message: string, input?: unknown): never {
  const issue: JsonObject = { type: "value_error", loc: ["body", ...path], msg: message };
  if (input !== undefined) issue.input = input;
  throw new ApiError(422, [issue]);
}

export function parseInsightCardSyncPayload(input: unknown): Payload {
  if (!object(input)) schemaFailure([], "Input should be a valid dictionary", input);
  const schemaVersion = input.schema_version;
  const parsedVersion = typeof schemaVersion === "number" && Number.isInteger(schemaVersion)
    ? schemaVersion
    : typeof schemaVersion === "boolean" ? Number(schemaVersion) : null;
  const coercedVersion = parsedVersion ?? (typeof schemaVersion === "string" && /^[+-]?\d+$/.test(schemaVersion.trim())
    ? Number(schemaVersion.trim())
    : typeof schemaVersion === "number" && Number.isFinite(schemaVersion) && Number.isInteger(schemaVersion)
    ? schemaVersion
    : null);
  if (coercedVersion === null || !Number.isSafeInteger(coercedVersion)) {
    schemaFailure(["schema_version"], "Input should be a valid integer", schemaVersion);
  }
  if (typeof input.client_device_id !== "string") schemaFailure(["client_device_id"], "Input should be a valid string", input.client_device_id);
  if (typeof input.last_updated_at !== "string") schemaFailure(["last_updated_at"], "Input should be a valid string", input.last_updated_at);
  const mutationType = input.mutation_type === undefined ? "workout" : input.mutation_type;
  if (mutationType !== "workout" && mutationType !== "insight_card") {
    schemaFailure(["mutation_type"], "Input should be 'workout' or 'insight_card'", mutationType);
  }
  if (input.workout_id !== undefined && input.workout_id !== null && typeof input.workout_id !== "string") {
    schemaFailure(["workout_id"], "Input should be a valid string", input.workout_id);
  }
  if (mutationType === "workout" && (typeof input.workout_id !== "string" || !input.workout_id)) {
    schemaFailure([], "Value error, workout_id is required for workout mutations", input);
  }
  if (input.math_version !== undefined && input.math_version !== null && typeof input.math_version !== "string") {
    schemaFailure(["math_version"], "Input should be a valid string", input.math_version);
  }
  if (!Array.isArray(input.changes)) schemaFailure(["changes"], "Input should be a valid list", input.changes);
  const changes = input.changes.map((value, index): Change => {
    if (!object(value)) schemaFailure(["changes", index], "Input should be a valid dictionary", value);
    for (const key of ["entity", "id", "mutation_id", "updated_at"] as const) {
      if (typeof value[key] !== "string") schemaFailure(["changes", index, key], "Input should be a valid string", value[key]);
    }
    if (!object(value.fields)) schemaFailure(["changes", index, "fields"], "Input should be a valid dictionary", value.fields);
    return {
      entity: value.entity as string,
      id: value.id as string,
      mutation_id: value.mutation_id as string,
      updated_at: value.updated_at as string,
      fields: value.fields,
    };
  });
  return {
    schema_version: coercedVersion,
    client_device_id: input.client_device_id,
    workout_id: input.workout_id as string | null | undefined,
    mutation_type: mutationType,
    last_updated_at: input.last_updated_at,
    math_version: input.math_version as string | null | undefined,
    changes,
  };
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (object(value)) return Object.keys(value).length > 0;
  return true;
}

export function validateInsightCardSyncConfigs(payload: Payload): void {
  for (const change of payload.changes) {
    if (change.entity !== "InsightCard" || pythonTruthy(change.fields.deleted)) continue;
    const config = change.fields.config;
    if (!pythonTruthy(config)) continue;
    // Reuse the same CardConfig parser as CRUD. Persist the original supplied
    // JSON below, because legacy sync stores fields.config rather than the
    // Pydantic model's default-expanded dump.
    let parsed: ReturnType<typeof parseSavedCardWrite>;
    try {
      parsed = parseSavedCardWrite({
        name: "Card",
        config,
        layout: { order: 0, col_span: 1 },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        change._schema_error = true;
        continue;
      }
      throw error;
    }
    if (validateCardCompatibility(parsed.config).length) change._compatibility_rejected = true;
  }
}

function rpcResult(value: unknown): RpcResult {
  if (typeof value === "string") {
    try { return JSON.parse(value) as RpcResult; } catch { /* throw below */ }
  }
  if (object(value)) return value as RpcResult;
  throw new Error("Insight card sync interface returned an invalid result");
}

async function callSyncRpc(db: Database, principal: Principal, payload: Payload): Promise<RpcResult> {
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_insight_cards_sync($1::text,$2::text,$3::text,$4::jsonb) as payload",
      [
        principal.user.id,
        principal.sessionId,
        payload.client_device_id,
        JSON.stringify(payload.changes),
      ],
    );
    if (!result.rows[0]) throw new Error("Insight card sync interface returned no result");
    return rpcResult(result.rows[0].payload);
  } finally {
    client.release();
  }
}

export async function handleInsightCardSync(
  request: Request,
  db: Database,
  principal: Principal,
): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  let input: unknown;
  try { input = await request.json(); } catch { schemaFailure([], "JSON decode error"); }
  const payload = parseInsightCardSyncPayload(input);
  if (payload.math_version && payload.math_version !== MATH_VERSION) {
    throw new ApiError(409, {
      error: {
        code: "MATH_VERSION_MISMATCH",
        message: "Client math version does not match the server. App update required.",
        details: { server: MATH_VERSION, client: payload.math_version },
      },
    });
  }
  validateInsightCardSyncConfigs(payload);
  let result: RpcResult;
  try {
    result = await callSyncRpc(db, principal, payload);
  } catch (error) {
    const pgError = error as {
      code?: string;
      message?: string;
      fields?: { code?: string; message?: string };
    };
    const pgCode = pgError?.code ?? pgError?.fields?.code;
    const pgMessage = pgError?.message ?? pgError?.fields?.message;
    if (pgCode === "P0001" && pgMessage?.includes("AL_SYNC_CARD_CONFIG_SCHEMA")) {
      const schemaIssue = payload.changes.find((change) => change._schema_error);
      if (schemaIssue) {
        const badConfig = schemaIssue.fields.config;
        parseSavedCardWrite({ name: "Card", config: badConfig, layout: { order: 0, col_span: 1 } });
      }
    }
    throw error;
  }
  if (result.denial === "invalid_session") throw invalidCredentials();
  if (result.denial === "device_revoked") {
    throw new ApiError(403, "Client device is revoked or belongs to another user");
  }
  if (result.denial) throw new ApiError(422, "Invalid request");
  return jsonResponse({
    accepted_mutation_ids: result.accepted_mutation_ids ?? [],
    rejected_mutation_ids: result.rejected_mutation_ids ?? [],
    canonical: result.canonical ?? [],
    math_version: MATH_VERSION,
  });
}

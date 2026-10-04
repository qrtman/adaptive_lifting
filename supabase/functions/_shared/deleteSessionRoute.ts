import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type DeleteRpcResult = { denial: string | null; result?: unknown };

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseResult(value: unknown): DeleteRpcResult {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Session deletion interface returned invalid JSON");
    }
  }
  if (!isObject(value)) throw new Error("Session deletion interface returned an invalid result");
  return value as DeleteRpcResult;
}

export async function handleDeleteSession(
  sessionId: string,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_session_delete($1::text,$2::text,$3::text,$4::boolean,$5::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        sessionId,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Session deletion interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    switch (payload.denial) {
      case "invalid_session":
        throw invalidCredentials();
      case "account_ineligible":
        throw new ApiError(403, {
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Verify your email before signing in.",
        });
      case "session_not_found":
        throw new ApiError(404, "Session not found");
      case "session_has_no_owner":
        throw new ApiError(400, "Session has no owner");
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
      case null:
        if (!isObject(payload.result) || payload.result.status !== "success") {
          throw new Error("Session deletion interface returned an invalid success result");
        }
        return jsonResponse({ status: "success" }, 200);
      default:
        throw new Error("Session deletion interface rejected the request");
    }
  } finally {
    client.release();
  }
}

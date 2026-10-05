import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type DeleteResult = { denial: string | null; status?: string; id?: string };

function parseResult(value: unknown): DeleteResult {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Exercise delete interface returned invalid JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Exercise delete interface returned an invalid result");
  }
  return value as DeleteResult;
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
    case "invalid_request": throw new ApiError(422, "Invalid request");
    default: throw new Error("Exercise delete interface rejected the request");
  }
}

export async function handleDeleteSessionExercise(
  request: Request,
  sessionId: string,
  exerciseId: string,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  if (request.method !== "DELETE") throw new ApiError(405, "Method not allowed");
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_session_delete_exercise($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::integer) as payload",
      [
        principal.user.id,
        principal.sessionId,
        sessionId,
        exerciseId,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    if (!result.rows[0]) throw new Error("Exercise delete interface returned no result");
    const payload = parseResult(result.rows[0].payload);
    if (typeof payload.denial === "string") raiseDenial(payload.denial);
    if (payload.status !== "success" || payload.id !== exerciseId) {
      throw new Error("Exercise delete interface returned an invalid success response");
    }
    return jsonResponse({ status: "success", id: exerciseId }, 200);
  } finally {
    client.release();
  }
}

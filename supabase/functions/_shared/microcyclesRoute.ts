import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import type { Principal } from "./types/mod.ts";

type ReadResult = {
  denial: string | null;
  microcycles?: unknown[];
};

function readResult(value: unknown): ReadResult {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Microcycle read interface returned invalid JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Microcycle read interface returned an invalid result");
  }
  return value as ReadResult;
}

async function readMicrocycles(
  db: Database,
  principal: Principal,
  config: AppConfig,
  athleteId: string | null,
): Promise<ReadResult> {
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(
      "select al_private.al_microcycles_read($1::text,$2::text,$3::text,$4::boolean) as payload",
      [
        principal.user.id,
        principal.sessionId,
        athleteId,
        config.enforceLegacyEmailVerification,
      ],
    );
    if (!result.rows[0]) throw new Error("Microcycle read interface returned no result");
    return readResult(result.rows[0].payload);
  } finally {
    client.release();
  }
}

export async function handleMicrocyclesRoute(
  _request: Request,
  db: Database,
  principal: Principal,
  config: AppConfig,
  athleteId: string | null,
): Promise<Response> {
  const result = await readMicrocycles(db, principal, config, athleteId);
  switch (result.denial) {
    case "invalid_session":
      throw invalidCredentials();
    case "account_ineligible":
      throw new ApiError(403, {
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email before signing in.",
      });
    case "athlete_forbidden":
      throw new ApiError(403, "Athletes can only access their own plan");
    case "coach_relationship_required":
      throw new ApiError(403, "Not linked to this athlete");
    case "unsupported_role":
      throw new ApiError(403, "Not authorized");
    case "invalid_request":
      throw new ApiError(422, "Invalid request");
    case null:
      return jsonResponse(Array.isArray(result.microcycles) ? result.microcycles : []);
    default:
      throw new Error("Microcycle read interface rejected the request");
  }
}

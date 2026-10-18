import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiError } from "./errors/mod.ts";
import { handleDeleteSession } from "./deleteSessionRoute.ts";
import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import type { Principal } from "./types/mod.ts";

const config: AppConfig = {
  databaseUrl: "",
  jwtCurrent: "",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: [],
};

const principal: Principal = {
  user: {
    id: "athlete-a",
    google_sub: null,
    email_verified_at: "2026-01-01T00:00:00Z",
    email_verification_required: false,
    email_verification_legacy_exempt: false,
    deleted_at: null,
  },
  sessionId: "session-a",
};

function fakeDatabase(payload: unknown, capture?: (query: string, params: unknown[]) => void): Database {
  return {
    async connect() {
      const client: SqlClient = {
        async queryObject<T>(query: string, params: unknown[] = []) {
          capture?.(query, params);
          return { rows: [{ payload } as T] };
        },
        release() {},
      };
      return client;
    },
  };
}

Deno.test("DELETE calls only the narrow RPC and returns the exact success payload", async () => {
  let query = "";
  let params: unknown[] = [];
  const response = await handleDeleteSession(
    "w-stage-1",
    fakeDatabase({ denial: null, result: { status: "success" } }, (sql, values) => {
      query = sql;
      params = values;
    }),
    principal,
    config,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "success" });
  assertEquals(
    query,
    "select al_private.al_session_delete($1::text,$2::text,$3::text,$4::boolean,$5::integer) as payload",
  );
  assertEquals(params, ["athlete-a", "session-a", "w-stage-1", false, 3]);
});

Deno.test("DELETE maps auth, ownership, entitlement, and missing-session denials", async () => {
  const cases: Array<[string, number, unknown]> = [
    ["invalid_session", 401, "Could not validate credentials"],
    ["account_ineligible", 403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." }],
    ["session_not_found", 404, "Session not found"],
    ["session_has_no_owner", 400, "Session has no owner"],
    ["athlete_forbidden", 403, "Athletes can only access their own plan"],
    ["coach_relationship_required", 403, "Not linked to this athlete"],
    ["workspace_access_required", 403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." }],
    ["feature_not_included", 403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." }],
  ];
  for (const [denial, status, detail] of cases) {
    try {
      await handleDeleteSession("w-stage-1", fakeDatabase({ denial }), principal, config);
      throw new Error(`Expected ${denial} rejection`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      assertEquals(error.status, status);
      assertEquals(error.detail, detail);
    }
  }
});

Deno.test("DELETE rejects malformed RPC success payloads rather than claiming a tombstone", async () => {
  try {
    await handleDeleteSession("w-stage-1", fakeDatabase({ denial: null }), principal, config);
    throw new Error("Expected invalid RPC result");
  } catch (error) {
    assertEquals(error instanceof Error, true);
    assertEquals((error as Error).message, "Session deletion interface returned an invalid success result");
  }
});

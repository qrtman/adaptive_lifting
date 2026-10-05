import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiError } from "./errors/mod.ts";
import { handleBulkSessionLabels } from "./bulkSessionLabelsRoute.ts";
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

function fakeDatabase(
  payload: unknown,
  capture?: (query: string, params: unknown[]) => void,
): Database {
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

function request(body: unknown): Request {
  return new Request("https://stage.example/api/sessions/labels", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function expectApiError(
  action: () => Promise<unknown>,
  status: number,
  detail?: unknown,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assertEquals(caught instanceof ApiError, true);
  const apiError = caught as ApiError;
  assertEquals(apiError.status, status);
  if (detail !== undefined) assertEquals(apiError.detail, detail);
}

Deno.test("bulk labels sends legacy fields unchanged and returns exact response shape", async () => {
  let query = "";
  let params: unknown[] = [];
  const response = await handleBulkSessionLabels(
    request({
      sessionIds: ["w-2", "missing", "w-2"],
      blockLabel: "  Block 1  ",
      weekLabel: "",
      clearBlock: false,
      clearWeek: true,
      athleteId: "forged-athlete",
      title: "ignored",
    }),
    fakeDatabase({
      denial: null,
      result: { status: "success", updated: ["w-2", "w-2"] },
    }, (sql, values) => { query = sql; params = values; }),
    principal,
    config,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "success", updated: ["w-2", "w-2"] });
  assertEquals(query, "select al_private.al_sessions_bulk_labels($1::text,$2::text,$3::text[],$4::text,$5::text,$6::boolean,$7::boolean,$8::boolean,$9::integer) as payload");
  assertEquals(params, [
    "athlete-a", "session-a", ["w-2", "missing", "w-2"], "  Block 1  ", "", false, true, false, 3,
  ]);
});

Deno.test("bulk labels rejects empty IDs before database access", async () => {
  await expectApiError(
    () => handleBulkSessionLabels(request({ sessionIds: [] }), fakeDatabase(null), principal, config),
    400,
    "sessionIds required",
  );
});

Deno.test("bulk labels validates payload types and malformed JSON", async () => {
  await expectApiError(
    () => handleBulkSessionLabels(request({ sessionIds: ["w-1"], clearBlock: "yes" }), fakeDatabase(null), principal, config),
    422,
  );
  await expectApiError(
    () => handleBulkSessionLabels(request("{"), fakeDatabase(null), principal, config),
    422,
  );
});

Deno.test("bulk labels maps session, relationship, entitlement, and tombstone denials", async () => {
  const cases: Array<[string, number, unknown]> = [
    ["invalid_session", 401, "Could not validate credentials"],
    ["account_ineligible", 403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." }],
    ["session_not_found", 404, "Session not found"],
    ["athlete_forbidden", 403, "Athletes can only access their own plan"],
    ["coach_relationship_required", 403, "Not linked to this athlete"],
    ["workspace_access_required", 403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." }],
    ["feature_not_included", 403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." }],
  ];
  for (const [denial, status, detail] of cases) {
    await expectApiError(
      () => handleBulkSessionLabels(
        request({ sessionIds: ["w-1"] }),
        fakeDatabase({ denial }),
        principal,
        config,
      ),
      status,
      detail,
    );
  }
});

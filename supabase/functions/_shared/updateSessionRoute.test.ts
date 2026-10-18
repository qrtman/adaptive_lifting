import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiError } from "./errors/mod.ts";
import { handleUpdateSession, parseSessionPatchInput } from "./updateSessionRoute.ts";
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

const savedSession = {
  id: "w-stage-1",
  date: "2026-10-05",
  dayLabel: "1",
  title: "Squat",
  status: "COMPLETED",
  blockLabel: null,
  weekLabel: "Week4",
  microcycleId: "mc-a",
  ownerId: "athlete-a",
};

Deno.test("PATCH parser preserves nullable optional strings and ignores unknown keys", () => {
  assertEquals(parseSessionPatchInput({ title: "  Raw  ", dayLabel: "", ownerId: "foreign" }), {
    date: null,
    title: "  Raw  ",
    dayLabel: "",
    blockLabel: null,
    weekLabel: null,
    status: null,
  });
  assertEquals(parseSessionPatchInput({ title: null }), {
    date: null, title: null, dayLabel: null, blockLabel: null, weekLabel: null, status: null,
  });
});

Deno.test("PATCH uses only the private RPC and returns its exact response payload", async () => {
  let query = "";
  let params: unknown[] = [];
  const response = await handleUpdateSession(
    new Request("https://stage.example/api/sessions/w-stage-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  Squat  ", blockLabel: "  Block2 ", weekLabel: "  ", color: "pink" }),
    }),
    "w-stage-1",
    fakeDatabase({ denial: null, session: savedSession }, (sql, values) => { query = sql; params = values; }),
    principal,
    config,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), savedSession);
  assertEquals(query, "select al_private.al_session_update($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::boolean,$11::integer) as payload");
  assertEquals(params, [
    "athlete-a", "session-a", "w-stage-1", null, "  Squat  ", null, "  Block2 ", "  ", null, false, 3,
  ]);
});

Deno.test("PATCH maps authorization, entitlement, tombstone, and validation denials compatibly", async () => {
  const cases: Array<[string, number, unknown]> = [
    ["session_not_found", 404, "Session not found"],
    ["session_has_no_owner", 400, "Session has no owner"],
    ["athlete_forbidden", 403, "Athletes can only access their own plan"],
    ["coach_relationship_required", 403, "Not linked to this athlete"],
    ["workspace_access_required", 403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." }],
    ["feature_not_included", 403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." }],
    ["invalid_date", 400, "date must be YYYY-MM-DD"],
    ["invalid_status", 400, "Invalid status"],
  ];
  for (const [denial, status, detail] of cases) {
    try {
      await handleUpdateSession(
        new Request("https://stage.example/api/sessions/w-stage-1", { method: "PATCH", body: "{}" }),
        "w-stage-1", fakeDatabase({ denial }), principal, config,
      );
      throw new Error(`Expected ${denial} rejection`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      assertEquals(error.status, status);
      assertEquals(error.detail, detail);
    }
  }
});

Deno.test("PATCH rejects malformed JSON and non-string fields as request validation errors", async () => {
  await assertRejects(
    () => handleUpdateSession(
      new Request("https://stage.example/api/sessions/w-stage-1", { method: "PATCH", body: "{" }),
      "w-stage-1", fakeDatabase({ denial: null, session: savedSession }), principal, config,
    ),
    ApiError,
  );
  await assertRejects(
    async () => { parseSessionPatchInput({ status: 3 }); },
    ApiError,
  );
});

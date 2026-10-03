import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleCreateSession, parseSessionCreateInput } from "./createSessionRoute.ts";
import { ApiError } from "./errors/mod.ts";
import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import type { Principal } from "./types/mod.ts";

const config: AppConfig = {
  databaseUrl: "",
  jwtCurrent: "",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["http://localhost:3000"],
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

Deno.test("session request parsing preserves model defaults and the athleteId field", () => {
  assertEquals(parseSessionCreateInput({ date: "2026-10-05" }), {
    date: "2026-10-05",
    title: "Session",
    dayLabel: null,
    blockLabel: null,
    weekLabel: null,
    athleteId: null,
    microcycleId: null,
  });
  assertEquals(parseSessionCreateInput({ date: "2026-10-05", athleteId: "foreign" }).athleteId, "foreign");
  assertEquals(parseSessionCreateInput({ date: "2026-10-05", title: null }).title, null);
});

Deno.test("session creation uses the narrow RPC and returns the exact legacy response", async () => {
  const session = {
    id: "w-0123456789",
    date: "2026-10-05",
    dayLabel: "1",
    title: "Squat",
    status: "PLANNED",
    blockLabel: "Block2",
    weekLabel: "Week3",
    microcycleId: "ungrouped-a1b2c3d4",
    ownerId: "athlete-a",
    exercises: [],
  };
  let query = "";
  let params: unknown[] = [];
  const response = await handleCreateSession(
    new Request("https://stage.example/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-10-05",
        title: "Squat",
        dayLabel: "1",
        blockLabel: " Block2 ",
        weekLabel: " Week3 ",
        athleteId: "foreign-ignored-by-athlete-role",
      }),
    }),
    fakeDatabase({ denial: null, session }, (sql, values) => {
      query = sql;
      params = values;
    }),
    principal,
    config,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), session);
  assertEquals(query, "select al_private.al_session_create($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::boolean,$11::integer) as payload");
  assertEquals(params, [
    "athlete-a", "session-a", "foreign-ignored-by-athlete-role", "2026-10-05",
    "Squat", "1", " Block2 ", " Week3 ", null, false, 3,
  ]);
});

Deno.test("session creation maps plan, entitlement, date, and tombstone denials compatibly", async () => {
  const cases = [
    ["coach_athlete_required", 400, "athlete_id is required for coaches"],
    ["coach_relationship_required", 403, "Not linked to this athlete"],
    ["workspace_access_required", 403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." }],
    ["feature_not_included", 403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." }],
    ["microcycle_not_found", 404, "Microcycle not found in athlete plan"],
    ["invalid_date", 400, "date must be YYYY-MM-DD"],
  ] as const;
  for (const [denial, status, detail] of cases) {
    const error = await assertRejects(
      () => handleCreateSession(
        new Request("https://stage.example/api/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date: "2026-10-05" }),
        }),
        fakeDatabase({ denial }),
        principal,
        config,
      ),
      ApiError,
    );
    assertEquals(error.status, status);
    assertEquals(error.detail, detail);
  }
});

Deno.test("session request parser rejects missing date and non-string labels", async () => {
  await assertRejects(() => Promise.resolve(parseSessionCreateInput({})), ApiError);
  await assertRejects(() => Promise.resolve(parseSessionCreateInput({ date: "2026-10-05", weekLabel: 3 })), ApiError);
});

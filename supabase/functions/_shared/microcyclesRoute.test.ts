import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleMicrocyclesRoute } from "./microcyclesRoute.ts";
import { ApiError } from "./errors/mod.ts";
import type { AppConfig } from "./config.ts";
import type { Database } from "./db/mod.ts";
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

function fakeDatabase(payload: unknown, onQuery?: (query: string, params: unknown[]) => void): Database {
  return {
    async connect() {
      return {
        async queryObject<T>(query: string, params: unknown[] = []) {
          onQuery?.(query, params);
          return { rows: [{ payload } as T] };
        },
        release() {},
      };
    },
  };
}

Deno.test("microcycles read calls only the narrow RPC and preserves the optional athlete filter", async () => {
  const tree = [{
    id: "mc-a",
    weekName: "Microcycle 01",
    focus: "Strength",
    status: "ACTIVE",
    active: true,
    workouts: [],
  }];
  let query = "";
  let params: unknown[] = [];
  const response = await handleMicrocyclesRoute(
    new Request("https://stage.example/functions/v1/api/microcycles?athlete_id=athlete-b"),
    fakeDatabase({ denial: null, microcycles: tree }, (sql, values) => {
      query = sql;
      params = values;
    }),
    principal,
    config,
    "athlete-b",
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), tree);
    assertEquals(query, "select al_private.al_microcycles_read_with_revisions($1::text,$2::text,$3::text,$4::boolean) as payload");
  assertEquals(params, ["athlete-a", "session-a", "athlete-b", false]);
});

Deno.test("empty coach plan projection remains an empty array", async () => {
  const response = await handleMicrocyclesRoute(
    new Request("https://stage.example/functions/v1/api/microcycles"),
    fakeDatabase({ denial: null, microcycles: [] }),
    principal,
    config,
    null,
  );
  assertEquals(await response.json(), []);
});

Deno.test("microcycles read preserves legacy athlete and coach authorization details", async () => {
  const cases = [
    ["athlete_forbidden", "Athletes can only access their own plan"],
    ["coach_relationship_required", "Not linked to this athlete"],
    ["unsupported_role", "Not authorized"],
  ] as const;
  for (const [denial, detail] of cases) {
    const error = await assertRejects(
      () => handleMicrocyclesRoute(
        new Request("https://stage.example/functions/v1/api/microcycles"),
        fakeDatabase({ denial }),
        principal,
        config,
        "athlete-b",
      ),
      ApiError,
    );
    assertEquals(error.status, 403);
    assertEquals(error.detail, detail);
  }
});

Deno.test("ineligible account denial keeps the existing email-verification envelope", async () => {
  const error = await assertRejects(
    () => handleMicrocyclesRoute(
      new Request("https://stage.example/functions/v1/api/microcycles"),
      fakeDatabase({ denial: "account_ineligible" }),
      principal,
      config,
      null,
    ),
    ApiError,
  );
  assertEquals(error.status, 403);
  assertEquals(error.detail, {
    code: "EMAIL_VERIFICATION_REQUIRED",
    message: "Verify your email before signing in.",
  });
});

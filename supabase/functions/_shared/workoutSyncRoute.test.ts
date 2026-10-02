import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleWorkoutSync, parseWorkoutSyncPayload } from "./workoutSyncRoute.ts";
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
  user: { id: "athlete-1", google_sub: null, email_verified_at: "2026-01-01", email_verification_required: false, email_verification_legacy_exempt: false, deleted_at: null },
  sessionId: "session-1",
};

function request(payload: unknown): Request {
  return new Request("https://stage.example/functions/v1/api/workouts/workout-1/sync", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    client_device_id: "device-1",
    workout_id: "workout-1",
    last_updated_at: "2026-10-03T00:00:00Z",
    changes: [],
    ...overrides,
  };
}

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

Deno.test("workout payload defaults mutation_type and permits omitted math version", () => {
  assertEquals(parseWorkoutSyncPayload(basePayload({ schema_version: "1" })).mutation_type, "workout");
});

Deno.test("workout endpoint returns 400 for URL/payload mismatch before database call", async () => {
  let called = false;
  const db = fakeDatabase({}, () => { called = true; });
  const error = await assertRejects(() => handleWorkoutSync(
    request(basePayload({ workout_id: "workout-2" })), "workout-1", config, db, principal,
  ), ApiError);
  assertEquals(error.status, 400);
  assertEquals(called, false);
});

Deno.test("workout protocol preserves wrong-type 400 and schema/math 409 envelopes", async () => {
  const db = fakeDatabase({});
  const wrongType = await assertRejects(() => handleWorkoutSync(request(basePayload({ mutation_type: "insight_card" })), "workout-1", config, db, principal), ApiError);
  assertEquals(wrongType.status, 400);
  const wrongSchema = await assertRejects(() => handleWorkoutSync(request(basePayload({ schema_version: 2 })), "workout-1", config, db, principal), ApiError);
  assertEquals(wrongSchema.status, 409);
  assertEquals((wrongSchema.detail as { error: { code: string } }).error.code, "CLIENT_SCHEMA_UNSUPPORTED");
  const wrongMath = await assertRejects(() => handleWorkoutSync(request(basePayload({ math_version: "wrong" })), "workout-1", config, db, principal), ApiError);
  assertEquals(wrongMath.status, 409);
  assertEquals((wrongMath.detail as { error: { code: string } }).error.code, "MATH_VERSION_MISMATCH");
});

Deno.test("workout RPC response preserves canonical workout-sync property names", async () => {
  let seenQuery = "";
  let seenParams: unknown[] = [];
  const db = fakeDatabase({
    denial: null,
    workout_id: "workout-1",
    canonical_last_updated_at: "2026-10-03T00:00:00Z",
    accepted_mutation_ids: ["mut-1"],
    rejected_mutations: ["mut-2"],
    conflicts: [{ mutation_id: "mut-2", reason: "FIELD_NOT_WRITABLE" }],
  }, (query, params) => { seenQuery = query; seenParams = params; });
  const response = await handleWorkoutSync(request(basePayload({ math_version: "linear-decay-v3" })), "workout-1", config, db, principal);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    workout_id: "workout-1",
    canonical_last_updated_at: "2026-10-03T00:00:00Z",
    accepted_mutation_ids: ["mut-1"],
    rejected_mutations: ["mut-2"],
    conflicts: [{ mutation_id: "mut-2", reason: "FIELD_NOT_WRITABLE" }],
    math_version: "linear-decay-v3",
  });
  assertEquals(seenQuery.includes("al_private.al_workout_sync"), true);
  assertEquals(seenParams.slice(0, 6), ["athlete-1", "session-1", "workout-1", "workout-1", "device-1", false]);
});

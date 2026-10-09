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

Deno.test("sync baselines reach the SQL RPC unchanged for every mutation", async () => {
  const changes = [
    { entity: "ExerciseSet", id: "set-1", mutation_id: "mut-1", updated_at: "2026-10-03T00:00:00Z", fields: { actual: null }, base_revision: 7, base_fields: { actual: 90, note: null } },
    { entity: "ExerciseSet", id: "set-2", mutation_id: "mut-2", updated_at: "2026-10-03T00:00:00Z", fields: { note: "new" }, base_revision: 19, base_fields: { note: null } },
  ];
  let seenParams: unknown[] = [];
  await handleWorkoutSync(request(basePayload({ changes })), "workout-1", config,
    fakeDatabase({ denial: null, workout_id: "workout-1", accepted_mutation_ids: ["mut-1", "mut-2"] }, (_query, params) => { seenParams = params; }), principal);
  assertEquals(seenParams[7], JSON.stringify(changes));
  assertEquals(JSON.parse(seenParams[7] as string), changes);
});

Deno.test("revision-less schema-v1 changes remain parseable without an invented baseline", () => {
  const parsed = parseWorkoutSyncPayload(basePayload({ changes: [
    { entity: "ExerciseSet", id: "set-1", mutation_id: "v1", updated_at: "2099-01-01T00:00:00Z", fields: { note: "offline" } },
  ] }));
  assertEquals(Object.hasOwn(parsed.changes[0], "base_revision"), false);
  assertEquals(Object.hasOwn(parsed.changes[0], "base_fields"), false);
});

Deno.test("malformed base revisions and base fields are rejected", async () => {
  for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3", true, null]) {
    const error = await assertRejects(() => handleWorkoutSync(
      request(basePayload({ changes: [{ entity: "ExerciseSet", id: "set-1", mutation_id: "bad", updated_at: "x", fields: {}, base_revision: revision }] })),
      "workout-1", config, fakeDatabase({}), principal,
    ), ApiError);
    assertEquals(error.status, 422);
  }
  const badFields = await assertRejects(() => handleWorkoutSync(
    request(basePayload({ changes: [{ entity: "ExerciseSet", id: "set-1", mutation_id: "bad-fields", updated_at: "x", fields: {}, base_fields: null }] })),
    "workout-1", config, fakeDatabase({}), principal,
  ), ApiError);
  assertEquals(badFields.status, 422);
  const maximum = parseWorkoutSyncPayload(basePayload({ changes: [
    { entity: "ExerciseSet", id: "set-1", mutation_id: "max", updated_at: "x", fields: {}, base_revision: Number.MAX_SAFE_INTEGER, base_fields: { note: null } },
  ] }));
  assertEquals(maximum.changes[0].base_revision, Number.MAX_SAFE_INTEGER);
});

Deno.test("unresolved revision conflicts use a non-success 409 envelope for legacy clients", async () => {
  const conflicts = [{
    mutation_id: "legacy-v1-1", entity_type: "ExerciseSet", entity_id: "set-1",
    reason: "BASELINE_REQUIRED", client_fields: { actual: 100 }, server_fields: { actual: 95 },
  }];
  const error = await assertRejects(() => handleWorkoutSync(
    request(basePayload()), "workout-1", config,
    fakeDatabase({ denial: "revision_conflict", conflicts, accepted_mutation_ids: [] }),
    principal,
  ), ApiError);
  assertEquals(error.status, 409);
  assertEquals((error.detail as { error: { code: string } }).error.code, "SYNC_CONFLICT_REVIEW");
  assertEquals((error.detail as { error: { details: { conflicts: unknown[] } } }).error.details.conflicts, conflicts);
});

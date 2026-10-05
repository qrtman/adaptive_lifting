import { describe, expect, it } from "vitest";
import { handleSetLog, parseSetLogInput } from "../../supabase/functions/_shared/setLogRoute.ts";
import type { AppConfig } from "../../supabase/functions/_shared/config.ts";
import type { Database, SqlClient } from "../../supabase/functions/_shared/db/mod.ts";
import type { Principal } from "../../supabase/functions/_shared/types/mod.ts";

const base = {
  workoutId: "w1",
  exerciseId: "e1",
  setId: "s1",
  weight: 100,
  reps: 5,
  rpe: 8,
};

const config: AppConfig = {
  databaseUrl: "postgres://unused",
  jwtCurrent: "unused",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["https://app.example"],
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

function database(payloads: unknown[]): Database & { calls: Array<{ query: string; params: unknown[] }> } {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  return {
    calls,
    async connect(): Promise<SqlClient> {
      return {
        async queryObject<T>(query: string, params: unknown[] = []) {
          calls.push({ query, params });
          return { rows: [{ payload: payloads.shift() } as T] };
        },
        release() {},
      };
    },
  };
}

describe("Set Log request parity", () => {
  it("coerces numeric strings, booleans, integer floats, and keeps zeros/negatives", () => {
    expect(parseSetLogInput({
      ...base,
      weight: "-12.5",
      reps: "0",
      rpe: 0,
      velocity: "0",
      readiness: false,
      hrv: -1.25,
    })).toEqual({
      workoutId: "w1", exerciseId: "e1", setId: "s1",
      weight: -12.5, reps: 0, rpe: 0,
      note: null, velocity: 0, readiness: 0, hrv: -1.25,
    });
    expect(parseSetLogInput({ ...base, reps: 5.0 }).reps).toBe(5);
  });

  it("preserves optional telemetry absence, null, and empty strings", () => {
    expect(parseSetLogInput(base)).toMatchObject({ note: null, velocity: null, readiness: null, hrv: null });
    expect(parseSetLogInput({ ...base, note: null, velocity: null, readiness: null, hrv: null }))
      .toMatchObject({ note: null, velocity: null, readiness: null, hrv: null });
    expect(parseSetLogInput({ ...base, note: "", velocity: 0, readiness: 0, hrv: 0 }))
      .toMatchObject({ note: "", velocity: 0, readiness: 0, hrv: 0 });
  });

  it("allows empty exerciseId through request parsing for strict RPC identity hardening", () => {
    expect(parseSetLogInput({ ...base, exerciseId: "" }).exerciseId).toBe("");
  });

  it.each([
    ["workoutId", undefined], ["exerciseId", undefined], ["setId", undefined],
    ["weight", undefined], ["reps", undefined], ["rpe", undefined],
  ])("requires %s", (key, value) => {
    const body = { ...base } as Record<string, unknown>;
    if (value === undefined) delete body[key]; else body[key] = value;
    expect(() => parseSetLogInput(body)).toThrow();
  });

  it.each([
    ["weight", null], ["reps", null], ["rpe", null],
    ["reps", 5.5], ["reps", "5.5"], ["weight", "not-a-number"],
    ["workoutId", null], ["exerciseId", null], ["setId", null],
    ["note", 4], ["velocity", "bad"], ["readiness", 1.5], ["hrv", "bad"],
  ])("rejects invalid %s value", (key, value) => {
    expect(() => parseSetLogInput({ ...base, [key]: value })).toThrow();
  });

  it("calls the narrow log RPC then returns the canonical visible Microcycles collection", async () => {
    const db = database([
      { denial: null, metrics: { tonnage: 500, delta: 25 } },
      { denial: null, microcycles: [{ id: "mc1", workouts: [{ id: "w1" }] }] },
    ]);
    const response = await handleSetLog(
      new Request("https://app.example/api/sets/log", { method: "POST", body: JSON.stringify({ ...base, note: "" }) }),
      db,
      principal,
      config,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "mc1", workouts: [{ id: "w1" }] }]);
    expect(db.calls[0].query).toContain("al_private.al_set_log");
    expect(db.calls[0].params).toEqual([
      "athlete-a", "session-a", "w1", "e1", "s1", 100, 5, 8,
      "", null, null, null, false,
    ]);
    expect(db.calls[1].query).toContain("al_private.al_microcycles_read");
    expect(db.calls[1].params).toEqual(["athlete-a", "session-a", null, false]);
  });

  it("maps hidden Set and Exercise identity failures to the stable 404", async () => {
    const db = database([{ denial: "target_set_not_found" }]);
    await expect(handleSetLog(
      new Request("https://app.example/api/sets/log", { method: "POST", body: JSON.stringify(base) }),
      db,
      principal,
      config,
    )).rejects.toMatchObject({ status: 404, detail: "Target set not found" });
  });
});

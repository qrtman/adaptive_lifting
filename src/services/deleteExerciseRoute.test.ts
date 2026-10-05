import { describe, expect, it } from "vitest";
import { handleDeleteSessionExercise } from "../../supabase/functions/_shared/deleteExerciseRoute";
import { ApiError } from "../../supabase/functions/_shared/errors/mod";

describe("Delete Exercise route contract", () => {
  const principal = { user: { id: "athlete" }, sessionId: "app-session" } as any;
  const config = { enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3 } as any;

  it("calls the narrow RPC and returns the exact success payload", async () => {
    let params: unknown[] = [];
    const db = { connect: async () => ({
      queryObject: async (_sql: string, values: unknown[]) => {
        params = values;
        return { rows: [{ payload: { denial: null, status: "success", id: "e-1" } }] };
      },
      release: () => undefined,
    }) } as any;
    const response = await handleDeleteSessionExercise(
      new Request("https://local/api/sessions/w-1/exercises/e-1", { method: "DELETE" }),
      "w-1", "e-1", db, principal, config,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success", id: "e-1" });
    expect(params).toEqual(["athlete", "app-session", "w-1", "e-1", false, 3]);
  });

  it("maps tombstones and missing exercises to the stable error envelopes", async () => {
    for (const [denial, status, detail] of [
      ["session_not_found", 404, "Session not found"],
      ["lift_not_found", 404, "Lift not found"],
    ] as const) {
      const db = { connect: async () => ({
        queryObject: async () => ({ rows: [{ payload: { denial } }] }),
        release: () => undefined,
      }) } as any;
      await expect(handleDeleteSessionExercise(
        new Request("https://local/api/sessions/w-1/exercises/e-1", { method: "DELETE" }),
        "w-1", "e-1", db, principal, config,
      )).rejects.toMatchObject({ status, detail });
    }
  });

  it("does not call the database for a wrong method", async () => {
    const db = { connect: async () => { throw new Error("must not connect"); } } as any;
    await expect(handleDeleteSessionExercise(
      new Request("https://local/api/sessions/w-1/exercises/e-1", { method: "POST" }),
      "w-1", "e-1", db, principal, config,
    )).rejects.toBeInstanceOf(ApiError);
  });
});

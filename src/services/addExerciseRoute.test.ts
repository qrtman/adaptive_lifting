import { describe, expect, it } from "vitest";
import { handleAddSessionExercise, parseAddExerciseInput } from "../../supabase/functions/_shared/addExerciseRoute";

describe("Add Exercise request validation", () => {
  it("requires a string title and accepts blank strings for route-level validation", () => {
    expect(() => parseAddExerciseInput({})).toThrowError();
    expect(() => parseAddExerciseInput({ title: null })).toThrowError();
    expect(parseAddExerciseInput({ title: "" }).title).toBe("");
    expect(parseAddExerciseInput({ title: "   " }).title).toBe("   ");
  });

  it("coerces planned float and integer fields while rejecting invalid values", () => {
    expect(parseAddExerciseInput({ title: "x", plannedWeight: 180, plannedReps: 5, plannedRpe: 8 }).plannedWeight).toBe(180);
    expect(parseAddExerciseInput({ title: "x", plannedWeight: "182.5", plannedReps: "5", plannedRpe: "8.5" })).toMatchObject({
      plannedWeight: 182.5, plannedReps: 5, plannedRpe: 8.5,
    });
    expect(() => parseAddExerciseInput({ title: "x", plannedWeight: "heavy" })).toThrowError();
    expect(() => parseAddExerciseInput({ title: "x", plannedReps: "5.5" })).toThrowError();
    expect(() => parseAddExerciseInput({ title: "x", plannedReps: 5.5 })).toThrowError();
    expect(parseAddExerciseInput({ title: "x", plannedWeight: null, plannedReps: null, plannedRpe: null })).toMatchObject({
      plannedWeight: null, plannedReps: null, plannedRpe: null,
    });
  });

  it("returns exactly the narrow RPC exercise projection", async () => {
    const exercise = {
      id: "e-1", title: "Squat", variation: "Squat", tier: "Comp", liftCategory: "Squat",
      movementPattern: "Knee Dominant", liftNote: null, tags: ["Squat"], top: "—", vol: "—",
      sets: [{ id: "s-1", label: "Set 1", scope: "both", plannedWeight: 180, plannedReps: 5,
        plannedRpe: 8, actual: null, reps: null, executedRpe: null, velocity: null, readiness: null,
        hrv: null, isAuto: false, isTop: true, intensityType: "RPE", dropPercent: 0 }],
    };
    const calls: unknown[][] = [];
    const db = { connect: async () => ({
      queryObject: async (_sql: string, params: unknown[]) => {
        calls.push(params);
        return { rows: [{ payload: { denial: null, exercise } }] };
      },
      release: () => undefined,
    }) } as any;
    const principal = { user: { id: "athlete" }, sessionId: "session" } as any;
    const config = { enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3 } as any;
    const response = await handleAddSessionExercise(
      new Request("https://local/api/sessions/w-1/exercises", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: " Squat ", plannedWeight: "180", plannedReps: "5", plannedRpe: 8 }),
      }),
      "w-1", db, principal, config,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(exercise);
    expect(calls[0]).toEqual(["athlete", "session", "w-1", " Squat ", null, null, null, null, null, 180, 5, 8, false, 3]);
  });
});

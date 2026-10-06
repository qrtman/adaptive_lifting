import { describe, expect, it } from "vitest";
import { makeBatches, rowsFor, sheetText } from "../../supabase/functions/_shared/sheetsExport.ts";
import { calculateE1RM, calculateINOL } from "../../supabase/functions/_shared/analytics.ts";

const liveTree = [{
  id: "mc-a",
  workouts: [{
    id: "workout-a",
    date: "2026-10-01",
    dayLabel: "Day 2",
    title: "=IMPORTXML(\"https://bad.example\")",
    tonnage: 300,
    exercises: [{
      id: "exercise-a",
      liftCategory: "Squat",
      tier: "Comp",
      title: "=IMPORTXML(\"https://bad.example\")",
      sets: [{ plannedWeight: 0, actual: 100, reps: 3, executedRpe: 8, isTop: true }],
    }],
  }],
}];

describe("Google Sheets export builder", () => {
  it("exports only live canonical rows and preserves legacy numeric formatting", () => {
    const { workouts, sets } = rowsFor(liveTree);
    const tabs = makeBatches(["Sets", "Workouts", "INOL", "ACWR", "e1RM"], workouts, sets) as Array<{ range: string; values: unknown[][] }>;
    const setRows = tabs.find((batch) => batch.range === "Sets!A1")!.values;
    const e1rm = calculateE1RM(100, 3, 8);
    const inol = calculateINOL(3, 100 / e1rm * 100);
    expect(setRows[1]).toEqual([
      "2026-10-01", "Squat", "Comp", "'=IMPORTXML(\"https://bad.example\")",
      "—", 100, 3, 8, e1rm || "—", inol || "—", 300,
    ]);
    const workoutRows = tabs.find((batch) => batch.range === "Workouts!A1")!.values;
    expect(workoutRows[1]?.slice(0, 3)).toEqual([
      "2026-10-01", "Day 2", "'=IMPORTXML(\"https://bad.example\")",
    ]);
    expect(tabs.map((batch) => batch.range)).toEqual([
      "Sets!A1", "Workouts!A1", "INOL!A1", "ACWR!A1", "e1RM!A1",
    ]);
  });

  it("excludes tombstoned workouts, exercises, and sets", () => {
    const { workouts, sets } = rowsFor([{
      workouts: [
        { id: "deleted-workout", deletedAt: "now", exercises: [] },
        { id: "live-workout", date: "2026-10-02", exercises: [
          { id: "deleted-exercise", deletedAt: "now", sets: [{ id: "hidden" }] },
          { id: "live-exercise", sets: [
            { id: "deleted-set", deleted_at: "now" },
            { id: "live-set", actual: 50, reps: 2 },
          ] },
        ] },
      ],
    }]);
    expect(workouts.map((workout) => workout.id)).toEqual(["live-workout"]);
    expect(sets.map(({ set }) => set.id)).toEqual(["live-set"]);
  });

  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1)", "  =1+1"])(
    "prefixes formula-like text %s",
    (value) => expect(sheetText(value)).toBe(`'${value}`),
  );

  it("preserves stable arbitrary tab names while rejecting unsafe or empty selections", () => {
    const { workouts, sets } = rowsFor(liveTree);
    expect(makeBatches(["Custom Report"], workouts, sets)).toEqual([]);
    expect(() => makeBatches([], workouts, sets)).toThrow("Invalid export tab selection");
    expect(() => makeBatches(["Bad/Title"], workouts, sets)).toThrow("Invalid export tab selection");
    expect(() => makeBatches("Sets", workouts, sets)).toThrow("Invalid export tab selection");
  });
});

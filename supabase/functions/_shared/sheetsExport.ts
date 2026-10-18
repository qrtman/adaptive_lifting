import { calculateE1RM, calculateINOL } from "./analytics.ts";

type Json = Record<string, any>;

export function finite(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** Prefix text cells that Google Sheets would otherwise parse as formulas. */
export function sheetText(value: unknown): string {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function rowsFor(tree: unknown): { workouts: Json[]; sets: Json[] } {
  const cycles = Array.isArray(tree) ? tree as Json[] : [];
  const workouts = cycles.flatMap((cycle) => Array.isArray(cycle.workouts) ? cycle.workouts : [])
    .filter((workout: Json) => !workout.deletedAt && !workout.deleted_at)
    .sort((left: Json, right: Json) => String(left.date).localeCompare(String(right.date)));
  const sets: Json[] = [];
  for (const workout of workouts) {
    for (const exercise of (Array.isArray(workout.exercises) ? workout.exercises : [])) {
      if (exercise.deletedAt || exercise.deleted_at) continue;
      for (const set of (Array.isArray(exercise.sets) ? exercise.sets : [])) {
        if (!set.deletedAt && !set.deleted_at) sets.push({ workout, exercise, set });
      }
    }
  }
  return { workouts, sets };
}

export function makeBatches(tabs: unknown, workouts: Json[], sets: Json[]): unknown[] {
  // The stable API accepts caller-named tabs; only the known tabs receive
  // populated datasets. Empty, non-string, invalid-title, and duplicate names
  // are hardened here to prevent the Sheets API from failing after creation.
  if (!Array.isArray(tabs) || tabs.length === 0 || tabs.some((tab) =>
    typeof tab !== "string" || !tab.trim() || tab.length > 100 || /[\[\]*?:/\\]/.test(tab)
  )) {
    throw new Error("Invalid export tab selection");
  }
  const batches: unknown[] = [];
  if (tabs.includes("Sets")) {
    const values: unknown[][] = [["Date", "Category", "Tier", "Exercise", "Planned Weight", "Actual Weight", "Reps", "RPE", "e1RM", "INOL", "Tonnage"]];
    for (const { workout, exercise, set } of sets) {
      const weight = finite(set.actual);
      const reps = finite(set.reps);
      const rpe = finite(set.executedRpe);
      const e1rm = weight > 0 && reps > 0 ? calculateE1RM(weight, reps, rpe) : 0;
      const intensity = e1rm > 0 ? weight / e1rm * 100 : 0;
      const inol = intensity > 0 ? calculateINOL(reps, intensity) : 0;
      const tonnage = weight * reps;
      const planned = finite(set.plannedWeight ?? set.planned_weight);
      values.push([
        workout.date,
        sheetText(exercise.liftCategory ?? exercise.lift_category),
        sheetText(exercise.tier),
        sheetText(exercise.title),
        planned || "—",
        weight || "—",
        reps || "—",
        rpe || "—",
        e1rm || "—",
        inol || "—",
        tonnage || "—",
      ]);
    }
    batches.push({ range: "Sets!A1", values });
  }
  if (tabs.includes("Workouts")) {
    batches.push({
      range: "Workouts!A1",
      values: [["Date", "Day", "Title", "Tonnage", "Bodyweight", "Status"], ...workouts.map((workout) => [
        workout.date,
        sheetText(workout.dayLabel),
        sheetText(workout.title),
        workout.tonnage,
        workout.athleteBw ?? workout.athlete_bw ?? "—",
        sheetText(workout.status),
      ])],
    });
  }
  if (tabs.includes("INOL")) {
    const groups = new Map<string, Json[]>();
    for (const workout of workouts) {
      const id = String(workout.microcycleId ?? workout.microcycle_id ?? "");
      groups.set(id, [...(groups.get(id) ?? []), workout]);
    }
    const values: unknown[][] = [["Lift Category", "Microcycle ID", "Weekly Accumulated INOL"]];
    for (const [id, group] of groups) {
      const sums: Record<string, number> = { Squat: 0, Bench: 0, Deadlift: 0 };
      for (const { workout, exercise, set } of sets) {
        const category = String(exercise.liftCategory ?? exercise.lift_category);
        if (!group.includes(workout) || !Object.hasOwn(sums, category)) continue;
        const weight = finite(set.actual);
        const reps = finite(set.reps);
        const rpe = finite(set.executedRpe);
        const e1rm = weight > 0 && reps > 0 ? calculateE1RM(weight, reps, rpe) : 0;
        sums[category] += e1rm > 0 ? calculateINOL(reps, weight / e1rm * 100) : 0;
      }
      for (const [category, value] of Object.entries(sums)) values.push([category, id, Number(value.toFixed(2))]);
    }
    batches.push({ range: "INOL!A1", values });
  }
  if (tabs.includes("ACWR")) {
    const loads = workouts.map((workout) => ({
      date: workout.date,
      title: sheetText(workout.title),
      reps: sets.filter((row) => row.workout === workout).reduce((sum, row) => sum + finite(row.set.reps), 0),
    }));
    const values: unknown[][] = [["Date", "Workout Title", "Acute Load (reps)", "Chronic Load (reps)", "ACWR", "Status"]];
    loads.forEach((row, index) => {
      const acute = loads.slice(Math.max(0, index - 6), index + 1).reduce((sum, current) => sum + current.reps, 0);
      const chronic = Math.max(loads.slice(Math.max(0, index - 27), index + 1).reduce((sum, current) => sum + current.reps, 0) / 4, 1);
      const ratio = Number((acute / chronic).toFixed(2));
      values.push([row.date, row.title, acute, Number(chronic.toFixed(2)), ratio, ratio >= 0.8 && ratio <= 1.3 ? "Optimal" : ratio > 1.5 ? "Danger (High)" : "Under-training"]);
    });
    batches.push({ range: "ACWR!A1", values });
  }
  if (tabs.includes("e1RM")) {
    const values: unknown[][] = [["Date", "Exercise", "Top Set Logged", "Calculated e1RM"]];
    for (const { workout, exercise, set } of sets) {
      if (!set.isTop) continue;
      const weight = finite(set.actual);
      const reps = finite(set.reps);
      const rpe = finite(set.executedRpe);
      const e1rm = weight > 0 && reps > 0 ? calculateE1RM(weight, reps, rpe) : 0;
      if (e1rm > 0) values.push([workout.date, sheetText(exercise.title), `${weight}kg x ${reps} @ ${rpe}`, e1rm]);
    }
    batches.push({ range: "e1RM!A1", values });
  }
  return batches;
}

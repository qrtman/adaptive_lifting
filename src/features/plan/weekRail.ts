import type { MicrocycleData, SetData, WorkoutData } from '../../types';
import { trainingInt, trainingNumber } from '../../services/numericTraining';
import { ISO_DATE, formatPlanLabel, labelNumber } from './sessionLabels';

/**
 * Week rail model (session sheet phase 1, `.cursor/rules/session-sheet.mdc`).
 *
 * A session belongs to the week given by its own Block + Week labels. An unlabeled
 * session whose date falls inside a labeled week's date span (first to last session
 * of that week) is shown in that week as `inferred` — display only, labels are never
 * written here. Two spans: the week whose sessions are nearest wins. No span: the
 * active session has no week (`unassigned`).
 */

export type RailSession = { workout: WorkoutData; microId: string; inferred: boolean };

export type WeekRailModel =
  | {
      kind: 'week';
      /** Raw labels as stored on the week's sessions, for "Assign to Week N". */
      blockLabel: string | null;
      weekLabel: string;
      sessions: RailSession[];
    }
  | { kind: 'unassigned' };

type Entry = { workout: WorkoutData; microId: string; day: number };

const norm = (kind: 'Block' | 'Week', raw: string | null | undefined) => formatPlanLabel(kind, raw)?.toLowerCase() ?? '';
const weekKey = (workout: WorkoutData) => {
  const week = norm('Week', workout.weekLabel);
  return week ? `${norm('Block', workout.blockLabel)}|${week}` : null;
};
const dayIndex = (iso: string) => {
  if (!ISO_DATE.test(iso)) return Number.NaN;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

function compareSessions(a: Entry, b: Entry): number {
  if (a.day !== b.day) return a.day - b.day;
  const da = labelNumber('Day', a.workout.dayLabel) ?? Number.MAX_SAFE_INTEGER;
  const db = labelNumber('Day', b.workout.dayLabel) ?? Number.MAX_SAFE_INTEGER;
  return da - db;
}

export function buildWeekRail(microcycles: readonly MicrocycleData[], activeWorkoutId: string | null | undefined): WeekRailModel | null {
  const entries: Entry[] = microcycles.flatMap((micro) =>
    micro.workouts.map((workout) => ({ workout, microId: micro.id, day: dayIndex(workout.date) })));
  const active = entries.find((entry) => entry.workout.id === activeWorkoutId);
  if (!active) return null;

  const weeks = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = weekKey(entry.workout);
    if (!key) continue;
    weeks.set(key, [...(weeks.get(key) ?? []), entry]);
  }

  const homeOf = (entry: Entry): string | null => {
    const own = weekKey(entry.workout);
    if (own) return own;
    if (Number.isNaN(entry.day)) return null;
    let best: { key: string; distance: number } | null = null;
    for (const [key, members] of weeks) {
      const days = members.map((m) => m.day).filter((d) => !Number.isNaN(d));
      if (!days.length) continue;
      if (entry.day < Math.min(...days) || entry.day > Math.max(...days)) continue;
      const distance = Math.min(...days.map((d) => Math.abs(d - entry.day)));
      if (!best || distance < best.distance) best = { key, distance };
    }
    return best?.key ?? null;
  };

  const home = homeOf(active);
  if (!home) return { kind: 'unassigned' };
  const labeled = weeks.get(home)![0].workout;
  const sessions = entries
    .filter((entry) => homeOf(entry) === home)
    .sort(compareSessions)
    .map((entry) => ({ workout: entry.workout, microId: entry.microId, inferred: !weekKey(entry.workout) }));
  return { kind: 'week', blockLabel: labeled.blockLabel?.trim() || null, weekLabel: labeled.weekLabel!.trim(), sessions };
}

/** Plan rows only (log-only extras are not part of the prescription). */
const planSets = (sets: readonly SetData[]) => sets.filter((set) => set.scope !== 'log');

/**
 * Compact prescription for the rail: consecutive plan sets with the same reps and
 * intensity read as one piece, e.g. `1×3 @8 · 3×5 @7`, `4×6 @80%`, `3 sets`.
 * kg is left out on purpose — the rail shows the shape of the day, not loads.
 */
export function liftScheme(sets: readonly SetData[]): string {
  const pieces: { count: number; reps: number | null; intensity: string }[] = [];
  for (const set of planSets(sets)) {
    const reps = trainingInt(set.plannedReps);
    const value = trainingNumber(set.plannedRpe);
    const intensity = value == null ? '' : set.intensity_type === 'PERCENT' ? `@${value}%` : `@${value}`;
    const last = pieces.at(-1);
    if (last && last.reps === reps && last.intensity === intensity) last.count += 1;
    else pieces.push({ count: 1, reps, intensity });
  }
  return pieces
    .map(({ count, reps, intensity }) => {
      const shape = reps == null ? `${count} ${count === 1 ? 'set' : 'sets'}` : `${count}×${reps}`;
      return intensity ? `${shape} ${intensity}` : shape;
    })
    .join(' · ');
}

/** Planned set count of a session; a session with only logs counts its logs. */
export function sessionSetCount(workout: Pick<WorkoutData, 'exercises'>): number {
  let plan = 0;
  let logged = 0;
  for (const exercise of workout.exercises) {
    plan += planSets(exercise.sets).length;
    logged += exercise.sets.filter((set) => set.scope === 'log').length;
  }
  return plan > 0 ? plan : logged;
}

export const setCountLabel = (count: number) => `${count} ${count === 1 ? 'set' : 'sets'}`;

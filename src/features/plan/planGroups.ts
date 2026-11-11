import { trainingInt, trainingNumber } from '../../services/numericTraining';

/**
 * Grouped Plan rows (session sheet phase 3, `.cursor/rules/session-sheet.mdc`).
 *
 * Display layer only: every set stays its own record. Consecutive plan rows merge into one
 * group when kg, reps, intensity (type + value) and drop % are all equal — different kg is
 * never merged. Rows pair the Nth plan record with the Nth log record, so any edit here
 * must keep the other rows' plan↔log pairs; `resizePlanGroup` refuses when it would not.
 */

type SetRecord = Record<string, any>;
export type PlanLane = { set: SetRecord; index: number };
export type PlanGroup = {
  /** First set id of the merged group; stable key for expand state. */
  key: string;
  /** Lane (row) numbers covered, inclusive, 0-based. */
  start: number;
  end: number;
  lanes: PlanLane[];
  /** This single row is one set of an expanded group. */
  expandedFrom?: string;
};

const rx = (set: SetRecord) => ({
  kg: trainingNumber(set.plannedWeight),
  reps: trainingInt(set.plannedReps),
  type: set.intensity_type === 'PERCENT' ? 'PERCENT' : 'RPE',
  value: trainingNumber(set.target_value ?? set.plannedRpe),
  drop: trainingInt(set.dropPercent) ?? 0,
});

export function samePrescription(a: SetRecord, b: SetRecord): boolean {
  const x = rx(a);
  const y = rx(b);
  return x.kg === y.kg && x.reps === y.reps && x.type === y.type && x.value === y.value && x.drop === y.drop;
}

export function groupPlanRows(planRows: readonly PlanLane[], expanded: ReadonlySet<string> = new Set()): PlanGroup[] {
  const groups: PlanGroup[] = [];
  planRows.forEach((lane, row) => {
    const last = groups.at(-1);
    if (last && samePrescription(last.lanes[0].set, lane.set)) {
      last.lanes.push(lane);
      last.end = row;
    } else {
      groups.push({ key: String(lane.set.id ?? `row-${row}`), start: row, end: row, lanes: [lane] });
    }
  });
  return groups.flatMap((group) => (group.lanes.length > 1 && expanded.has(group.key)
    ? group.lanes.map((lane, i) => ({
        key: String(lane.set.id ?? `row-${group.start + i}`),
        start: group.start + i,
        end: group.start + i,
        lanes: [lane],
        expandedFrom: group.key,
      }))
    : [group]));
}

const hasLog = (set: SetRecord) => [set.actual, set.reps, set.executedRpe].some((v) => v !== null && v !== undefined && v !== '');

/** Row pairs as the grid shows them: [plan record id | null, log record id | null] per lane. */
export function lanePairs(sets: readonly SetRecord[]): Array<[string | null, string | null]> {
  const plans = sets.filter((s) => s.scope !== 'log').map((s) => String(s.id));
  const logs = sets.filter((s) => s.scope !== 'plan').map((s) => String(s.id));
  return Array.from({ length: Math.max(plans.length, logs.length) }, (_, i) => [plans[i] ?? null, logs[i] ?? null]);
}

export type ResizeResult = { ok: true; sets: SetRecord[] } | { ok: false; reason: string };

/**
 * Change how many sets a group has.
 * - More: copies of the group's last set (Plan only, empty Log) go right after it.
 * - Fewer: trailing sets leave the Plan. A set that already has a log keeps it as a log-only
 *   row at the end of the lift ("done beyond plan"); a log is never deleted.
 * Refuses when other rows' plan↔log pairs would shift (lifts mixing separate plan/log rows).
 */
export function resizePlanGroup(sets: readonly SetRecord[], group: PlanGroup, count: number, makeId: () => string): ResizeResult {
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: 'Enter a whole number of sets, 1 or more.' };
  return resize(sets, group, count, makeId);
}

/** Remove the whole group from the Plan (logged sets keep their logs, as when shrinking). */
export function removePlanGroup(sets: readonly SetRecord[], group: PlanGroup): ResizeResult {
  return resize(sets, group, 0, () => '');
}

function resize(sets: readonly SetRecord[], group: PlanGroup, count: number, makeId: () => string): ResizeResult {
  const size = group.lanes.length;
  if (count === size) return { ok: true, sets: [...sets] };

  let next: SetRecord[];
  const groupIds = new Set(group.lanes.map((lane) => String(lane.set.id)));
  if (count > size) {
    const last = group.lanes[size - 1];
    const clones = Array.from({ length: count - size }, () => ({
      ...last.set,
      id: makeId(),
      scope: last.set.scope === 'plan' ? 'plan' : 'both',
      isTop: false,
      isAuto: false,
      actual: null,
      reps: null,
      executedRpe: null,
    }));
    clones.forEach((clone) => groupIds.add(String(clone.id)));
    next = [...sets];
    next.splice(last.index + 1, 0, ...clones);
  } else {
    const removed = new Set(group.lanes.slice(count).map((lane) => lane.index));
    const keptLogs: SetRecord[] = [];
    next = sets.flatMap((set, i) => {
      if (!removed.has(i)) return [set];
      if (set.scope !== 'plan' && hasLog(set)) {
        keptLogs.push({ ...set, scope: 'log', plannedWeight: null, plannedReps: null, plannedRpe: null, target_value: null, dropPercent: 0, isTop: false });
      }
      return [];
    });
    next = [...next, ...keptLogs];
  }

  // Every row outside the group must keep its plan↔log pair.
  const pairOf = (pairs: Array<[string | null, string | null]>) => new Map(pairs.filter(([p]) => p).map(([p, l]) => [p!, l]));
  const before = pairOf(lanePairs(sets));
  const after = pairOf(lanePairs(next));
  for (const [planId, logId] of before) {
    if (groupIds.has(planId) || !after.has(planId)) continue;
    if (after.get(planId) !== logId) {
      return { ok: false, reason: 'This lift mixes separate Plan and Log rows; change its sets in Both view.' };
    }
  }
  return { ok: true, sets: next };
}

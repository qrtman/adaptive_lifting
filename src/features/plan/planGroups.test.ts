import { describe, expect, it } from 'vitest';
import { groupPlanRows, lanePairs, removePlanGroup, resizePlanGroup, type PlanLane } from './planGroups';

let n = 0;
const set = (kg: number | null, reps: number | null, rpe: number | null, extra: Record<string, unknown> = {}) =>
  ({ id: `s${++n}`, scope: 'both', plannedWeight: kg, plannedReps: reps, plannedRpe: rpe, target_value: rpe, intensity_type: 'RPE', dropPercent: 0, actual: null, reps: null, executedRpe: null, ...extra });
const lanes = (sets: any[]): PlanLane[] => sets.map((s, index) => ({ set: s, index })).filter(({ set: s }) => s.scope !== 'log');
const ids = { next: 0 };
const makeId = () => `new${++ids.next}`;

describe('groupPlanRows', () => {
  it('merges consecutive rows with the same kg, reps, intensity and drop %', () => {
    const sets = [set(150, 3, 8), set(130, 5, 7), set(130, 5, 7), set(130, 5, 7), set(90, 6, 8)];
    const groups = groupPlanRows(lanes(sets));
    expect(groups.map((g) => [g.start, g.end])).toEqual([[0, 0], [1, 3], [4, 4]]);
  });

  it('never merges different kg, intensity type, or drop %; only neighbours merge', () => {
    const sets = [
      set(60, 12, null), set(55, 12, null),
      set(100, 5, 80, { intensity_type: 'PERCENT' }), set(100, 5, 80),
      set(90, 6, 8), set(90, 6, 8, { dropPercent: -5 }),
      set(70, 10, null), set(80, 10, null), set(70, 10, null),
    ];
    expect(groupPlanRows(lanes(sets)).every((g) => g.lanes.length === 1)).toBe(true);
  });

  it('keeps a set with a note as its own row (phase 6)', () => {
    const sets = [set(130, 5, 7), set(130, 5, 7, { note: 'belt' }), set(130, 5, 7), set(130, 5, 7), set(130, 5, 7, { note: '  ' })];
    expect(groupPlanRows(lanes(sets)).map((g) => [g.start, g.end])).toEqual([[0, 0], [1, 1], [2, 4]]);
  });

  it('splits an expanded group into single rows', () => {
    const sets = [set(130, 5, 7), set(130, 5, 7), set(130, 5, 7)];
    const [group] = groupPlanRows(lanes(sets));
    const split = groupPlanRows(lanes(sets), new Set([group.key]));
    expect(split.map((g) => [g.start, g.expandedFrom])).toEqual([[0, group.key], [1, group.key], [2, group.key]]);
  });
});

describe('resizePlanGroup', () => {
  it('adds copies of the last set right after the group, with an empty Log', () => {
    const sets = [set(150, 3, 8), set(130, 5, 7), set(130, 5, 7), set(90, 6, 8)];
    const group = groupPlanRows(lanes(sets))[1];
    const res = resizePlanGroup(sets, group, 4, makeId);
    expect(res.ok).toBe(true);
    const next = (res as { sets: any[] }).sets;
    expect(next.map((s) => [s.plannedWeight, s.plannedReps])).toEqual([[150, 3], [130, 5], [130, 5], [130, 5], [130, 5], [90, 6]]);
    expect(next[3]).toMatchObject({ scope: 'both', actual: null, reps: null, executedRpe: null });
    expect(groupPlanRows(lanes(next))[1].lanes).toHaveLength(4);
  });

  it('removes trailing sets; a set with a log keeps it as a log-only row at the end', () => {
    const logged = set(130, 5, 7, { actual: 130, reps: 5, executedRpe: 7.5 });
    const sets = [set(130, 5, 7), set(130, 5, 7), logged, set(90, 6, 8)];
    const group = groupPlanRows(lanes(sets))[0];
    const res = resizePlanGroup(sets, group, 1, makeId);
    expect(res.ok).toBe(true);
    const next = (res as { sets: any[] }).sets;
    expect(next.map((s) => [s.scope, s.plannedWeight, s.actual ?? null])).toEqual([
      ['both', 130, null], ['both', 90, null], ['log', null, 130],
    ]);
    // The log-only row sits past the plan rows: it pairs with no plan.
    expect(lanePairs(next).at(-1)![0]).toBeNull();
  });

  it('refuses when other rows would change their plan↔log pair', () => {
    const plan1 = set(130, 5, 7, { scope: 'plan' });
    const plan2 = set(130, 5, 7, { scope: 'plan' });
    const plan3 = set(90, 6, 8, { scope: 'plan' });
    const log1 = set(null, null, null, { scope: 'log', actual: 130, reps: 5 });
    const log2 = set(null, null, null, { scope: 'log', actual: 130, reps: 5 });
    const log3 = set(null, null, null, { scope: 'log', actual: 90, reps: 6 });
    const sets = [plan1, plan2, plan3, log1, log2, log3];
    const group = groupPlanRows(lanes(sets))[0];
    const res = resizePlanGroup(sets, group, 3, makeId);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('Both view') });
  });

  it('removes a whole group; logged sets keep their logs at the end', () => {
    const sets = [set(150, 3, 8), set(130, 5, 7, { actual: 130, reps: 5 }), set(130, 5, 7), set(90, 6, 8)];
    const res = removePlanGroup(sets, groupPlanRows(lanes(sets))[1]);
    expect((res as { sets: any[] }).sets.map((s) => [s.scope, s.plannedWeight ?? null, s.actual ?? null])).toEqual([
      ['both', 150, null], ['both', 90, null], ['log', null, 130],
    ]);
  });

  it('rejects counts below 1 and keeps the same count as a no-op', () => {
    const sets = [set(130, 5, 7), set(130, 5, 7)];
    const group = groupPlanRows(lanes(sets))[0];
    expect(resizePlanGroup(sets, group, 0, makeId).ok).toBe(false);
    expect(resizePlanGroup(sets, group, 2.5, makeId).ok).toBe(false);
    expect(resizePlanGroup(sets, group, 2, makeId)).toEqual({ ok: true, sets });
  });
});

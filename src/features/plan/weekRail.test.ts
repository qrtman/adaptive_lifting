import { describe, expect, it } from 'vitest';
import type { MicrocycleData, SetData, WorkoutData } from '../../types';
import { buildWeekRail, liftScheme, sessionSetCount, setCountLabel } from './weekRail';

let n = 0;
const workout = (date: string, labels: { week?: string; block?: string; day?: string } = {}): WorkoutData => ({
  id: `w${++n}`, date, dayLabel: labels.day ?? date, title: 'Session',
  weekLabel: labels.week ?? null, blockLabel: labels.block ?? null,
  tonnage: 0, delta: 0, color: 'gray', exercises: [], status: 'PLANNED' as WorkoutData['status'],
});
const micro = (...workouts: WorkoutData[]): MicrocycleData[] => [{ id: 'm1', weekName: 'x', focus: '', status: 'ACTIVE' as MicrocycleData['status'], workouts }];
const ids = (model: ReturnType<typeof buildWeekRail>) => (model?.kind === 'week' ? model.sessions.map((s) => s.workout.id) : model?.kind);

describe('buildWeekRail', () => {
  it('shows the sessions with the same Block + Week, in date order', () => {
    const a = workout('2026-11-12', { week: '3', block: 'Hyp', day: '2' });
    const b = workout('2026-11-10', { week: 'Week 3', block: 'Hyp', day: '1' });
    const otherBlock = workout('2026-11-11', { week: '3', block: 'Str' });
    const otherWeek = workout('2026-11-17', { week: '4', block: 'Hyp' });
    const model = buildWeekRail(micro(a, b, otherBlock, otherWeek), a.id);
    expect(ids(model)).toEqual([b.id, a.id]);
    expect(model).toMatchObject({ kind: 'week', blockLabel: 'Hyp' });
  });

  it('pulls an unlabeled session inside the week span into that week, tagged inferred', () => {
    const d1 = workout('2026-11-10', { week: '3' });
    const d3 = workout('2026-11-15', { week: '3' });
    const loose = workout('2026-11-13');
    const outside = workout('2026-11-20');
    const model = buildWeekRail(micro(d1, d3, loose, outside), d1.id);
    expect(ids(model)).toEqual([d1.id, loose.id, d3.id]);
    expect(model?.kind === 'week' && model.sessions.find((s) => s.workout.id === loose.id)?.inferred).toBe(true);
    // Opening the unlabeled session shows the same week.
    expect(ids(buildWeekRail(micro(d1, d3, loose, outside), loose.id))).toEqual([d1.id, loose.id, d3.id]);
  });

  it('picks the nearest week when the date is inside two spans', () => {
    const a1 = workout('2026-11-01', { week: '1', block: 'A' });
    const a2 = workout('2026-11-20', { week: '1', block: 'A' });
    const b1 = workout('2026-11-09', { week: '1', block: 'B' });
    const b2 = workout('2026-11-12', { week: '1', block: 'B' });
    const loose = workout('2026-11-11');
    expect(ids(buildWeekRail(micro(a1, a2, b1, b2, loose), loose.id))).toEqual([b1.id, loose.id, b2.id]);
  });

  it('is unassigned when an unlabeled session sits in no week span', () => {
    const labeled = workout('2026-11-10', { week: '3' });
    const loose = workout('2026-12-01');
    expect(buildWeekRail(micro(labeled, loose), loose.id)).toEqual({ kind: 'unassigned' });
    expect(buildWeekRail(micro(labeled, loose), 'missing')).toBeNull();
  });
});

const set = (plannedReps: number | null, plannedRpe: number | null, extra: Partial<SetData> = {}) =>
  ({ plannedWeight: 100, plannedReps, plannedRpe, ...extra }) as SetData;

describe('liftScheme', () => {
  it('groups consecutive plan sets with the same reps and intensity', () => {
    expect(liftScheme([set(3, 8), set(5, 7), set(5, 7), set(5, 7)])).toBe('1×3 @8 · 3×5 @7');
  });
  it('ignores log-only rows, shows % intensity, and counts sets without reps', () => {
    expect(liftScheme([set(6, 80, { intensity_type: 'PERCENT' }), set(6, 80, { intensity_type: 'PERCENT' }), set(null, null, { scope: 'log' })])).toBe('2×6 @80%');
    expect(liftScheme([set(null, null), set(null, null)])).toBe('2 sets');
    expect(liftScheme([])).toBe('');
  });
});

describe('sessionSetCount', () => {
  it('counts plan rows, or logs when there is no plan', () => {
    const w = { exercises: [{ sets: [set(5, 7), set(5, 7), set(null, null, { scope: 'log' })] }, { sets: [set(8, null)] }] } as WorkoutData;
    expect(sessionSetCount(w)).toBe(3);
    expect(sessionSetCount({ exercises: [{ sets: [set(null, null, { scope: 'log' })] }] } as WorkoutData)).toBe(1);
    expect(setCountLabel(1)).toBe('1 set');
    expect(setCountLabel(17)).toBe('17 sets');
  });
});

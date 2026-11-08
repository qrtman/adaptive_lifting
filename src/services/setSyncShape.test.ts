import { describe, expect, it } from 'vitest';
import { fromSyncSet, mergeSetLists, overlayQueuedExerciseSets, setListsMatch, toSyncSet, toSyncSets } from './setSyncShape';

describe('toSyncSet', () => {
  it('builds the payload shape from a grid row', () => {
    expect(toSyncSet({ id: 's1', scope: 'plan', intensity_type: 'PERCENT', target_value: 80, plannedRpe: 7, plannedWeight: 100 }, 1)).toEqual({
      id: 's1', label: 'Set 2', scope: 'plan', plannedWeight: 100, plannedReps: null, plannedRpe: 80,
      intensityType: 'PERCENT', dropPercent: 0, isAuto: false, isTop: false, actual: null, reps: null, executedRpe: null,
    });
    expect(toSyncSet({ id: 's0', scope: 'weird' }, 0)).toMatchObject({ scope: 'both', intensityType: 'RPE', isTop: true });
    expect(toSyncSets(undefined)).toEqual([]);
  });

  it('round-trips through the grid shape', () => {
    const synced = toSyncSet({ id: 's1', intensity_type: 'PERCENT', target_value: 70, plannedWeight: 90 }, 0);
    expect(toSyncSet(fromSyncSet(synced), 0)).toEqual(synced);
  });
});

describe('setListsMatch', () => {
  it('ignores bookkeeping keys and derived flags but not training values', () => {
    const base = [toSyncSet({ id: 'a', plannedWeight: 100 }, 0)];
    expect(setListsMatch(base, [{ ...base[0], revision: 9, hrv: null, isTop: null }])).toBe(true);
    expect(setListsMatch(base, [{ ...base[0], plannedWeight: 102.5 }])).toBe(false);
    expect(setListsMatch(base, [{ ...base[0], scope: 'log' }])).toBe(false);
    expect(setListsMatch(base, [])).toBe(false);
    expect(setListsMatch(base, [{ ...base[0], id: 'b' }])).toBe(false);
  });
});

describe('overlayQueuedExerciseSets', () => {
  const data = [{ id: 'm1', workouts: [{ id: 'w1', exercises: [
    { id: 'e1', revision: 7, sets: [{ id: 's1', plannedWeight: 100 }] },
    { id: 'e2', revision: 3, sets: [{ id: 's9', plannedWeight: 50 }] },
  ] }] }];

  it('shows the newest queued edit of a lift over the fetched sets, paired with its own base revision', () => {
    const queued = [
      { entity_type: 'Exercise', entity_id: 'e1', workout_id: 'w1', updated_at: '2026-11-08T10:00:00Z',
        fields: { sets: [toSyncSet({ id: 's1', plannedWeight: 90 }, 0)] } },
      { entity_type: 'Exercise', entity_id: 'e1', workout_id: 'w1', updated_at: '2026-11-08T10:00:05Z', base_revision: 5,
        fields: { sets: [toSyncSet({ id: 's1', plannedWeight: 95, intensity_type: 'PERCENT', target_value: 70 }, 0)] } },
    ];
    const out = overlayQueuedExerciseSets(data, queued);
    const [e1, e2] = out[0].workouts[0].exercises as any[];
    // Not the fetched 7: a follow-up edit must not pair a newer (maybe coach-changed) revision with these sets.
    expect(e1.revision).toBe(5);
    expect(e1.sets[0]).toMatchObject({ id: 's1', plannedWeight: 95, intensity_type: 'PERCENT', target_value: 70 });
    expect(e2).toBe(data[0].workouts[0].exercises[1]);
  });

  it('leaves data untouched without applicable queued edits', () => {
    expect(overlayQueuedExerciseSets(data, [])).toBe(data);
    expect(overlayQueuedExerciseSets(data, [{ entity_type: 'ExerciseSet', entity_id: 's1', workout_id: 'w1', fields: { actual: 1 } }])).toBe(data);
    expect(overlayQueuedExerciseSets(data, [{ entity_type: 'Exercise', entity_id: 'e1', workout_id: 'other', fields: { sets: [] } }])[0].workouts[0].exercises[0])
      .toBe(data[0].workouts[0].exercises[0]);
  });
});

describe('mergeSetLists (three-way, by set id)', () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, label: `Set ${id}`, scope: 'both', plannedWeight: 160, plannedReps: 5, plannedRpe: 6, intensityType: 'RPE',
    dropPercent: 0, isAuto: false, isTop: false, actual: null, reps: null, executedRpe: null, ...over,
  });
  const logged = (id: string, kg: number) => row(id, { actual: kg, reps: 5, executedRpe: 6 });
  const merged = (result: ReturnType<typeof mergeSetLists>) => {
    expect(result.ok).toBe(true);
    return (result as { ok: true; sets: any[] }).sets;
  };

  // Production 2026-11-09 "Squatish": set 4 was logged in an earlier save of the same user,
  // then set 1 Log changed 160 → 170 before the app knew the new lift version.
  it('merges the owner\'s case: my set 1 change on top of my own earlier set 4 change', () => {
    const base = [logged('1', 160), logged('2', 160), logged('3', 160), row('4', { plannedWeight: 140, plannedReps: null, plannedRpe: null })];
    const server = [logged('1', 160), logged('2', 160), logged('3', 160), row('4', { plannedWeight: 140, plannedReps: null, plannedRpe: null, actual: 140 })];
    const mine = [logged('1', 170), logged('2', 160), logged('3', 160), base[3]];
    const sets = merged(mergeSetLists(base, mine, server));
    expect(sets.map((s) => [s.id, s.actual])).toEqual([['1', 170], ['2', 160], ['3', 160], ['4', 140]]);
    expect(sets.map((s) => s.isTop)).toEqual([true, false, false, false]);
  });

  it('keeps a coach change to another set or field', () => {
    const base = [row('1'), row('2')];
    const server = [row('1'), row('2', { plannedWeight: 150 })];
    const mine = [row('1', { actual: 160, reps: 5 }), row('2')];
    const sets = merged(mergeSetLists(base, mine, server));
    expect(sets[0]).toMatchObject({ actual: 160, reps: 5, plannedWeight: 160 });
    expect(sets[1]).toMatchObject({ plannedWeight: 150 });
  });

  it('accepts both sides making the same change', () => {
    const base = [row('1')];
    expect(merged(mergeSetLists(base, [row('1', { actual: 165 })], [row('1', { actual: 165 })]))[0].actual).toBe(165);
  });

  it('reports a real clash: same field of the same set changed to different values', () => {
    const base = [row('1')];
    expect(mergeSetLists(base, [row('1', { actual: 170 })], [row('1', { actual: 165 })]).ok).toBe(false);
  });

  it('keeps sets added on either side; mine first, then the server\'s', () => {
    const base = [row('1')];
    const sets = merged(mergeSetLists(base, [row('1'), row('m')], [row('1'), row('s')]));
    expect(sets.map((s) => s.id)).toEqual(['1', 'm', 's']);
  });

  it('applies a delete unless the other side edited that set', () => {
    const base = [row('1'), row('2')];
    expect(merged(mergeSetLists(base, [row('1')], [row('1'), row('2')])).map((s) => s.id)).toEqual(['1']);
    expect(mergeSetLists(base, [row('1')], [row('1'), row('2', { actual: 100 })]).ok).toBe(false);
    expect(merged(mergeSetLists(base, [row('1'), row('2')], [row('1')])).map((s) => s.id)).toEqual(['1']);
    expect(mergeSetLists(base, [row('1'), row('2', { actual: 100 })], [row('1')]).ok).toBe(false);
  });

  it('does not overwrite a server copy of a set that is missing from the base unless identical', () => {
    const base = [row('1')];
    expect(merged(mergeSetLists(base, [row('1'), row('x', { actual: 1 })], [row('1'), row('x', { actual: 1 })])).map((s) => s.id)).toEqual(['1', 'x']);
    expect(mergeSetLists(base, [row('1'), row('x', { actual: 1 })], [row('1'), row('x', { actual: 2 })]).ok).toBe(false);
  });

  it('refuses ambiguous input', () => {
    expect(mergeSetLists([row('1'), row('1')], [row('1')], [row('1')]).ok).toBe(false);
    expect(mergeSetLists(undefined, [row('1')], [row('1')]).ok).toBe(false);
  });
});

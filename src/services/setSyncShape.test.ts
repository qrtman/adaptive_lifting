import { describe, expect, it } from 'vitest';
import { fromSyncSet, overlayQueuedExerciseSets, setListsMatch, toSyncSet, toSyncSets } from './setSyncShape';

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

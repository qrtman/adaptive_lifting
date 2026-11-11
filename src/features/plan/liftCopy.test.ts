import { describe, expect, it, vi } from 'vitest';
import type { ExerciseData } from '../../types';
import { catalogLiftPayload, copyLiftIntoSession, planCopySets } from './liftCopy';

const lift = (): ExerciseData => ({
  id: 'e1', title: 'Bench', variation: 'Bench · Paused', tier: 'Comp', liftCategory: 'Bench', movementPattern: 'Horizontal Push',
  liftNote: 'Elbows in', tags: [], top: '', vol: '',
  sets: [
    { id: 'a', scope: 'both', plannedWeight: 90, plannedReps: 6, plannedRpe: 8, target_value: 8, intensity_type: 'RPE', actual: 90, reps: 6, executedRpe: 8.5 } as any,
    { id: 'b', scope: 'plan', plannedWeight: 85, plannedReps: 6, plannedRpe: 80, target_value: 80, intensity_type: 'PERCENT', dropPercent: -5 } as any,
    { id: 'c', scope: 'log', actual: 60, reps: 10 } as any,
  ],
});

describe('lift copy', () => {
  it('copies the Plan only: prescription kept, Log empty, log-only rows dropped', () => {
    expect(planCopySets(lift().sets)).toEqual([
      expect.objectContaining({ scope: 'both', plannedWeight: 90, plannedReps: 6, plannedRpe: 8, intensityType: 'RPE', actual: null, reps: null, executedRpe: null }),
      expect.objectContaining({ scope: 'both', plannedWeight: 85, plannedRpe: 80, intensityType: 'PERCENT', dropPercent: -5, actual: null }),
    ]);
  });

  it('adds the lift with its identity, then writes the copied Plan sets at its current revision', async () => {
    const api = {
      addSessionExercise: vi.fn(async () => ({ id: 'new' }) as ExerciseData),
      replaceExerciseSets: vi.fn(async () => ({ id: 'new' }) as ExerciseData),
    };
    const readRevision = vi.fn(async () => 3);
    await copyLiftIntoSession(api, 'w2', lift(), readRevision);
    expect(readRevision).toHaveBeenCalledWith('w2', 'new');
    expect(api.addSessionExercise).toHaveBeenCalledWith('w2', {
      title: 'Bench', variation: 'Bench · Paused', tier: 'Comp', liftCategory: 'Bench', movementPattern: 'Horizontal Push', liftNote: 'Elbows in',
    });
    expect(api.replaceExerciseSets).toHaveBeenCalledWith('w2', 'new', expect.any(Array), 3);
    expect((api.replaceExerciseSets.mock.calls[0] as unknown[])[2]).toHaveLength(2);
  });

  it('re-reads the revision once when the server calls it stale', async () => {
    const stale = Object.assign(new Error('The lift changed since it was loaded.'), { status: 409 });
    const replaceExerciseSets = vi.fn().mockRejectedValueOnce(stale).mockResolvedValueOnce({ id: 'new' });
    const api = { addSessionExercise: vi.fn(async () => ({ id: 'new' }) as ExerciseData), replaceExerciseSets };
    const readRevision = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await copyLiftIntoSession(api, 'w2', lift(), readRevision);
    expect(replaceExerciseSets.mock.calls.map((c) => c[3])).toEqual([1, 2]);
    const boom = Object.assign(new Error('nope'), { status: 500 });
    const failing = { ...api, replaceExerciseSets: vi.fn().mockRejectedValue(boom) };
    await expect(copyLiftIntoSession(failing, 'w2', lift(), async () => 1)).rejects.toBe(boom);
    expect(failing.replaceExerciseSets).toHaveBeenCalledTimes(1);
  });

  it('builds a new lift from a catalog pick or a typed name', () => {
    expect(catalogLiftPayload({ name: 'Romanian Deadlift', category: 'Hinge', movementPattern: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Variation' } as any))
      .toEqual({ title: 'Romanian Deadlift', variation: 'Romanian Deadlift', tier: 'Variation', liftCategory: 'Deadlift', movementPattern: 'Hip Dominant' });
    expect(catalogLiftPayload({ name: 'Sled push' })).toEqual({ title: 'Sled push', variation: 'Sled push', tier: 'Accessory', liftCategory: 'Other', movementPattern: 'Misc' });
  });
});

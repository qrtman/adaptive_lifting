import { describe, it, expect } from 'vitest';
import {
  composeExerciseName,
  composeVariation,
  buildExercise,
  defaultMovement,
  deriveBaselineE1RM,
  exerciseCategoryOf,
  categoryDefaultBaseline,
  CANONICAL_EXERCISES,
  BuilderMovement,
} from './exerciseLibrary';
import { MicrocycleData } from '../types';

const pauseSquat: BuilderMovement = {
  baseName: 'Squat',
  liftCategory: 'Squat',
  tier: 'Variation',
  tempoId: 'paused',
  romId: 'deficit',
  gear: ['Beltless'],
};

describe('canonical library', () => {
  it('holds movement metadata only — no e1RM baked in', () => {
    for (const ex of CANONICAL_EXERCISES) {
      expect(ex).not.toHaveProperty('baselineE1RM');
      expect(ex.source).toBe('canonical');
    }
  });
});

describe('composeExerciseName', () => {
  it('compiles gear, ROM, tempo and notation into the canonical name', () => {
    expect(composeExerciseName(pauseSquat)).toBe('[Beltless] Deficit Paused Squat (3-2-0)');
  });

  it('omits standard tempo and full ROM decorations', () => {
    expect(composeExerciseName(defaultMovement('Bench'))).toBe('Bench');
  });
});

describe('composeVariation', () => {
  it('summarizes tempo, ROM and gear', () => {
    expect(composeVariation(pauseSquat)).toBe('Paused · Deficit · Beltless');
  });
});

describe('buildExercise', () => {
  it('assembles a movement block with a single blank starter set and no baked baseline', () => {
    const ex = buildExercise(pauseSquat);
    expect(ex.title).toBe('[Beltless] Deficit Paused Squat (3-2-0)');
    expect(ex.tier).toBe('Variation');
    expect(ex.liftCategory).toBe('Squat');
    expect(ex.tags).toContain('Beltless');
    expect(ex.id).toMatch(/^e-cust-/);
    expect(ex.sets).toHaveLength(1);
    const s = ex.sets[0];
    expect(s.plannedWeight).toBeNull();
    expect(s.plannedReps).toBeNull();
    // baseline is seeded later from athlete history, not baked in the builder
    expect(s.baseline_e1rm).toBeUndefined();
  });
});

describe('exerciseCategoryOf', () => {
  it('prefers explicit liftCategory', () => {
    expect(exerciseCategoryOf({ liftCategory: 'Deadlift', title: 'Whatever' })).toBe('Deadlift');
  });
  it('infers from the title when category is missing', () => {
    expect(exerciseCategoryOf({ title: 'Primary Squat' })).toBe('Squat');
    expect(exerciseCategoryOf({ title: 'Competition Paused Bench' })).toBe('Bench');
    expect(exerciseCategoryOf({ title: 'Deficit Deadlift' })).toBe('Deadlift');
    expect(exerciseCategoryOf({ title: 'Lateral Raise' })).toBe('Other');
  });
});

function microWith(sets: any[], title = 'Primary Squat', liftCategory?: string): MicrocycleData[] {
  return [
    {
      id: 'm1',
      weekName: 'MC1',
      focus: 'x',
      status: 'ACTIVE',
      workouts: [
        {
          id: 'w1',
          date: '2026-09-01',
          dayLabel: 'D1',
          title: 'D1',
          tonnage: 0,
          delta: 0,
          color: 'mac-blue',
          status: 'IN_PROGRESS',
          exercises: [
            { id: 'e1', title, variation: '', tier: 'Comp', liftCategory: liftCategory as any, tags: [], top: '', vol: '', sets },
          ],
        },
      ],
    },
  ];
}

describe('deriveBaselineE1RM', () => {
  it('falls back to the category default when there is no history', () => {
    expect(deriveBaselineE1RM([], 'Squat')).toBe(categoryDefaultBaseline('Squat'));
    expect(deriveBaselineE1RM([], 'Deadlift')).toBe(180);
  });

  it('uses the athlete\'s best logged e1RM for the category', () => {
    // 200kg x 1 @ RPE 10 → e1RM 200 (dominates a lighter logged set)
    const mcs = microWith([
      { id: 's1', label: 'top', plannedWeight: null, plannedReps: null, plannedRpe: null, actual: 200, reps: 1, executedRpe: 10 },
      { id: 's2', label: 'back', plannedWeight: null, plannedReps: null, plannedRpe: null, actual: 150, reps: 5, executedRpe: 8 },
    ]);
    expect(deriveBaselineE1RM(mcs, 'Squat')).toBe(200);
  });

  it('falls back to a planned baseline when nothing is logged yet', () => {
    const mcs = microWith([
      { id: 's1', label: 'top', plannedWeight: 160, plannedReps: 3, plannedRpe: 8, baseline_e1rm: 185, actual: null, reps: null, executedRpe: null },
    ]);
    expect(deriveBaselineE1RM(mcs, 'Squat')).toBe(185);
  });

  it('is category-scoped (bench history does not leak into squat)', () => {
    const mcs = microWith(
      [{ id: 's1', label: 'top', plannedWeight: null, plannedReps: null, plannedRpe: null, actual: 120, reps: 1, executedRpe: 10 }],
      'Competition Bench',
      'Bench',
    );
    expect(deriveBaselineE1RM(mcs, 'Squat')).toBe(categoryDefaultBaseline('Squat'));
    expect(deriveBaselineE1RM(mcs, 'Bench')).toBe(120);
  });
});

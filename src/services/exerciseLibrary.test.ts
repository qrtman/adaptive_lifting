import { describe, it, expect } from 'vitest';
import {
  composeExerciseName,
  composeVariation,
  buildExercise,
  defaultMovement,
  BuilderMovement,
} from './exerciseLibrary';

const pauseSquat: BuilderMovement = {
  baseName: 'Squat',
  liftCategory: 'Squat',
  tier: 'Variation',
  tempoId: 'paused',
  romId: 'deficit',
  gear: ['Beltless'],
  baselineE1RM: 170,
};

describe('composeExerciseName', () => {
  it('compiles gear, ROM, tempo and notation into the canonical name', () => {
    expect(composeExerciseName(pauseSquat)).toBe('[Beltless] Deficit Paused Squat (3-2-0)');
  });

  it('omits standard tempo and full ROM decorations', () => {
    const m = defaultMovement('Bench');
    expect(composeExerciseName(m)).toBe('Bench');
  });

  it('falls back to a placeholder when base name is empty', () => {
    const m = { ...defaultMovement(''), baseName: '' };
    expect(composeExerciseName(m)).toBe('Custom Movement');
  });
});

describe('composeVariation', () => {
  it('summarizes tempo, ROM and gear', () => {
    expect(composeVariation(pauseSquat)).toBe('Paused · Deficit · Beltless');
  });
});

describe('defaultMovement', () => {
  it('seeds the search string and a default baseline anchor', () => {
    const m = defaultMovement('Bench');
    expect(m.baseName).toBe('Bench');
    expect(m.baselineE1RM).toBe(150);
    expect(m.tempoId).toBe('standard');
    expect(m.romId).toBe('full');
  });
});

describe('buildExercise', () => {
  it('assembles a movement block with a single blank starter set', () => {
    const ex = buildExercise(pauseSquat);
    expect(ex.title).toBe('[Beltless] Deficit Paused Squat (3-2-0)');
    expect(ex.tier).toBe('Variation');
    expect(ex.liftCategory).toBe('Squat');
    expect(ex.tags).toContain('Beltless');
    expect(ex.id).toMatch(/^e-cust-/);
  });

  it('injects exactly one starter set with no prescribed numbers (built in the card)', () => {
    const ex = buildExercise(pauseSquat);
    expect(ex.sets).toHaveLength(1);
    const s = ex.sets[0];
    expect(s.plannedWeight).toBeNull();
    expect(s.plannedReps).toBeNull();
    expect(s.plannedRpe).toBeNull();
    // the movement's baseline anchor is carried so the card can scale loads
    expect(s.baseline_e1rm).toBe(170);
    expect(s.isTop).toBe(true);
  });

  it('keeps training values numeric or null (no string weights)', () => {
    const ex = buildExercise(defaultMovement('Custom'));
    for (const s of ex.sets) {
      expect(typeof s.plannedWeight === 'number' || s.plannedWeight === null).toBe(true);
      expect(typeof s.plannedReps === 'number' || s.plannedReps === null).toBe(true);
    }
  });
});

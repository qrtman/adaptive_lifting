import { describe, it, expect } from 'vitest';
import {
  composeExerciseName,
  composeVariation,
  compilePrescriptionSets,
  prescriptionPreview,
  buildExercise,
  defaultMovement,
  defaultPrescription,
  BuilderMovement,
  BuilderPrescription,
} from './exerciseLibrary';

const pauseSquat: BuilderMovement = {
  baseName: 'Squat',
  liftCategory: 'Squat',
  tier: 'Variation',
  tempoId: 'paused',
  romId: 'deficit',
  gear: ['Beltless'],
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

describe('compilePrescriptionSets', () => {
  it('produces straight RPE sets as structured numeric data', () => {
    const p: BuilderPrescription = { ...defaultPrescription(200), mode: 'RPE_TARGET', sets: 3, reps: 3, intensityValue: 8 };
    const sets = compilePrescriptionSets('t', p);
    expect(sets).toHaveLength(3);
    for (const s of sets) {
      expect(s.intensity_type).toBe('RPE');
      expect(s.target_value).toBe(8);
      expect(s.plannedReps).toBe(3);
      expect(typeof s.plannedWeight).toBe('number');
      expect(s.plannedWeight).toBeGreaterThan(0);
      // planned weight snaps to 2.5kg competition plates
      expect((s.plannedWeight as number) % 2.5).toBeCloseTo(0, 5);
    }
    expect(sets[0].isTop).toBe(true);
  });

  it('produces percentage sets with PERCENT intensity type', () => {
    const p: BuilderPrescription = { ...defaultPrescription(200), mode: 'PERCENTAGE', sets: 2, reps: 5, intensityValue: 80 };
    const sets = compilePrescriptionSets('t', p);
    expect(sets).toHaveLength(2);
    expect(sets[0].intensity_type).toBe('PERCENT');
    expect(sets[0].target_value).toBe(80);
    // 200kg * 80% = 160kg
    expect(sets[0].plannedWeight).toBe(160);
  });

  it('produces a single AMRAP set', () => {
    const p: BuilderPrescription = { ...defaultPrescription(150), mode: 'AMRAP', reps: 5, intensityValue: 9 };
    const sets = compilePrescriptionSets('t', p);
    expect(sets).toHaveLength(1);
    expect(sets[0].label).toBe('AMRAP');
    expect(sets[0].note).toBe('AMRAP');
    expect(sets[0].isTop).toBe(true);
  });

  it('produces a top set plus backdown sets with a negative load adjustment', () => {
    const p: BuilderPrescription = {
      ...defaultPrescription(200),
      mode: 'TOP_SET_BACKDOWN',
      reps: 3,
      intensityValue: 8,
      backdownSets: 2,
      backdownDropPct: 5,
    };
    const sets = compilePrescriptionSets('t', p);
    expect(sets).toHaveLength(3);
    expect(sets[0].label).toBe('Top Set');
    expect(sets[0].adjustment_pct).toBe(0);
    expect(sets[1].label).toBe('Backdown');
    expect(sets[1].adjustment_pct).toBeCloseTo(-0.05, 5);
    // backdown load is lighter than the top set
    expect(sets[1].plannedWeight as number).toBeLessThan(sets[0].plannedWeight as number);
  });

  it('never returns string weights (numeric integrity)', () => {
    const p = defaultPrescription(180);
    for (const s of compilePrescriptionSets('t', p)) {
      expect(typeof s.plannedWeight === 'number' || s.plannedWeight === null).toBe(true);
      expect(typeof s.plannedReps === 'number' || s.plannedReps === null).toBe(true);
    }
  });
});

describe('prescriptionPreview', () => {
  it('renders a readable straight-set summary', () => {
    const p: BuilderPrescription = { ...defaultPrescription(200), mode: 'RPE_TARGET', sets: 3, reps: 3, intensityValue: 8 };
    expect(prescriptionPreview(p)).toContain('3 × 3 @ RPE 8');
  });

  it('renders a top-set + backdown summary', () => {
    const p: BuilderPrescription = {
      ...defaultPrescription(200),
      mode: 'TOP_SET_BACKDOWN',
      reps: 3,
      intensityValue: 8,
      backdownSets: 2,
      backdownDropPct: 5,
    };
    const preview = prescriptionPreview(p);
    expect(preview).toContain('Top:');
    expect(preview).toContain('Backdown:');
  });
});

describe('buildExercise', () => {
  it('assembles a complete exercise block ready to inject', () => {
    const ex = buildExercise(pauseSquat, defaultPrescription(170));
    expect(ex.title).toBe('[Beltless] Deficit Paused Squat (3-2-0)');
    expect(ex.tier).toBe('Variation');
    expect(ex.liftCategory).toBe('Squat');
    expect(ex.sets.length).toBeGreaterThan(0);
    expect(ex.tags).toContain('Beltless');
    expect(ex.id).toMatch(/^e-cust-/);
  });
});

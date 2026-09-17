import { describe, expect, it } from 'vitest';
import { planKgOfferKg, refreshSetAnchors } from './setPrescription';

describe('refreshSetAnchors', () => {
  it('does not invent a top-set weight from e1RM', () => {
    const next = refreshSetAnchors([
      {
        plannedWeight: null,
        plannedReps: 5,
        plannedRpe: 8,
        baseline_e1rm: 150,
      },
    ]);
    expect(next[0].plannedWeight).toBeNull();
  });

  it('keeps extra-set kg empty', () => {
    const next = refreshSetAnchors([
      { plannedWeight: 180, plannedReps: 5, plannedRpe: 8 },
      { plannedWeight: null, plannedReps: 5, plannedRpe: 8, isAuto: true, dropPercent: -10 },
    ]);
    expect(next[1].plannedWeight).toBeNull();
  });

  it('keeps a typed top-set weight', () => {
    const next = refreshSetAnchors([
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        baseline_e1rm: 999,
      },
    ]);
    expect(next[0].plannedWeight).toBe(180);
    expect(next[0].baseline_e1rm).toBeGreaterThan(180);
    expect(next[0].baseline_e1rm).toBeLessThan(250);
  });

  it('suggests later empty kg from a logged set without overwriting typed kg', () => {
    const next = refreshSetAnchors([
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        actual: 180,
        reps: 5,
        executedRpe: 9,
      },
      {
        plannedWeight: null,
        plannedReps: 5,
        plannedRpe: 8,
        intensity_type: 'RPE',
      },
    ]);
    expect(next[0].plannedWeight).toBe(180);
    expect(next[1].plannedWeight).toBeNull();
    expect(next[1].suggestedWeight).toBeGreaterThan(0);
    expect(next[1].suggestedWeight).toBeLessThan(180);
  });

  it('does not suggest kg from a fake baseline e1RM when nothing is logged', () => {
    const next = refreshSetAnchors([
      { plannedWeight: 180, plannedReps: 5, plannedRpe: 8, baseline_e1rm: 400 },
      { plannedWeight: null, plannedReps: 5, plannedRpe: 8, intensity_type: 'RPE' },
    ]);
    expect(next[1].plannedWeight).toBeNull();
    expect(next[1].suggestedWeight).toBeNull();
  });

  it('suggests later kg after a log even when that row already has typed plan kg', () => {
    const next = refreshSetAnchors([
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        actual: 180,
        reps: 5,
        executedRpe: 9,
      },
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        intensity_type: 'RPE',
      },
    ]);
    expect(next[1].plannedWeight).toBe(180);
    expect(next[1].suggestedWeight).toBeGreaterThan(0);
    expect(next[1].suggestedWeight).not.toBe(180);
    expect(planKgOfferKg(next[1].suggestedWeight, next[1].plannedWeight)).toBe(next[1].suggestedWeight);
  });

  it('does not overwrite typed plan kg until the offer is accepted', () => {
    const later = {
      plannedWeight: 175,
      plannedReps: 5,
      plannedRpe: 8,
      intensity_type: 'RPE',
    };
    const next = refreshSetAnchors([
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        actual: 180,
        reps: 5,
        executedRpe: 9,
      },
      later,
    ]);
    expect(next[1].plannedWeight).toBe(175);
    expect(next[1].suggestedWeight).not.toBeNull();
    expect(next[1].suggestedWeight).not.toBe(175);
  });

  it('does not suggest plan kg on a later row that already has LOG kg', () => {
    const next = refreshSetAnchors([
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        actual: 180,
        reps: 5,
        executedRpe: 9,
      },
      {
        plannedWeight: 170,
        plannedReps: 5,
        plannedRpe: 8,
        actual: 165,
        intensity_type: 'RPE',
      },
      {
        plannedWeight: 170,
        plannedReps: 5,
        plannedRpe: 8,
        intensity_type: 'RPE',
      },
    ]);
    expect(next[1].plannedWeight).toBe(170);
    expect(next[1].suggestedWeight).toBeNull();
    expect(planKgOfferKg(next[1].suggestedWeight, next[1].plannedWeight)).toBeNull();
    expect(next[2].suggestedWeight).toBeGreaterThan(0);
  });

  it('hides the offer when typed plan kg already matches the suggestion', () => {
    const next = refreshSetAnchors([
      {
        plannedWeight: 180,
        plannedReps: 5,
        plannedRpe: 8,
        actual: 180,
        reps: 5,
        executedRpe: 9,
      },
      {
        plannedWeight: null,
        plannedReps: 5,
        plannedRpe: 8,
        intensity_type: 'RPE',
      },
    ]);
    const suggested = next[1].suggestedWeight;
    expect(suggested).toBeGreaterThan(0);
    expect(planKgOfferKg(suggested, null)).toBe(suggested);
    expect(planKgOfferKg(suggested, suggested)).toBeNull();
  });
});

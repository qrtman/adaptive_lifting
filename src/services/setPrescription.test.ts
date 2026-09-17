import { describe, expect, it } from 'vitest';
import {
  applyLiftAdj,
  applySetDropPercent,
  formatLiftAdjPreview,
  formatSignedDelta,
  LIFT_ADJ_COPY,
  liftAdjAnchorKg,
  liftAdjDisabledReason,
  liftAdjResultKg,
  parseDropPercent,
  parseSignedDelta,
  planKgOfferKg,
  previewLiftAdj,
  refreshSetAnchors,
  setDropAnchorKg,
  setDropResultKg,
} from './setPrescription';

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

describe('lift Adj remaining Plan kg', () => {
  const unlogged = (plannedWeight: number | null) => ({
    plannedWeight,
    plannedReps: 5,
    plannedRpe: 8,
    actual: null,
    reps: null,
    executedRpe: null,
    dropPercent: -10,
    adjustment_pct: 4,
    isAuto: true,
  });

  it('rewrites remaining unlogged by % −10 and plate-rounds', () => {
    const sets = [
      { ...unlogged(180), actual: 180, reps: 5, executedRpe: 9 },
      unlogged(180),
      unlogged(null),
    ];
    const snapshot = JSON.parse(JSON.stringify(sets));
    const { preview, patches } = previewLiftAdj(sets, 'pct', -10);
    expect(sets).toEqual(snapshot);
    expect(preview).toEqual({ count: 2, fromKg: 180, toKg: 162.5 });
    expect(formatLiftAdjPreview(preview!)).toBe('2 sets 180 → 162.5');
    expect(patches).toEqual([
      { index: 1, plannedWeight: 162.5 },
      { index: 2, plannedWeight: 162.5 },
    ]);

    const next = applyLiftAdj(sets, patches);
    expect(next[0].plannedWeight).toBe(180);
    expect(next[0].actual).toBe(180);
    expect(next[0].reps).toBe(5);
    expect(next[1].plannedWeight).toBe(162.5);
    expect(next[1].actual).toBeNull();
    expect(next[1].plannedReps).toBe(5);
    expect(next[1].isAuto).toBe(false);
    expect(next[1].dropPercent).toBe(-10);
    expect(next[2].plannedWeight).toBe(162.5);
    expect(next[2].adjustment_pct).toBe(4);
    const refreshed = refreshSetAnchors(next);
    expect(planKgOfferKg(refreshed[1].suggestedWeight, refreshed[1].plannedWeight)).toBe(refreshed[1].suggestedWeight);
    expect(planKgOfferKg(refreshed[0].suggestedWeight, refreshed[0].plannedWeight)).toBeNull();
  });

  it('does not auto-write until Apply patches are applied', () => {
    const sets = [unlogged(180), unlogged(180)];
    const { patches } = previewLiftAdj(sets, 'pct', -10);
    expect(sets[0].plannedWeight).toBe(180);
    expect(sets[1].plannedWeight).toBe(180);
    expect(applyLiftAdj(sets, [])).toBe(sets);
    const next = applyLiftAdj(sets, patches);
    expect(next).not.toBe(sets);
    expect(next[0].plannedWeight).toBe(162.5);
  });

  it('leaves logged rows untouched and uses last LOG kg as anchor', () => {
    expect(liftAdjAnchorKg([
      { plannedWeight: 200, actual: 180 },
      { plannedWeight: 170, actual: 175 },
      { plannedWeight: null, actual: null },
    ])).toBe(175);

    const sets = [
      { plannedWeight: 180, actual: 180, reps: 3, plannedReps: 3 },
      { plannedWeight: 170, actual: null, plannedReps: 5 },
    ];
    const { preview, patches } = previewLiftAdj(sets, 'pct', -10);
    expect(preview).toEqual({ count: 1, fromKg: 170, toKg: 152.5 });
    const next = applyLiftAdj(sets, patches);
    expect(next[0].plannedWeight).toBe(180);
    expect(next[0].actual).toBe(180);
    expect(next[1].plannedWeight).toBe(152.5);
    expect(next[1].actual).toBeNull();
  });

  it('plate-rounds kg mode and skips non-positive results', () => {
    expect(liftAdjResultKg(181, 'pct', -10)).toBe(162.5);
    expect(liftAdjResultKg(180, 'kg', -2.5)).toBe(177.5);
    const { preview, patches } = previewLiftAdj(
      [unlogged(2.5), unlogged(180)],
      'kg',
      -10,
    );
    expect(patches).toEqual([{ index: 1, plannedWeight: 170 }]);
    expect(preview).toEqual({ count: 1, fromKg: 180, toKg: 170 });
    expect(previewLiftAdj([unlogged(2.5)], 'pct', -100).patches).toEqual([]);
  });

  it('disables without remaining unlogged sets or without an anchor', () => {
    expect(liftAdjDisabledReason([{ plannedWeight: 180, actual: 180 }])).toBe(LIFT_ADJ_COPY.noRemaining);
    expect(liftAdjDisabledReason([unlogged(null)])).toBe(LIFT_ADJ_COPY.noAnchor);
    expect(liftAdjDisabledReason([unlogged(180)])).toBeNull();
    expect(parseSignedDelta('−10')).toBe(-10);
    expect(formatSignedDelta(-10)).toBe('−10');
    expect(formatSignedDelta(2.5)).toBe('+2.5');
  });
});

describe('per-set % drop from top/anchor kg', () => {
  it('rewrites an unlogged later row −10% from a 200 kg top to 180', () => {
    const sets = [
      { plannedWeight: 200, actual: null, dropPercent: 0, isAuto: false, adjustment_pct: 4 },
      { plannedWeight: 200, actual: null, dropPercent: 0, isAuto: false, adjustment_pct: 4 },
    ];
    const next = applySetDropPercent(sets, 1, -10);
    expect(next[1].plannedWeight).toBe(180);
    expect(next[1].dropPercent).toBe(-10);
    expect(next[1].isAuto).toBe(false);
    expect(next[1].adjustment_pct).toBe(4);
    expect(next[0].plannedWeight).toBe(200);
    expect(next[0].dropPercent).toBe(0);
  });

  it('anchors later rows on set 0 LOG kg when actual > 0', () => {
    const next = applySetDropPercent(
      [
        { plannedWeight: 190, actual: 200, dropPercent: 0 },
        { plannedWeight: 190, actual: null, dropPercent: 0 },
      ],
      1,
      -10,
    );
    expect(next[1].plannedWeight).toBe(180);
    expect(next[0].plannedWeight).toBe(190);
  });

  it('does not rewrite Plan kg on a logged row', () => {
    const next = applySetDropPercent(
      [
        { plannedWeight: 200, actual: 200, dropPercent: 0 },
        { plannedWeight: 185, actual: 182.5, dropPercent: 0, isAuto: false },
      ],
      1,
      -10,
    );
    expect(next[1].plannedWeight).toBe(185);
    expect(next[1].actual).toBe(182.5);
    expect(next[1].dropPercent).toBe(-10);
    expect(next[1].isAuto).toBe(false);
  });

  it('does not invent kg without an anchor and treats empty as 0', () => {
    expect(setDropAnchorKg([{ plannedWeight: null, actual: null }])).toBeNull();
    const next = applySetDropPercent(
      [{ plannedWeight: null, actual: null, dropPercent: 0 }],
      0,
      -10,
    );
    expect(next[0].plannedWeight).toBeNull();
    expect(next[0].dropPercent).toBe(-10);
    expect(parseDropPercent('')).toBe(0);
    expect(parseDropPercent('−10')).toBe(-10);
    expect(setDropResultKg(200, -100)).toBeNull();
    expect(applySetDropPercent(
      [{ plannedWeight: 200, actual: null, dropPercent: 0 }],
      0,
      -100,
    )[0].plannedWeight).toBe(200);
  });

  it('does not auto-fill extra sets from stored dropPercent on refresh', () => {
    const next = refreshSetAnchors([
      { plannedWeight: 200, plannedReps: 5, plannedRpe: 8 },
      { plannedWeight: null, plannedReps: 5, plannedRpe: 8, dropPercent: -10, isAuto: false },
    ]);
    expect(next[1].plannedWeight).toBeNull();
    expect(next[1].dropPercent).toBe(-10);
    expect(next[1].isAuto).toBe(false);
  });

  it('does not fill empty later kg when committing unchanged 0%', () => {
    const next = applySetDropPercent(
      [
        { plannedWeight: 200, actual: null, dropPercent: 0 },
        { plannedWeight: null, actual: null, dropPercent: 0, isAuto: false },
      ],
      1,
      0,
    );
    expect(next[1].plannedWeight).toBeNull();
    expect(next[1].dropPercent).toBe(0);
    expect(next[1].isAuto).toBe(false);
  });
});

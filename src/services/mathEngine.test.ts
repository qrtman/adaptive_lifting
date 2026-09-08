import { describe, expect, it } from 'vitest';
import vectors from '../../tests/math_vectors.json';
import {
  calculateAttemptJumps,
  calculateDOTS,
  calculateE1RM,
  calculateINOL,
  anchorE1RMFromPrescription,
  formatPrecedingE1RMDelta,
  peakPrecedingLoggedE1RM,
  precedingLoggedE1RMDelta,
  roundToCompetitionPlates,
} from './mathEngine';

describe('shared math vectors', () => {
  it('matches backend e1RM cases', () => {
    for (const row of vectors.e1rm) {
      expect(calculateE1RM(row.weight, row.reps, row.rpe)).toBe(row.expected);
    }
  });

  it('recovers the anchor e1RM when a prescribed RPE 5 single is logged as written', () => {
    expect(Math.round(calculateE1RM(137.5, 1, 5))).toBe(160);
  });

  it('matches backend INOL cases', () => {
    for (const row of vectors.inol) {
      expect(calculateINOL(row.reps, row.intensity_pct)).toBe(row.expected);
    }
  });

  it('matches backend plate rounding', () => {
    for (const row of vectors.plates) {
      expect(roundToCompetitionPlates(row.weight)).toBe(row.expected);
    }
  });

  it('matches backend DOTS cases', () => {
    for (const row of vectors.dots) {
      expect(calculateDOTS(row.gender, row.bodyweight, row.total)).toBe(row.expected);
    }
  });

  it('matches backend attempt jumps', () => {
    for (const row of vectors.attempts) {
      const jumps = calculateAttemptJumps(row.first_attempt, row.profile, row.gender);
      expect(jumps.suggested_second).toBe(row.suggested_second);
      expect(jumps.third_ceiling).toBe(row.third_ceiling);
    }
  });
});

describe('anchorE1RMFromPrescription', () => {
  it('derives the anchor from set 1 Rx, not from a stored baseline', () => {
    expect(Math.round(anchorE1RMFromPrescription(137.5, 1, 5, 'RPE'))).toBe(160);
    expect(anchorE1RMFromPrescription(80, 1, 50, 'PERCENT')).toBe(160);
  });
});

describe('precedingLoggedE1RMDelta', () => {
  const sets = [
    { actual: 160, reps: 1, executedRpe: 8.5 },
    { actual: 152.5, reps: 3, executedRpe: 7.5 },
    { actual: null, reps: null, executedRpe: null },
    { actual: 152.5, reps: 3, executedRpe: 8 },
    { actual: 80, reps: 1, executedRpe: null, intensity_type: 'PERCENT', target_value: 50 },
  ];

  it('has no Δ on set 1', () => {
    expect(precedingLoggedE1RMDelta(sets, 0)).toBeNull();
  });

  it('compares to the most recent preceding logged e1RM as kg and %', () => {
    const first = Math.round(calculateE1RM(160, 1, 8.5));
    const second = Math.round(calculateE1RM(152.5, 3, 7.5));
    const delta = precedingLoggedE1RMDelta(sets, 1);
    expect(delta).toEqual({
      kg: second - first,
      pct: Math.round(((second - first) / first) * 1000) / 10,
    });
    expect(formatPrecedingE1RMDelta(delta!)).toBe(`+${second - first} +${delta!.pct.toFixed(1)}%`);
  });

  it('skips unlogged rows when looking back', () => {
    const second = Math.round(calculateE1RM(152.5, 3, 7.5));
    const fourth = Math.round(calculateE1RM(152.5, 3, 8));
    expect(precedingLoggedE1RMDelta(sets, 2)).toBeNull();
    expect(precedingLoggedE1RMDelta(sets, 3)?.kg).toBe(fourth - second);
  });

  it('inverts percent prescriptions for the lookback', () => {
    const fourth = Math.round(calculateE1RM(152.5, 3, 8));
    expect(precedingLoggedE1RMDelta(sets, 4)?.kg).toBe(160 - fourth);
  });
});

describe('peakPrecedingLoggedE1RM', () => {
  it('keeps later-set suggestions on the top-set e1RM, not a lighter backdown', () => {
    const sets = [
      { actual: 135, reps: 1, executedRpe: 6, isTop: true },
      { actual: 130, reps: 1, executedRpe: 6 },
      { actual: 125, reps: 1, executedRpe: 6 },
    ];
    const top = calculateE1RM(135, 1, 6);
    const backdown = calculateE1RM(130, 1, 6);
    expect(peakPrecedingLoggedE1RM(sets, 2)).toBe(top);
    expect(peakPrecedingLoggedE1RM(sets, 2)).not.toBe(backdown);
  });
});

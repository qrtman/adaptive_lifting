import { describe, expect, it } from 'vitest';
import vectors from '../../tests/math_vectors.json';
import {
  calculateAttemptJumps,
  calculateDOTS,
  calculateE1RM,
  calculateINOL,
  anchorE1RMFromPrescription,
  peakPrecedingLoggedE1RM,
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

import { describe, expect, it } from 'vitest';
import vectors from '../../tests/math_vectors.json';
import {
  E1RM_RPE_FLOOR,
  MATH_VERSION,
  calculateAttemptJumps,
  calculateDOTS,
  calculateE1RM,
  calculateINOL,
  calculateWeightFromE1RM,
  roundToCompetitionPlates,
  setPreviewMetrics,
} from './mathEngine';

describe('shared math vectors', () => {
  it('pins MATH_VERSION to the shared fixture', () => {
    expect(MATH_VERSION).toBe(vectors.math_version);
  });

  it('matches backend e1RM cases', () => {
    for (const row of vectors.e1rm) {
      expect(calculateE1RM(row.weight, row.reps, row.rpe)).toBe(row.expected);
    }
  });

  it('matches backend INOL cases', () => {
    for (const row of vectors.inol) {
      expect(calculateINOL(row.reps, row.intensity_pct)).toBe(row.expected);
    }
  });

  it('matches backend set preview (e1RM, intensity, INOL)', () => {
    for (const row of vectors.sets) {
      expect(setPreviewMetrics(row.weight, row.reps, row.rpe)).toEqual({
        e1rm: row.e1rm,
        intensity_pct: row.intensity_pct,
        inol: row.inol,
      });
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

describe('e1RM RPE floor and ranking', () => {
  it('pins the floor at 5.0 and MATH_VERSION to v3', () => {
    expect(E1RM_RPE_FLOOR).toBe(5.0);
    expect(MATH_VERSION).toBe('linear-decay-v3');
  });

  it('ranks 150×6 @5 > @6 > @7 and equals @4', () => {
    const atFive = calculateE1RM(150, 6, 5);
    const atSix = calculateE1RM(150, 6, 6);
    const atSeven = calculateE1RM(150, 6, 7);
    const atFour = calculateE1RM(150, 6, 4);
    expect(atFive).toBe(214.29);
    expect(atFive).not.toBe(150);
    expect(atFive).not.toBe(200);
    expect(atSix).toBe(205.48);
    expect(atSeven).toBe(197.37);
    expect(atFive).toBeGreaterThan(atSix);
    expect(atSix).toBeGreaterThan(atSeven);
    expect(atFour).toBe(atFive);
    expect(calculateE1RM(150, 6, 0)).toBe(150);
  });

  it('does not clamp RPE 5.5 to 5.0', () => {
    expect(calculateE1RM(100, 3, 5)).toBe(126.58);
    expect(calculateE1RM(100, 3, 5.5)).toBe(124.22);
    expect(calculateE1RM(100, 3, 4)).toBe(126.58);
  });

  it('calculateWeightFromE1RM has no 25% drop cap', () => {
    const e1rm = calculateE1RM(150, 6, 5);
    expect(e1rm).toBe(214.29);
    const recovered = calculateWeightFromE1RM(e1rm, 6, 5);
    expect(recovered).not.toBe(e1rm);
    expect(Math.round(recovered * 100) / 100).toBe(150);
    expect(calculateWeightFromE1RM(e1rm, 6, 4)).toBe(recovered);
  });
});

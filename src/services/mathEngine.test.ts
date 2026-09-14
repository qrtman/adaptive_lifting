import { describe, expect, it } from 'vitest';
import vectors from '../../tests/math_vectors.json';
import {
  MATH_VERSION,
  calculateAttemptJumps,
  calculateDOTS,
  calculateE1RM,
  calculateINOL,
  roundToCompetitionPlates,
  setPreviewMetrics,
} from './mathEngine';

describe('shared math vectors', () => {
  it('pins MATH_VERSION to the shared fixture', () => {
    expect(MATH_VERSION).toBe(vectors.math_version);
    expect(vectors.metrics).toEqual(expect.arrayContaining(['e1rm', 'inol', 'intensity_pct', 'dots']));
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

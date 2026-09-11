import { describe, expect, it } from 'vitest';
import { refreshSetAnchors } from './setPrescription';

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
});

import { describe, expect, it } from 'vitest';
import { logSummary, logSummaryText, planSummary, planSummaryText, sessionLogged } from './liftSummary';

const set = (extra: Record<string, unknown>) => ({ scope: 'both', intensity_type: 'RPE', ...extra });

describe('lift summaries (session sheet phase 7)', () => {
  const sets = [
    set({ plannedWeight: 150, plannedReps: 3, target_value: 8, actual: 150, reps: 3 }),
    set({ plannedWeight: 130, plannedReps: 5, target_value: 70, intensity_type: 'PERCENT', actual: 130, reps: 5 }),
    set({ plannedWeight: 130, plannedReps: 5, target_value: 70, intensity_type: 'PERCENT' }),
    { scope: 'log', actual: 60, reps: 10 },
  ];

  it('Plan: set count, NL, volume and average planned intensity; log-only rows do not count', () => {
    const plan = planSummary(sets);
    expect(plan).toMatchObject({ sets: 3, nl: 13, volume: 150 * 3 + 130 * 5 * 2 });
    expect(plan.intensityPct).toBeGreaterThan(70);
    expect(planSummaryText({ sets: 4, nl: 18, volume: 2400, intensityPct: 78 })).toBe('4 sets · NL 18 · 2,400 kg · 78%');
    expect(planSummaryText({ sets: 1, nl: 0, volume: 0, intensityPct: null })).toBe('1 set');
  });

  it('Logged: logged of planned and logged volume', () => {
    const log = logSummary(sets);
    expect(log).toEqual({ logged: 3, planned: 3, nl: 18, volume: 450 + 650 + 600 });
    expect(logSummaryText(log)).toBe('3 / 3 · 1,700 kg');
    expect(logSummaryText({ logged: 0, planned: 4, nl: 0, volume: 0 })).toBe('0 / 4');
    expect(logSummaryText({ logged: 2, planned: 0, nl: 20, volume: 1200 })).toBe('2 sets · 1,200 kg');
  });

  it('session: logged sets against planned sets across lifts, no tonnage', () => {
    expect(sessionLogged([{ sets }, { sets: [set({ plannedReps: 8 })] }])).toEqual({ logged: 3, planned: 4 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyLift,
  constructAttemptPreview,
  constructInsightKpis,
  filterTrends,
  peakE1RM,
} from './construct';

const points = [
  { date: '2026-09-16', exercise: 'Primary Squat', liftCategory: 'Squat', weight: 160, reps: 1, rpe: 8.5, e1rm: 168, volume: 160 },
  { date: '2026-09-16', exercise: 'Primary Bench', liftCategory: 'Bench', weight: 95, reps: 3, rpe: 8, e1rm: 108, volume: 285 },
  { date: '2026-08-01', exercise: 'Primary Squat', liftCategory: 'Squat', weight: 150, reps: 1, rpe: 8, e1rm: 155, volume: 150 },
];

describe('classifyLift', () => {
  it('prefers liftCategory over title scanning', () => {
    expect(classifyLift('Leg Press', 'Squat')).toBe('Squat');
    expect(classifyLift('Primary Squat')).toBe('Squat');
    expect(classifyLift('Triceps Extension')).toBe('Other');
  });
});

describe('filterTrends', () => {
  it('filters by lift using category first', () => {
    expect(filterTrends(points, 'All', 'Bench')).toHaveLength(1);
    expect(filterTrends(points, 'All', 'Squat')).toHaveLength(2);
  });

  it('cuts by time range', () => {
    const now = new Date('2026-09-20T00:00:00Z');
    expect(filterTrends(points, '30d', 'All', now)).toHaveLength(2);
  });
});

describe('constructInsightKpis', () => {
  it('builds SQ BP DL Vol DOTS ACWR from trends and analytics', () => {
    const kpis = constructInsightKpis(points, {
      dots_score: 412,
      fatigue_metrics: { acute_chronic_ratio: 1.12 },
    });
    expect(kpis.map((k) => k.id)).toEqual(['sq', 'bp', 'dl', 'vol', 'dots', 'acwr']);
    expect(peakE1RM(points, 'Squat')).toBe(168);
    expect(kpis.find((k) => k.id === 'sq')?.value).toBe('168');
    expect(kpis.find((k) => k.id === 'dots')?.value).toBe('412');
    expect(kpis.find((k) => k.id === 'acwr')?.value).toBe('ACWR 1.12');
  });
});

describe('constructAttemptPreview', () => {
  it('uses canonical attempt jumps', () => {
    const preview = constructAttemptPreview(200, 'squat_dl');
    expect(preview.second).toContain('kg');
    expect(preview.third).toContain('kg');
  });
});

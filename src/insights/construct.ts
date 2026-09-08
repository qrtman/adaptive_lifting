import { calculateAttemptJumps } from '../services/mathEngine';
import type { LiftFilterValue } from '../components/LiftFilter';

export type InsightTimeRange = 'All' | '30d' | '90d';
export type InsightLift = 'Squat' | 'Bench' | 'Deadlift';

export type TrendPoint = {
  date: string;
  exercise: string;
  variation?: string;
  liftCategory?: string;
  weight: number;
  reps: number;
  rpe: number;
  e1rm: number;
  volume: number;
};

export type InsightKpi = {
  id: string;
  label: string;
  value: string;
  className?: string;
};

export type InsightChartId = 'e1rm' | 'tonnage' | 'acwr';

export const INSIGHT_CHARTS: ReadonlyArray<{ id: InsightChartId; label: string }> = [
  { id: 'e1rm', label: 'e1RM' },
  { id: 'tonnage', label: 'Tonnage' },
  { id: 'acwr', label: 'ACWR' },
];

export const INSIGHT_LAYOUT = ['kpis', 'inol', 'ai', 'chart', 'attempts'] as const;
export type InsightSection = (typeof INSIGHT_LAYOUT)[number];

export function classifyLift(exercise: string, liftCategory?: string): InsightLift | 'Other' {
  if (liftCategory === 'Squat' || liftCategory === 'Bench' || liftCategory === 'Deadlift') {
    return liftCategory;
  }
  const title = exercise.toLowerCase();
  if (title.includes('squat')) return 'Squat';
  if (title.includes('bench')) return 'Bench';
  if (title.includes('dead')) return 'Deadlift';
  return 'Other';
}

export function cutoffDate(timeRange: InsightTimeRange, now = new Date()): string | null {
  if (timeRange === 'All') return null;
  const limit = new Date(now);
  limit.setDate(limit.getDate() - (timeRange === '30d' ? 30 : 90));
  return limit.toISOString().split('T')[0];
}

export function filterTrends(
  trends: TrendPoint[],
  timeRange: InsightTimeRange,
  lift: LiftFilterValue,
  now?: Date,
): TrendPoint[] {
  const cutoff = cutoffDate(timeRange, now);
  return trends.filter((point) => {
    if (cutoff && point.date < cutoff) return false;
    if (lift === 'All') return true;
    return classifyLift(point.exercise, point.liftCategory) === lift;
  });
}

export function peakE1RM(trends: TrendPoint[], lift: InsightLift): number {
  const points = trends.filter((p) => classifyLift(p.exercise, p.liftCategory) === lift);
  if (points.length === 0) return 0;
  return Math.max(...points.map((p) => p.e1rm));
}

export type AcwrStatus = {
  status: string;
  className: string;
  description: string;
};

export function constructAcwrStatus(trends: TrendPoint[], analytics: any): AcwrStatus {
  if (analytics?.fatigue_metrics) {
    const acwr = analytics.fatigue_metrics.acute_chronic_ratio;
    if (acwr < 0.8) {
      return { status: 'Under-training', className: 'text-amber-400', description: `ACWR ${acwr}` };
    }
    if (acwr > 1.5) {
      return { status: 'Danger', className: 'text-red-500', description: `ACWR ${acwr} high` };
    }
    if (acwr > 1.3) {
      return { status: 'Elevated', className: 'text-orange-500', description: `ACWR ${acwr} elevated` };
    }
    return { status: 'Balanced', className: 'text-[#007AFF]', description: `ACWR ${acwr}` };
  }

  const daily: Record<string, number> = {};
  trends.forEach((p) => {
    daily[p.date] = (daily[p.date] || 0) + p.volume;
  });
  const dates = Object.keys(daily).sort();
  if (dates.length < 2) {
    return { status: 'Baseline', className: 'text-amber-400', description: 'Need more sessions for ACWR' };
  }

  const recent = dates.slice(-3);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push(daily[recent[i]] - daily[recent[i - 1]]);
  }
  const netDelta = deltas.reduce((acc, d) => acc + d, 0);
  if (netDelta > 1200) {
    return { status: 'Rising load', className: 'text-[#34C759]', description: `Δ ${Math.round(netDelta)}kg` };
  }
  if (netDelta < -1500) {
    return { status: 'Fatigue', className: 'text-orange-500', description: `Δ ${Math.round(netDelta)}kg` };
  }
  return { status: 'Balanced', className: 'text-[#007AFF]', description: `Δ ${Math.round(netDelta)}kg` };
}

export function constructInsightKpis(trends: TrendPoint[], analytics: any): InsightKpi[] {
  const acwr = constructAcwrStatus(trends, analytics);
  const formatPeak = (lift: InsightLift) => {
    const peak = peakE1RM(trends, lift);
    return peak > 0 ? String(Math.round(peak)) : '—';
  };
  const vol = trends.reduce((acc, p) => acc + p.volume, 0);
  const dots = analytics?.dots_score > 0 ? String(analytics.dots_score) : '—';
  const acwrValue = analytics?.fatigue_metrics?.acute_chronic_ratio != null
    ? `ACWR ${analytics.fatigue_metrics.acute_chronic_ratio}`
    : acwr.status;

  return [
    { id: 'sq', label: 'SQ', value: formatPeak('Squat') },
    { id: 'bp', label: 'BP', value: formatPeak('Bench') },
    { id: 'dl', label: 'DL', value: formatPeak('Deadlift') },
    { id: 'vol', label: 'Vol', value: `${(vol / 1000).toFixed(1)}t` },
    { id: 'dots', label: 'DOTS', value: dots },
    { id: 'acwr', label: 'ACWR', value: acwrValue, className: acwr.className },
  ];
}

export function constructInolLine(analytics: any): string | null {
  const fatigue = analytics?.fatigue_metrics;
  if (!fatigue) return null;
  return `INOL W · SQ ${fatigue.weekly_inol_squat} · BP ${fatigue.weekly_inol_bench} · DL ${fatigue.weekly_inol_deadlift}`;
}

export function constructAttemptPreview(
  opener: number,
  profile: 'squat_dl' | 'bench',
): { second: string; third: string } {
  const jumps = calculateAttemptJumps(opener, profile, 'MALE');
  return { second: jumps.suggested_second, third: jumps.third_ceiling };
}

import { MicrocycleData, WorkoutData } from '../types';

export const FALLBACK_SESSION_DATE = '2026-09-01';

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function firstUsableDate(
  candidates: Array<string | null | undefined>,
  fallback = FALLBACK_SESSION_DATE,
): string {
  for (const value of candidates) {
    if (isIsoDate(value)) return value;
  }
  return fallback;
}

export function firstPlanDate(
  microcycles: MicrocycleData[],
  fallback = FALLBACK_SESSION_DATE,
): string {
  for (const micro of microcycles) {
    for (const workout of micro.workouts) {
      if (isIsoDate(workout.date)) return workout.date;
    }
  }
  return fallback;
}

function parseUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const date = parseUtc(iso);
  const utcDay = date.getUTCDay();
  const offset = utcDay === 0 ? -6 : 1 - utcDay;
  date.setUTCDate(date.getUTCDate() + offset);
  return formatUtc(date);
}

function dayIndex(label: string): number {
  if (!label) return Number.POSITIVE_INFINITY;
  const n = Number(label.replace(/^D/i, ''));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function workoutDateSpan(workouts: WorkoutData[]): { start: string; end: string } | null {
  const dates = workouts.map((w) => w.date).filter(isIsoDate).sort();
  if (dates.length === 0) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

export function formatDateSpan(span: { start: string; end: string } | null): string {
  if (!span) return '—';
  if (span.start === span.end) return span.start;
  return `${span.start} – ${span.end}`;
}

export function insertWorkoutChronologically(
  workouts: WorkoutData[],
  workout: WorkoutData,
): WorkoutData[] {
  return [...workouts, workout]
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return dayIndex(a.dayLabel) - dayIndex(b.dayLabel);
    })
    .map((w, index) => ({ ...w, dayLabel: `D${index + 1}` }));
}

export function inferMicrocycleId(
  date: string,
  microcycles: MicrocycleData[],
  fallbackId: string,
): string {
  const occupying = microcycles.filter((m) => m.workouts.some((w) => w.date === date));
  if (occupying.length === 1) return occupying[0].id;

  const spanning = microcycles.filter((m) => {
    const dates = m.workouts.map((w) => w.date).filter(isIsoDate).sort();
    if (dates.length === 0) return false;
    return date >= dates[0] && date <= dates[dates.length - 1];
  });
  if (spanning.length === 1) return spanning[0].id;

  if (!isIsoDate(date)) return fallbackId;
  const targetMonday = mondayOf(date);
  const sameWeek = microcycles.filter((m) => {
    const mondays = new Set(m.workouts.map((w) => w.date).filter(isIsoDate).map(mondayOf));
    return mondays.has(targetMonday);
  });
  if (sameWeek.length === 1) return sameWeek[0].id;

  return fallbackId;
}

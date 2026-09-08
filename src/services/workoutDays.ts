import { MicrocycleData, WorkoutData } from '../types';

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
    if (m.workouts.length === 0) return false;
    const dates = m.workouts.map((w) => w.date).sort();
    return date >= dates[0] && date <= dates[dates.length - 1];
  });
  if (spanning.length === 1) return spanning[0].id;

  const sameWeek = microcycles.filter((m) => {
    const mondays = new Set(m.workouts.map((w) => mondayOf(w.date)));
    return mondays.has(mondayOf(date));
  });
  if (sameWeek.length === 1) return sameWeek[0].id;

  return fallbackId;
}

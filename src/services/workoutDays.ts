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

export function addUtcDays(iso: string, days: number): string {
  const date = parseUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtc(date);
}

/**
 * Calendar placement for a session. Stored ISO dates win. Undated sessions
 * (imports that had no calendar column) occupy origin + week*7 + day index
 * so Calendar and Insights still have a day to show.
 */
export function sessionCalendarDate(
  workout: Pick<WorkoutData, 'date'>,
  microIndex: number,
  workoutIndex: number,
  origin = FALLBACK_SESSION_DATE,
): string {
  if (isIsoDate(workout.date)) return workout.date;
  return addUtcDays(origin, microIndex * 7 + workoutIndex);
}

export type PlacedSession = {
  workout: WorkoutData;
  micro: MicrocycleData;
  microIndex: number;
  workoutIndex: number;
  date: string;
};

export function placedSessions(microcycles: MicrocycleData[]): PlacedSession[] {
  const placed: PlacedSession[] = [];
  microcycles.forEach((micro, microIndex) => {
    micro.workouts.forEach((workout, workoutIndex) => {
      placed.push({
        workout,
        micro,
        microIndex,
        workoutIndex,
        date: sessionCalendarDate(workout, microIndex, workoutIndex),
      });
    });
  });
  return placed;
}

export function microcycleCalendarSpan(
  micro: MicrocycleData,
  microIndex: number,
  origin = FALLBACK_SESSION_DATE,
): { start: string; end: string } | null {
  if (micro.workouts.length === 0) return null;
  const dates = micro.workouts
    .map((workout, workoutIndex) => sessionCalendarDate(workout, microIndex, workoutIndex, origin))
    .sort();
  return { start: dates[0], end: dates[dates.length - 1] };
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

export function sundayOf(iso: string): string {
  return addUtcDays(mondayOf(iso), 6);
}

export function utcDayDiff(later: string, earlier: string): number {
  return Math.round((parseUtc(later).getTime() - parseUtc(earlier).getTime()) / 86_400_000);
}

export function rangesOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Coach-set inclusive range, or null when missing or inverted. */
export function storedMicrocycleBounds(
  micro: Pick<MicrocycleData, 'startDate' | 'endDate'>,
): { start: string; end: string } | null {
  if (!isIsoDate(micro.startDate) || !isIsoDate(micro.endDate)) return null;
  if (micro.startDate > micro.endDate) return null;
  return { start: micro.startDate, end: micro.endDate };
}

/**
 * Default lock range: ISO Monday–Sunday that contains the placed sessions,
 * or a 7-day slot from the plan origin when the week is empty.
 */
export function derivedMicrocycleBounds(
  micro: MicrocycleData,
  microIndex: number,
  origin = FALLBACK_SESSION_DATE,
): { start: string; end: string } {
  const span = microcycleCalendarSpan(micro, microIndex, origin);
  if (!span) {
    const start = addUtcDays(origin, microIndex * 7);
    return { start, end: addUtcDays(start, 6) };
  }
  return { start: mondayOf(span.start), end: sundayOf(span.end) };
}

export function resolvedMicrocycleBounds(
  micro: MicrocycleData,
  microIndex: number,
  origin = FALLBACK_SESSION_DATE,
): { start: string; end: string } {
  return storedMicrocycleBounds(micro) ?? derivedMicrocycleBounds(micro, microIndex, origin);
}

export function dateInMicrocycle(
  date: string,
  micro: MicrocycleData,
  microIndex: number,
): boolean {
  if (!isIsoDate(date)) return false;
  const { start, end } = resolvedMicrocycleBounds(micro, microIndex);
  return date >= start && date <= end;
}

/** Shift a week by 7 days, then walk forward until it does not overlap existing weeks. */
export function placeCopiedBounds(
  existing: Array<{ start: string; end: string }>,
  source: { start: string; end: string },
): { start: string; end: string } {
  const duration = utcDayDiff(source.end, source.start);
  let start = addUtcDays(source.start, 7);
  for (let i = 0; i < 52; i++) {
    const candidate = { start, end: addUtcDays(start, duration) };
    const blockers = existing.filter((row) => rangesOverlap(row, candidate));
    if (blockers.length === 0) return candidate;
    const latestEnd = blockers.reduce((max, row) => (row.end > max ? row.end : max), blockers[0].end);
    start = addUtcDays(latestEnd, 1);
  }
  return { start, end: addUtcDays(start, duration) };
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

export function eachIsoDate(start: string, end: string): string[] {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) return [];
  const days = utcDayDiff(end, start);
  return Array.from({ length: days + 1 }, (_, index) => addUtcDays(start, index));
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function utcWeekdayShort(iso: string): string {
  if (!isIsoDate(iso)) return '';
  return WEEKDAY_SHORT[parseUtc(iso).getUTCDay()];
}

export function workoutHasLoggedSets(workout: WorkoutData): boolean {
  return workout.exercises.some((exercise) =>
    exercise.sets.some(
      (set) => set.actual != null || set.reps != null || set.executedRpe != null,
    ),
  );
}

export function microcycleHasLoggedSets(micro: MicrocycleData): boolean {
  return micro.workouts.some(workoutHasLoggedSets);
}

export function relabelDayLabels(workouts: WorkoutData[]): WorkoutData[] {
  return [...workouts]
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return dayIndex(a.dayLabel) - dayIndex(b.dayLabel);
    })
    .map((workout, index) => ({ ...workout, dayLabel: `D${index + 1}` }));
}

export function insertWorkoutChronologically(
  workouts: WorkoutData[],
  workout: WorkoutData,
): WorkoutData[] {
  return relabelDayLabels([...workouts, workout]);
}

export function inferMicrocycleId(
  date: string,
  microcycles: MicrocycleData[],
  fallbackId: string,
): string {
  const placed = placedSessions(microcycles);
  const occupying = [...new Set(placed.filter((row) => row.date === date).map((row) => row.micro.id))];
  if (occupying.length === 1) return occupying[0];

  if (!isIsoDate(date)) return fallbackId;

  const spanning = microcycles.filter((micro, microIndex) => dateInMicrocycle(date, micro, microIndex));
  if (spanning.length === 1) return spanning[0].id;

  return fallbackId;
}

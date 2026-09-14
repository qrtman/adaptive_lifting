import type { MovementPattern } from '../../services/exerciseCatalog';
import type { WorkoutData, WorkoutStatus } from '../../types';

export const PATTERN_ABBREV: Record<MovementPattern, string> = {
  'Knee Dominant': 'SQ',
  'Hip Dominant': 'DL',
  'Horizontal Push': 'BP',
  'Vertical Push': 'PP',
  'Horizontal Pull': 'ROW',
  'Vertical Pull': 'PU',
  Misc: 'ACC',
  Weightlifting: 'OLY',
};

export function chipLabel(workout: WorkoutData): string {
  const title = (workout.title || '').trim();
  if (title && title !== 'Session') return title;
  const first = workout.exercises[0];
  const pattern = first?.movementPattern;
  if (pattern && pattern in PATTERN_ABBREV) return PATTERN_ABBREV[pattern];
  return title || 'Session';
}

export function chipStatusClass(status: WorkoutStatus | string): string {
  if (status === 'COMPLETED' || status === 'Completed') return 'text-ok border-ok/40';
  if (status === 'IN_PROGRESS' || status === 'Today') return 'text-syncing border-syncing/40';
  if (status === 'MISSED') return 'text-missed border-border';
  return 'text-prescribed border-border';
}

export function compactTonnage(kg: number): string | null {
  if (!kg || kg <= 0) return null;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)}kg`;
}

export function chipMeta(workout: WorkoutData): string | null {
  const sets = workout.summary?.setCount
    ?? workout.exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const tonnage = workout.summary?.tonnage ?? workout.tonnage;
  const parts: string[] = [];
  if (sets > 0) parts.push(`${sets}s`);
  const compact = compactTonnage(tonnage);
  if (compact) parts.push(compact);
  return parts.length ? parts.join(' ') : null;
}

export function overflowChips<T>(items: T[], max = 3): { shown: T[]; overflow: number } {
  if (items.length <= max) return { shown: items, overflow: 0 };
  return { shown: items.slice(0, max), overflow: items.length - max };
}

export function rescheduleFields(date: string): { date: string } {
  return { date };
}

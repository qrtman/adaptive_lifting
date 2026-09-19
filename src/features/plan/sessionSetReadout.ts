import { isWorkoutCompleted, isWorkoutInProgress } from '../../types';
import { trainingNumber } from '../../services/numericTraining';

/** Compact Plan/Log cell. Omit missing pieces — never `—×5@8`. */
export function formatSetReadout(kg: unknown, reps: unknown, rpe: unknown): string {
  const w = trainingNumber(kg);
  const r = trainingNumber(reps);
  const p = trainingNumber(rpe);
  if (w == null && r == null && p == null) return '—';
  let load = '';
  if (w != null && r != null) load = `${w} × ${r}`;
  else if (w != null) load = String(w);
  else if (r != null) load = String(r);
  if (p == null) return load || '—';
  return load ? `${load} @ ${p}` : String(p);
}

export function formatSessionStatusMeta(status: string, tonnage: unknown): string | null {
  const bits: string[] = [];
  if (isWorkoutCompleted(status)) bits.push('Done');
  else if (isWorkoutInProgress(status)) bits.push('Live');
  else if (status === 'MISSED') bits.push('Missed');
  const load = trainingNumber(tonnage);
  if (load != null && load > 0) bits.push(`${load} kg`);
  return bits.length ? bits.join(' · ') : null;
}

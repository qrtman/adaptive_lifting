import { isWorkoutCompleted, isWorkoutInProgress, type SetData } from '../../types';
import { calculateE1RM } from '../../services/mathEngine';
import { trainingIntOrZero, trainingNumber, trainingOrZero } from '../../services/numericTraining';

/** Per-lift metrics from valid logged sets only; planned values never fill gaps. */
export function getLoggedLiftSummary(sets: readonly SetData[]): {
  topE1RM: number | null;
  tonnage: number | null;
  avgIntensityPct: number | null;
} {
  let top = 0;
  let tonnage = 0;
  let intensityTotal = 0;
  let intensityCount = 0;
  for (const set of sets) {
    if (set.scope === 'plan') continue;
    const weight = trainingOrZero(set.actual);
    const reps = trainingIntOrZero(set.reps);
    if (weight <= 0 || reps <= 0) continue;
    tonnage += weight * reps;
    const rpe = trainingOrZero(set.executedRpe);
    const e1RM = calculateE1RM(weight, reps, rpe);
    top = Math.max(top, e1RM);
    if (rpe > 0 && e1RM > 0) {
      intensityTotal += (weight / e1RM) * 100;
      intensityCount += 1;
    }
  }
  return {
    topE1RM: top > 0 ? top : null,
    tonnage: tonnage > 0 ? tonnage : null,
    avgIntensityPct: intensityCount > 0 ? Math.round(intensityTotal / intensityCount) : null,
  };
}

/** Highest e1RM from logged sets only, using the same inputs as the session Log grid. */
export function getTopLoggedE1RM(sets: readonly SetData[]): number | null {
  return getLoggedLiftSummary(sets).topE1RM;
}

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

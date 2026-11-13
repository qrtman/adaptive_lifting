import { getRpePercentage } from '../../services/mathEngine';
import { trainingIntOrZero, trainingNumber, trainingOrZero } from '../../services/numericTraining';

/**
 * Per-lift summaries (session sheet phase 7, `.cursor/rules/session-sheet.mdc`).
 * Only per lift: NL · Volume · Int. Sessions and rail days show set counts only — totals
 * across different lifts mean nothing.
 */

type SetRecord = Record<string, any>;

export type PlanSummary = { sets: number; nl: number; volume: number; intensityPct: number | null };
export type LogSummary = { logged: number; planned: number; nl: number; volume: number };

const isPlan = (set: SetRecord) => set.scope !== 'log';
/** A Log set counts as logged once it has a weight. */
export const isLogged = (set: SetRecord) => set.scope !== 'plan' && trainingNumber(set.actual) != null;

/** Planned intensity of one Plan set in %1RM: the % itself, or RPE × reps through the RPE table. */
function plannedIntensity(set: SetRecord): number | null {
  const reps = trainingIntOrZero(set.plannedReps);
  const target = trainingOrZero(set.target_value ?? set.plannedRpe);
  if (reps <= 0 || target <= 0) return null;
  const pct = set.intensity_type === 'PERCENT' ? target : getRpePercentage(reps, target) * 100;
  return pct > 0 ? pct : null;
}

export function planSummary(sets: readonly SetRecord[]): PlanSummary {
  const plan = sets.filter(isPlan);
  const intensities = plan.map(plannedIntensity).filter((v): v is number => v != null);
  return {
    sets: plan.length,
    nl: plan.reduce((sum, set) => sum + trainingIntOrZero(set.plannedReps), 0),
    volume: plan.reduce((sum, set) => sum + trainingOrZero(set.plannedWeight) * trainingIntOrZero(set.plannedReps), 0),
    intensityPct: intensities.length ? Math.round(intensities.reduce((a, b) => a + b, 0) / intensities.length) : null,
  };
}

export function logSummary(sets: readonly SetRecord[]): LogSummary {
  const logged = sets.filter(isLogged);
  return {
    logged: logged.length,
    planned: sets.filter(isPlan).length,
    nl: logged.reduce((sum, set) => sum + trainingIntOrZero(set.reps), 0),
    volume: logged.reduce((sum, set) => sum + trainingOrZero(set.actual) * trainingIntOrZero(set.reps), 0),
  };
}

export const formatKg = (kg: number) => `${Math.round(kg).toLocaleString('en-US')} kg`;
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** `4 sets · NL 18 · 2,400 kg · 78%` — parts with no value are left out. */
export function planSummaryText(plan: PlanSummary): string {
  return [
    plural(plan.sets, 'set'),
    plan.nl > 0 ? `NL ${plan.nl}` : '',
    plan.volume > 0 ? formatKg(plan.volume) : '',
    plan.intensityPct != null ? `${plan.intensityPct}%` : '',
  ].filter(Boolean).join(' · ');
}

/** `3 / 4 · 1,750 kg`; with no Plan sets just the logged count. */
export function logSummaryText(log: LogSummary): string {
  const count = log.planned > 0 ? `${log.logged} / ${log.planned}` : plural(log.logged, 'set');
  return [count, log.volume > 0 ? formatKg(log.volume) : ''].filter(Boolean).join(' · ');
}

/** Session header in Both / Log: logged sets of all lifts against planned ones. */
export function sessionLogged(exercises: ReadonlyArray<{ sets: readonly SetRecord[] }>): { logged: number; planned: number } {
  let logged = 0;
  let planned = 0;
  for (const exercise of exercises) {
    logged += exercise.sets.filter(isLogged).length;
    planned += exercise.sets.filter(isPlan).length;
  }
  return { logged, planned };
}

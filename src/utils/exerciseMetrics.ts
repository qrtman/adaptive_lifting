import type { SetData } from '../types';
import { calculateE1RM } from './mathUtils';

export function calculateINOL(reps: number, intensityPct: number): number {
  if (reps <= 0 || intensityPct <= 0) return 0;
  if (intensityPct >= 100) return reps;
  return reps / (100 - intensityPct);
}

export function hasPrescription(set: SetData): boolean {
  return (
    set.plannedReps != null
    || set.plannedWeight != null
    || set.plannedRpe != null
    || set.target_value != null
    || set.baseline_e1rm != null
  );
}

export function isLoggedSet(set: SetData): boolean {
  return set.actual != null && set.actual > 0 && set.reps != null && set.reps > 0;
}

export interface ExerciseBlockMetrics {
  execTonnage: number;
  prescTonnage: number;
  prescSetCount: number;
  execSetCount: number;
  avgIntensityPct: number | null;
  inol: number;
  topE1rm: number;
  inolRisk: 'low' | 'moderate' | 'high' | 'none';
}

export function computeExerciseBlockMetrics(sets: SetData[]): ExerciseBlockMetrics {
  let execTonnage = 0;
  let prescTonnage = 0;
  let prescSetCount = 0;
  let execSetCount = 0;
  let inol = 0;
  let topE1rm = 0;
  const intensitySamples: number[] = [];

  for (const set of sets) {
    if (hasPrescription(set)) {
      prescSetCount += 1;
      if (set.plannedWeight != null && set.plannedReps != null) {
        prescTonnage += set.plannedWeight * set.plannedReps;
      }
    }

    if (!isLoggedSet(set)) continue;

    execSetCount += 1;
    const weight = set.actual!;
    const reps = set.reps!;
    execTonnage += weight * reps;

    const rpe = set.executedRpe || 0;
    const setE1rm = rpe > 0 ? calculateE1RM(weight, reps, rpe) : 0;
    if (setE1rm > topE1rm) topE1rm = setE1rm;
  }

  const refE1rm = topE1rm;
  if (refE1rm > 0) {
    for (const set of sets) {
      if (!isLoggedSet(set) || !set.executedRpe) continue;
      const intensityPct = (set.actual! / refE1rm) * 100;
      intensitySamples.push(intensityPct);
      inol += calculateINOL(set.reps!, intensityPct);
    }
  }

  const avgIntensityPct = intensitySamples.length > 0
    ? intensitySamples.reduce((a, b) => a + b, 0) / intensitySamples.length
    : null;

  let inolRisk: ExerciseBlockMetrics['inolRisk'] = 'none';
  if (inol > 0) {
    if (inol < 1) inolRisk = 'low';
    else if (inol <= 2) inolRisk = 'moderate';
    else inolRisk = 'high';
  }

  return {
    execTonnage,
    prescTonnage,
    prescSetCount,
    execSetCount,
    avgIntensityPct,
    inol,
    topE1rm: refE1rm,
    inolRisk,
  };
}

export function formatKg(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

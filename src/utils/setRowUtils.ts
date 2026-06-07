import type { SetData } from '../types';

export function pickPrescriptionFields(source: SetData): Partial<SetData> {
  return {
    label: source.label,
    plannedWeight: source.plannedWeight,
    plannedReps: source.plannedReps,
    plannedRpe: source.plannedRpe,
    dropPercent: source.dropPercent,
    isAuto: source.isAuto,
    intensity_type: source.intensity_type,
    target_value: source.target_value,
    adjustment_pct: source.adjustment_pct,
    baseline_e1rm: source.baseline_e1rm,
  };
}

export function pickLogFields(source: SetData): Partial<SetData> {
  return {
    actual: source.actual,
    reps: source.reps,
    executedRpe: source.executedRpe,
    velocity: source.velocity,
    readiness: source.readiness,
    hrv: source.hrv,
    note: source.note,
    isTop: source.isTop,
  };
}

export function createAdHocSet(label = 'Main Set'): SetData {
  return {
    id: `set-run-${Date.now()}`,
    label,
    plannedWeight: null,
    plannedReps: null,
    plannedRpe: null,
    actual: null,
    reps: null,
    executedRpe: null,
  };
}

export function reorderSets(sets: SetData[], fromIdx: number, toIdx: number): SetData[] {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= sets.length || toIdx >= sets.length) {
    return sets;
  }
  const next = [...sets];
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return next;
}

export function duplicatePrescriptionSet(source: SetData): SetData {
  return {
    id: `set-dup-${Date.now()}`,
    label: source.label,
    plannedWeight: source.plannedWeight,
    plannedReps: source.plannedReps,
    plannedRpe: source.plannedRpe,
    dropPercent: source.dropPercent,
    isAuto: source.isAuto,
    intensity_type: source.intensity_type,
    target_value: source.target_value,
    adjustment_pct: source.adjustment_pct,
    baseline_e1rm: source.baseline_e1rm,
    actual: null,
    reps: null,
    executedRpe: null,
    isTop: false,
  };
}

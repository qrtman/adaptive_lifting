import { SetData } from '../types';

export type PrescriptionMode = 'RPE_TARGET' | 'PERCENTAGE' | 'AMRAP' | 'TOP_SET_BACKDOWN' | 'HYBRID';

export type StructuredPrescription = {
  mode: PrescriptionMode;
  sets: number;
  reps: number;
  target_rpe: number;
  percent: number;
  weight: number | null;
  top_reps: number;
  top_rpe: number;
  backdown_sets: number;
  backdown_reps: number;
  fatigue_drop_percent: number;
  volume_sets: number;
  volume_reps: number;
  volume_percent: number;
};

export const DEFAULT_PRESCRIPTION: StructuredPrescription = {
  mode: 'RPE_TARGET',
  sets: 3,
  reps: 5,
  target_rpe: 8,
  percent: 75,
  weight: null,
  top_reps: 3,
  top_rpe: 8,
  backdown_sets: 3,
  backdown_reps: 3,
  fatigue_drop_percent: 5,
  volume_sets: 5,
  volume_reps: 5,
  volume_percent: 70,
};

function setId(exerciseId: string, index: number): string {
  return `${exerciseId}-s${index + 1}`;
}

function baseSet(
  exerciseId: string,
  index: number,
  label: string,
  fields: Partial<SetData>
): SetData {
  return {
    id: setId(exerciseId, index),
    label,
    plannedWeight: fields.plannedWeight ?? null,
    plannedReps: fields.plannedReps ?? null,
    plannedRpe: fields.plannedRpe ?? null,
    intensity_type: fields.intensity_type ?? 'RPE',
    target_value: fields.target_value,
    adjustment_pct: fields.adjustment_pct ?? 0,
    dropPercent: fields.dropPercent ?? 0,
    isTop: fields.isTop ?? false,
    isAuto: fields.isAuto ?? false,
    actual: null,
    reps: null,
    executedRpe: null,
  };
}

export function prescriptionPreview(p: StructuredPrescription): string {
  switch (p.mode) {
    case 'RPE_TARGET':
      return `${p.sets}×${p.reps} @ ${p.target_rpe} RPE`;
    case 'PERCENTAGE':
      return `${p.sets}×${p.reps} @ ${p.percent}%`;
    case 'AMRAP':
      return `1×AMRAP @ ${p.percent}%`;
    case 'TOP_SET_BACKDOWN':
      return `1×${p.top_reps} @ ${p.top_rpe} RPE, ${p.backdown_sets}×${p.backdown_reps} @ ${p.fatigue_drop_percent}% drop`;
    case 'HYBRID':
      return `1×${p.top_reps} @ ${p.top_rpe} RPE, ${p.volume_sets}×${p.volume_reps} @ ${p.volume_percent}%`;
    default:
      return '';
  }
}

export function buildSetsFromPrescription(exerciseId: string, p: StructuredPrescription): SetData[] {
  const weight = p.weight;
  if (p.mode === 'RPE_TARGET') {
    const count = Math.max(1, Math.round(p.sets));
    return Array.from({ length: count }, (_, i) =>
      baseSet(exerciseId, i, i === 0 ? 'Top Set' : `Set ${i + 1}`, {
        plannedWeight: weight,
        plannedReps: p.reps,
        plannedRpe: p.target_rpe,
        intensity_type: 'RPE',
        target_value: p.target_rpe,
        isTop: i === 0,
      })
    );
  }
  if (p.mode === 'PERCENTAGE') {
    const count = Math.max(1, Math.round(p.sets));
    return Array.from({ length: count }, (_, i) =>
      baseSet(exerciseId, i, i === 0 ? 'Top Set' : `Set ${i + 1}`, {
        plannedWeight: weight,
        plannedReps: p.reps,
        plannedRpe: null,
        intensity_type: 'PERCENT',
        target_value: p.percent,
        isTop: i === 0,
      })
    );
  }
  if (p.mode === 'AMRAP') {
    return [
      baseSet(exerciseId, 0, 'AMRAP', {
        plannedWeight: weight,
        plannedReps: null,
        plannedRpe: null,
        intensity_type: 'PERCENT',
        target_value: p.percent,
        isTop: true,
      }),
    ];
  }
  if (p.mode === 'TOP_SET_BACKDOWN') {
    const drop = -Math.abs(p.fatigue_drop_percent);
    const top = baseSet(exerciseId, 0, 'Top Set', {
      plannedWeight: weight,
      plannedReps: p.top_reps,
      plannedRpe: p.top_rpe,
      intensity_type: 'RPE',
      target_value: p.top_rpe,
      isTop: true,
    });
    const backdowns = Array.from({ length: Math.max(0, Math.round(p.backdown_sets)) }, (_, i) =>
      baseSet(exerciseId, i + 1, `Backdown ${i + 1}`, {
        plannedWeight: weight,
        plannedReps: p.backdown_reps,
        plannedRpe: p.top_rpe,
        intensity_type: 'RPE',
        target_value: p.top_rpe,
        adjustment_pct: drop / 100,
        dropPercent: drop,
        isAuto: true,
      })
    );
    return [top, ...backdowns];
  }
  const top = baseSet(exerciseId, 0, 'Top Set', {
    plannedWeight: weight,
    plannedReps: p.top_reps,
    plannedRpe: p.top_rpe,
    intensity_type: 'RPE',
    target_value: p.top_rpe,
    isTop: true,
  });
  const volume = Array.from({ length: Math.max(0, Math.round(p.volume_sets)) }, (_, i) =>
    baseSet(exerciseId, i + 1, `Volume ${i + 1}`, {
      plannedWeight: weight,
      plannedReps: p.volume_reps,
      plannedRpe: null,
      intensity_type: 'PERCENT',
      target_value: p.volume_percent,
    })
  );
  return [top, ...volume];
}

export function prescriptionIsValid(p: StructuredPrescription): string | null {
  if (p.mode === 'RPE_TARGET' || p.mode === 'PERCENTAGE') {
    if (p.sets < 1) return 'Need at least 1 set.';
    if (p.reps < 1) return 'Need at least 1 rep.';
  }
  if (p.mode === 'TOP_SET_BACKDOWN' && p.top_reps < 1) return 'Top set needs reps.';
  if (p.mode === 'HYBRID' && p.top_reps < 1) return 'Top set needs reps.';
  return null;
}

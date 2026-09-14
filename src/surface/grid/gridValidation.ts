import { trainingInt, trainingNumber } from '../../services/numericTraining';
import type { GridColKey } from './gridTypes';

export type ValidOk = { ok: true; value: number | string | null };
export type ValidErr = { ok: false; reason: string };
export type ValidResult = ValidOk | ValidErr;

function rpeStep(value: number): boolean {
  return Number.isInteger(value * 2);
}

export function validateCell(col: GridColKey, raw: string): ValidResult {
  const trimmed = raw.trim();
  if (col === 'note') return { ok: true, value: raw };
  if (trimmed === '' || trimmed === '—' || trimmed === '-') return { ok: true, value: null };

  if (col === 'plannedReps' || col === 'reps') {
    const parsed = trainingInt(trimmed);
    if (parsed === null || parsed < 0) return { ok: false, reason: 'Reps must be an integer ≥ 0' };
    return { ok: true, value: parsed };
  }

  if (col === 'plannedRpe' || col === 'executedRpe') {
    const parsed = trainingNumber(trimmed);
    if (parsed === null) return { ok: false, reason: 'RPE must be a number' };
    if (parsed < 6 || parsed > 10) return { ok: false, reason: 'RPE must be 6.0–10.0' };
    if (!rpeStep(parsed)) return { ok: false, reason: 'RPE steps are 0.5' };
    return { ok: true, value: parsed };
  }

  if (col === 'plannedWeight' || col === 'actual') {
    const parsed = trainingNumber(trimmed);
    if (parsed === null || parsed < 0) return { ok: false, reason: 'Load must be ≥ 0 kg' };
    return { ok: true, value: parsed };
  }

  return { ok: false, reason: 'This cell is read-only' };
}

export function displayValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

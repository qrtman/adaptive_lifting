import { calculateCapacityScaledWeight, calculateE1RM, calculateWeightFromE1RM, roundToCompetitionPlates } from './mathEngine';
import { trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';

export type LiftAdjMode = 'kg' | 'pct';

export const LIFT_ADJ_KG_STEP = 2.5;
export const LIFT_ADJ_PCT_STEP = 1;
export const LIFT_ADJ_MINUS = '\u2212';

export const LIFT_ADJ_COPY = {
  noRemaining: 'Nothing left to adj this lift.',
  noAnchor: 'Type Plan kg or log a set first.',
  scope: 'Remaining unlogged sets this lift',
} as const;

export type LiftAdjPreview = {
  count: number;
  fromKg: number;
  toKg: number;
};

export type LiftAdjPatch = {
  index: number;
  plannedWeight: number;
};

function executedE1RM(row: Record<string, unknown>): number {
  return calculateE1RM(
    trainingOrZero(row.actual),
    trainingIntOrZero(row.reps),
    trainingOrZero(row.executedRpe),
  );
}

function suggestKg(row: Record<string, unknown>, e1rm: number): number | null {
  const reps = trainingIntOrZero(row.plannedReps);
  const intensity = String(row.intensity_type || row.intensityType || 'RPE');
  const target = trainingOrZero(row.target_value ?? (intensity === 'PERCENT' ? null : row.plannedRpe));
  if (e1rm <= 0 || reps <= 0 || target <= 0) return null;
  const raw = intensity === 'PERCENT'
    ? calculateCapacityScaledWeight(e1rm, 'PERCENT', target, reps)
    : roundToCompetitionPlates(calculateWeightFromE1RM(e1rm, reps, target));
  return raw > 0 ? raw : null;
}

/** Show `use {n}` when suggestion exists and differs from typed Plan kg (empty counts as differ). */
export function planKgOfferKg(
  suggestedWeight: number | null,
  plannedWeight: unknown,
): number | null {
  if (suggestedWeight == null || suggestedWeight <= 0) return null;
  const planned = trainingNumber(plannedWeight);
  if (planned === suggestedWeight) return null;
  return suggestedWeight;
}

/**
 * Typed plan kg stays until the athlete accepts `use {n}`.
 * After a log with executed e1RM > 0, later rows get a client-derived suggestedWeight
 * even when plannedWeight is already filled. `dropPercent` on later sets scales that
 * offer: roundToCompetitionPlates(suggestKg * (1 + pct/100)). Set 0 has no % (treat as 0).
 * Rows with LOG kg (actual) get none. Never auto-writes plannedWeight.
 */
export function refreshSetAnchors<T extends Record<string, unknown>>(
  setArray: T[],
): Array<T & { suggestedWeight: number | null }> {
  if (setArray.length === 0) return [];

  let lastLoggedIndex = -1;
  let lastLoggedE1RM = 0;
  setArray.forEach((row, index) => {
    const e1 = executedE1RM(row);
    if (e1 > 0) {
      lastLoggedIndex = index;
      lastLoggedE1RM = e1;
    }
  });

  const top = setArray[0];
  const topWeight = trainingOrZero(top.actual ?? top.plannedWeight);
  const topReps = trainingIntOrZero(top.reps ?? top.plannedReps);
  const topRpe = trainingOrZero(top.executedRpe ?? top.plannedRpe ?? top.target_value);
  const topE1RM = lastLoggedE1RM > 0 ? lastLoggedE1RM : calculateE1RM(topWeight, topReps, topRpe);

  return setArray.map((row, index) => {
    const plannedWeight = trainingNumber(row.plannedWeight);
    const loggedKg = trainingNumber(row.actual);
    const baseSuggest = lastLoggedE1RM > 0 && index > lastLoggedIndex && loggedKg == null
      ? suggestKg(row, lastLoggedE1RM)
      : null;
    const pct = index === 0 ? 0 : parseDropPercent(row.dropPercent);
    const suggestedWeight = baseSuggest == null ? null : setDropResultKg(baseSuggest, pct);
    return {
      ...row,
      plannedWeight,
      suggestedWeight,
      baseline_e1rm: topE1RM > 0 ? topE1RM : row.baseline_e1rm,
    };
  });
}

function isUnloggedKg(row: { actual?: unknown }): boolean {
  const logged = trainingNumber(row.actual);
  return logged == null || logged <= 0;
}

/** Last LOG kg with actual > 0; else first set plannedWeight if > 0. */
export function liftAdjAnchorKg(
  sets: Array<{ actual?: unknown; plannedWeight?: unknown }>,
): number | null {
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    const logged = trainingNumber(sets[i].actual);
    if (logged != null && logged > 0) return logged;
  }
  const firstPlan = trainingNumber(sets[0]?.plannedWeight);
  if (firstPlan != null && firstPlan > 0) return firstPlan;
  return null;
}

export function liftAdjEligibleIndexes<T extends { actual?: unknown }>(sets: T[]): number[] {
  return sets.reduce<number[]>((acc, row, index) => {
    if (isUnloggedKg(row)) acc.push(index);
    return acc;
  }, []);
}

export function liftAdjDisabledReason(
  sets: Array<{ actual?: unknown; plannedWeight?: unknown }>,
): string | null {
  if (liftAdjEligibleIndexes(sets).length === 0) return LIFT_ADJ_COPY.noRemaining;
  if (liftAdjAnchorKg(sets) == null) return LIFT_ADJ_COPY.noAnchor;
  return null;
}

export function liftAdjRowBase(
  row: { plannedWeight?: unknown },
  anchorKg: number,
): number {
  const planned = trainingNumber(row.plannedWeight);
  return planned != null && planned > 0 ? planned : anchorKg;
}

/** architecture §6.7.2 bar-load drop — not e1RM scaling. Skip if plate-rounded result ≤ 0. */
export function liftAdjResultKg(baseKg: number, mode: LiftAdjMode, delta: number): number | null {
  const raw = mode === 'kg' ? baseKg + delta : baseKg * (1 + delta / 100);
  const rounded = roundToCompetitionPlates(raw);
  return rounded > 0 ? rounded : null;
}

export function parseSignedDelta(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().replace(/[\u2212\u2013\u2014]/g, '-');
  return trainingNumber(text);
}

export function formatSignedDelta(value: number): string {
  if (value === 0) return '0';
  const abs = String(Math.abs(value));
  return value > 0 ? `+${abs}` : `${LIFT_ADJ_MINUS}${abs}`;
}

export function formatLiftAdjPreview(preview: LiftAdjPreview): string {
  return `${preview.count} sets ${preview.fromKg} \u2192 ${preview.toKg}`;
}

/**
 * Preview + patches for remaining unlogged Plan kg on this lift.
 * Does not mutate `sets`. Apply must write plannedWeight only.
 */
export function previewLiftAdj<T extends { actual?: unknown; plannedWeight?: unknown }>(
  sets: T[],
  mode: LiftAdjMode,
  delta: number,
): { preview: LiftAdjPreview | null; patches: LiftAdjPatch[] } {
  const anchor = liftAdjAnchorKg(sets);
  if (anchor == null) return { preview: null, patches: [] };

  const patches: LiftAdjPatch[] = [];
  let fromKg: number | null = null;
  let toKg: number | null = null;
  for (const index of liftAdjEligibleIndexes(sets)) {
    const base = liftAdjRowBase(sets[index], anchor);
    const next = liftAdjResultKg(base, mode, delta);
    if (next == null) continue;
    patches.push({ index, plannedWeight: next });
    if (fromKg == null || toKg == null) {
      fromKg = base;
      toKg = next;
    }
  }
  if (patches.length === 0 || fromKg == null || toKg == null) {
    return { preview: null, patches: [] };
  }
  return {
    preview: { count: patches.length, fromKg, toKg },
    patches,
  };
}

export function applyLiftAdj<T extends Record<string, unknown>>(
  sets: T[],
  patches: LiftAdjPatch[],
): T[] {
  if (patches.length === 0) return sets;
  const byIndex = new Map(patches.map((patch) => [patch.index, patch.plannedWeight]));
  return sets.map((row, index) => {
    const plannedWeight = byIndex.get(index);
    if (plannedWeight == null) return row;
    return { ...row, plannedWeight, isAuto: false };
  });
}

/** Set 0 LOG kg if actual > 0, else set 0 plannedWeight if > 0. Do not invent kg. */
export function setDropAnchorKg(
  sets: Array<{ actual?: unknown; plannedWeight?: unknown }>,
): number | null {
  const top = sets[0];
  if (!top) return null;
  const logged = trainingNumber(top.actual);
  if (logged != null && logged > 0) return logged;
  const planned = trainingNumber(top.plannedWeight);
  if (planned != null && planned > 0) return planned;
  return null;
}

export function parseDropPercent(value: unknown): number {
  const parsed = parseSignedDelta(value);
  return parsed == null ? 0 : Math.round(parsed);
}

/** Plate-round `kg * (1 + pct/100)`. Used to scale the e1RM `use {n}` offer. Skip if ≤ 0. */
export function setDropResultKg(kg: number, pct: number): number | null {
  const rounded = roundToCompetitionPlates(kg * (1 + pct / 100));
  return rounded > 0 ? rounded : null;
}

/**
 * Persist `dropPercent` on a later set (`isAuto: false`). Does not write Plan kg.
 * Set 0 has no `%` — treat as 0 and leave the row unchanged. Does not write
 * `adjustment_pct`. Does not auto-fill extra sets. Committing 0 does not invent kg.
 */
export function applySetDropPercent<T extends Record<string, unknown>>(
  sets: T[],
  index: number,
  pct: number,
): T[] {
  if (index <= 0 || index >= sets.length) return sets;
  const dropPercent = parseDropPercent(pct);
  return sets.map((row, i) => {
    if (i !== index) return row;
    return { ...row, dropPercent, isAuto: false };
  });
}

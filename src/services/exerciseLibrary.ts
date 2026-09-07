/**
 * Canonical exercise database and structured prescription compiler for the
 * Workout Builder (design.md §6.2 / §7.3). All prescriptions are produced as
 * structured numeric SetData — never parsed from freeform text — so the
 * backend fatigue engine (INOL / ACWR / e1RM) stays canonical.
 */

import { ExerciseData, SetData } from '../types';
import { calculateCapacityScaledWeight } from './mathEngine';

export type LiftCategory = 'Squat' | 'Bench' | 'Deadlift' | 'Other';
export type Tier = 'Comp' | 'Variation' | 'Accessory';

export interface CanonicalExercise {
  id: string;
  name: string;
  liftCategory: LiftCategory;
  tier: Tier;
  /** Default anchor e1RM (kg) used to seed prescription weights. Coach-editable after injection. */
  baselineE1RM: number;
}

export const LIFT_CATEGORIES: LiftCategory[] = ['Squat', 'Bench', 'Deadlift', 'Other'];
export const TIERS: Tier[] = ['Comp', 'Variation', 'Accessory'];

export interface TempoOption {
  id: string;
  label: string;
  notation: string;
}

export const TEMPO_OPTIONS: TempoOption[] = [
  { id: 'standard', label: 'Standard', notation: '1-0-1' },
  { id: 'paused', label: 'Paused', notation: '3-2-0' },
  { id: 'slow-ecc', label: 'Slow Eccentric', notation: '3-0-0' },
  { id: 'isometric', label: 'Isometric', notation: '1-3-1' },
];

export interface RomOption {
  id: string;
  label: string;
}

export const ROM_OPTIONS: RomOption[] = [
  { id: 'full', label: 'Full ROM' },
  { id: 'deficit', label: 'Deficit' },
  { id: 'pin', label: 'Pin / Board' },
  { id: 'partial', label: 'Partial' },
];

export const GEAR_OPTIONS: string[] = ['Beltless', 'Bands', 'Chains', 'Wraps/Sleeves', 'SlingShot'];

export type PrescriptionMode = 'RPE_TARGET' | 'PERCENTAGE' | 'AMRAP' | 'TOP_SET_BACKDOWN';

export const PRESCRIPTION_MODES: { id: PrescriptionMode; label: string }[] = [
  { id: 'RPE_TARGET', label: 'RPE Target' },
  { id: 'PERCENTAGE', label: 'Percentage' },
  { id: 'AMRAP', label: 'AMRAP' },
  { id: 'TOP_SET_BACKDOWN', label: 'Top Set + Backdown' },
];

export const CANONICAL_EXERCISES: CanonicalExercise[] = [
  // Competition lifts
  { id: 'comp-squat', name: 'Competition Squat', liftCategory: 'Squat', tier: 'Comp', baselineE1RM: 200 },
  { id: 'comp-bench', name: 'Competition Bench', liftCategory: 'Bench', tier: 'Comp', baselineE1RM: 120 },
  { id: 'comp-deadlift', name: 'Competition Deadlift', liftCategory: 'Deadlift', tier: 'Comp', baselineE1RM: 240 },
  // Squat variations
  { id: 'pause-squat', name: 'Pause Squat', liftCategory: 'Squat', tier: 'Variation', baselineE1RM: 170 },
  { id: 'high-bar-squat', name: 'High Bar Squat', liftCategory: 'Squat', tier: 'Variation', baselineE1RM: 175 },
  { id: 'front-squat', name: 'Front Squat', liftCategory: 'Squat', tier: 'Variation', baselineE1RM: 150 },
  // Bench variations
  { id: 'spoto-press', name: 'Spoto Press', liftCategory: 'Bench', tier: 'Variation', baselineE1RM: 105 },
  { id: 'close-grip-bench', name: 'Close Grip Bench', liftCategory: 'Bench', tier: 'Variation', baselineE1RM: 110 },
  { id: 'larsen-press', name: 'Larsen Press', liftCategory: 'Bench', tier: 'Variation', baselineE1RM: 100 },
  // Deadlift variations
  { id: 'deficit-deadlift', name: 'Deficit Deadlift', liftCategory: 'Deadlift', tier: 'Variation', baselineE1RM: 210 },
  { id: 'block-pull', name: 'Block Pull', liftCategory: 'Deadlift', tier: 'Variation', baselineE1RM: 250 },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', liftCategory: 'Deadlift', tier: 'Variation', baselineE1RM: 180 },
  // Accessories
  { id: 'leg-press', name: 'Leg Press', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 200 },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 60 },
  { id: 'barbell-row', name: 'Barbell Row', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 100 },
  { id: 'pull-up', name: 'Weighted Pull-up', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 40 },
  { id: 'triceps-extension', name: 'Triceps Extension', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 40 },
  { id: 'lateral-raise', name: 'Lateral Raise', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 20 },
  { id: 'hamstring-curl', name: 'Hamstring Curl', liftCategory: 'Other', tier: 'Accessory', baselineE1RM: 60 },
];

export interface BuilderMovement {
  baseName: string;
  liftCategory: LiftCategory;
  tier: Tier;
  tempoId: string;
  romId: string;
  gear: string[];
}

export interface BuilderPrescription {
  mode: PrescriptionMode;
  sets: number;
  reps: number;
  /** RPE value (RPE_TARGET/AMRAP/TOP_SET_BACKDOWN) or percentage of e1RM (PERCENTAGE). */
  intensityValue: number;
  /** TOP_SET_BACKDOWN only: number of backdown sets after the top set. */
  backdownSets: number;
  /** TOP_SET_BACKDOWN only: positive percent load drop applied to backdown sets. */
  backdownDropPct: number;
  baselineE1RM: number;
}

export function defaultMovement(searchSeed = ''): BuilderMovement {
  return {
    baseName: searchSeed,
    liftCategory: 'Squat',
    tier: 'Variation',
    tempoId: 'standard',
    romId: 'full',
    gear: [],
  };
}

export function defaultPrescription(baselineE1RM = 150): BuilderPrescription {
  return {
    mode: 'RPE_TARGET',
    sets: 3,
    reps: 3,
    intensityValue: 8,
    backdownSets: 2,
    backdownDropPct: 5,
    baselineE1RM,
  };
}

/**
 * Compiles the canonical movement name from structured parameters, e.g.
 * "[Beltless] Deficit Pause Squat (3-2-0)". Never the reverse (no parsing).
 */
export function composeExerciseName(movement: BuilderMovement): string {
  const name = (movement.baseName || '').trim() || 'Custom Movement';
  const tempo = TEMPO_OPTIONS.find(t => t.id === movement.tempoId);
  const rom = ROM_OPTIONS.find(r => r.id === movement.romId);

  const gearPrefix = movement.gear.length > 0 ? movement.gear.map(g => `[${g}]`).join(' ') + ' ' : '';
  const romPrefix = rom && rom.id !== 'full' ? `${rom.label} ` : '';
  const tempoWord = tempo && tempo.id !== 'standard' ? `${tempo.label} ` : '';
  const tempoNotation = tempo && tempo.id !== 'standard' ? ` (${tempo.notation})` : '';

  return `${gearPrefix}${romPrefix}${tempoWord}${name}${tempoNotation}`.trim();
}

/** Short descriptor used for the ExerciseCard `variation` line. */
export function composeVariation(movement: BuilderMovement): string {
  const tempo = TEMPO_OPTIONS.find(t => t.id === movement.tempoId);
  const rom = ROM_OPTIONS.find(r => r.id === movement.romId);
  const parts: string[] = [];
  if (tempo) parts.push(tempo.label);
  if (rom) parts.push(rom.label);
  if (movement.gear.length > 0) parts.push(movement.gear.join(' + '));
  return parts.join(' · ') || 'Custom';
}

function tagsFor(movement: BuilderMovement): string[] {
  const tags: string[] = [movement.tier];
  const tempo = TEMPO_OPTIONS.find(t => t.id === movement.tempoId);
  const rom = ROM_OPTIONS.find(r => r.id === movement.romId);
  if (tempo && tempo.id !== 'standard') tags.push(tempo.label);
  if (rom && rom.id !== 'full') tags.push(rom.label);
  for (const g of movement.gear) tags.push(g);
  return tags;
}

/**
 * Produces the structured, numeric set list for a prescription. Weights are
 * derived from the baseline e1RM via the shared capacity-scaling math so the
 * planned load is real, not a freeform string.
 */
export function compilePrescriptionSets(idBase: string, p: BuilderPrescription): SetData[] {
  const baseline = p.baselineE1RM > 0 ? p.baselineE1RM : 150;
  const reps = Math.max(1, Math.round(p.reps));

  const makeSet = (
    index: number,
    label: string,
    intensityType: 'RPE' | 'PERCENT',
    targetValue: number,
    adjustmentPct: number,
    isTop: boolean,
    note?: string,
  ): SetData => ({
    id: `${idBase}-s${index}`,
    label,
    plannedWeight: calculateCapacityScaledWeight(baseline, intensityType, targetValue, reps, adjustmentPct),
    plannedReps: reps,
    plannedRpe: intensityType === 'RPE' ? targetValue : null,
    intensity_type: intensityType,
    target_value: targetValue,
    adjustment_pct: adjustmentPct,
    baseline_e1rm: baseline,
    isTop,
    isAuto: !isTop,
    actual: null,
    reps: null,
    executedRpe: null,
    ...(note ? { note } : {}),
  });

  if (p.mode === 'AMRAP') {
    const rpe = p.intensityValue > 0 ? p.intensityValue : 9;
    return [makeSet(1, 'AMRAP', 'RPE', rpe, 0, true, 'AMRAP')];
  }

  if (p.mode === 'TOP_SET_BACKDOWN') {
    const rpe = p.intensityValue > 0 ? p.intensityValue : 8;
    const sets: SetData[] = [makeSet(1, 'Top Set', 'RPE', rpe, 0, true)];
    const drop = -Math.abs(p.backdownDropPct) / 100;
    const backdownCount = Math.max(0, Math.round(p.backdownSets));
    for (let i = 0; i < backdownCount; i++) {
      sets.push(makeSet(i + 2, 'Backdown', 'RPE', rpe, drop, false, `-${Math.abs(p.backdownDropPct)}% drop`));
    }
    return sets;
  }

  // Straight sets: RPE_TARGET or PERCENTAGE
  const intensityType: 'RPE' | 'PERCENT' = p.mode === 'PERCENTAGE' ? 'PERCENT' : 'RPE';
  const setCount = Math.max(1, Math.round(p.sets));
  const sets: SetData[] = [];
  for (let i = 0; i < setCount; i++) {
    sets.push(makeSet(i + 1, i === 0 ? 'Top Set' : 'Working Set', intensityType, p.intensityValue, 0, i === 0));
  }
  return sets;
}

/** Human-readable, read-only preview lines of the compiled prescription. */
export function prescriptionPreview(p: BuilderPrescription): string {
  const sets = compilePrescriptionSets('preview', p);
  const intensityLabel = (s: SetData) =>
    s.intensity_type === 'PERCENT' ? `${s.target_value}%` : `RPE ${s.target_value}`;

  if (p.mode === 'AMRAP') {
    const s = sets[0];
    return `1 × AMRAP @ ${intensityLabel(s)} → target ${s.plannedWeight}kg`;
  }
  if (p.mode === 'TOP_SET_BACKDOWN') {
    const top = sets[0];
    const back = sets[1];
    const topLine = `Top: 1 × ${top.plannedReps} @ ${intensityLabel(top)} → ${top.plannedWeight}kg`;
    if (!back) return topLine;
    return `${topLine}   Backdown: ${sets.length - 1} × ${back.plannedReps} @ -${Math.abs(p.backdownDropPct)}% → ${back.plannedWeight}kg`;
  }
  const s = sets[0];
  return `${sets.length} × ${s.plannedReps} @ ${intensityLabel(s)} → ${s.plannedWeight}kg each`;
}

/** Builds a complete ExerciseData block ready to inject into a workout. */
export function buildExercise(movement: BuilderMovement, prescription: BuilderPrescription): ExerciseData {
  const idBase = `e-cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sets = compilePrescriptionSets(idBase, prescription);
  const topSet = sets.find(s => s.isTop) || sets[0];
  return {
    id: idBase,
    title: composeExerciseName(movement),
    variation: composeVariation(movement),
    tier: movement.tier,
    liftCategory: movement.liftCategory,
    tags: tagsFor(movement),
    top: topSet ? `${topSet.plannedWeight}kg x ${topSet.plannedReps}` : '—',
    vol: '—',
    sets,
  };
}

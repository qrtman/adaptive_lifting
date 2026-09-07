/**
 * Canonical exercise database for the Workout Builder (design.md §6.2 / §7.3).
 *
 * The builder chooses the MOVEMENT only (name, category, tier, tempo, ROM,
 * gear). Set-by-set prescription is authored afterward inside the exercise
 * card. A single structured starter set is injected so the movement is
 * immediately loggable; all training values stay numeric so the backend
 * fatigue engine (INOL / ACWR / e1RM) remains canonical.
 */

import { ExerciseData, SetData } from '../types';

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
  /** Anchor e1RM (kg) carried onto the starter set so the card can scale loads. */
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
    baselineE1RM: 150,
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
 * Builds an ExerciseData block for the chosen movement with a single blank,
 * structured starter set. The coach authors the actual set prescription
 * (reps / intensity / weight, add / remove sets) inside the exercise card.
 */
export function buildExercise(movement: BuilderMovement): ExerciseData {
  const idBase = `e-cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const baseline = movement.baselineE1RM > 0 ? movement.baselineE1RM : 150;
  const starterSet: SetData = {
    id: `${idBase}-s1`,
    label: 'Set 1',
    plannedWeight: null,
    plannedReps: null,
    plannedRpe: null,
    intensity_type: 'RPE',
    baseline_e1rm: baseline,
    isTop: true,
    isAuto: false,
    actual: null,
    reps: null,
    executedRpe: null,
  };
  return {
    id: idBase,
    title: composeExerciseName(movement),
    variation: composeVariation(movement),
    tier: movement.tier,
    liftCategory: movement.liftCategory,
    tags: tagsFor(movement),
    top: '—',
    vol: '—',
    sets: [starterSet],
  };
}

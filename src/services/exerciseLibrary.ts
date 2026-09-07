/**
 * Canonical movement metadata for the Workout Builder.
 *
 * Design decisions (intentionally diverging from architecture.md):
 * - The shared library holds MOVEMENT METADATA ONLY (name, category, tier).
 *   It never stores e1RM: strength is dynamic, per-athlete performance state,
 *   not a property of the movement.
 * - The builder chooses the movement only. Set-by-set prescription is authored
 *   in the exercise card. A single blank starter set is injected.
 * - Custom movements are owner-scoped (persisted per user via the backend), so
 *   they are reusable by their creator but never leak into the shared list or
 *   to other athletes.
 */

import { ExerciseData, MicrocycleData, SetData } from '../types';
import { calculateE1RM } from './mathEngine';

export type LiftCategory = 'Squat' | 'Bench' | 'Deadlift' | 'Other';
export type Tier = 'Comp' | 'Variation' | 'Accessory';

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

/** Fallback anchor by lift category — used only when the athlete has no history. */
export const DEFAULT_BASELINE_BY_CATEGORY: Record<LiftCategory, number> = {
  Squat: 150,
  Bench: 100,
  Deadlift: 180,
  Other: 60,
};

export function categoryDefaultBaseline(category: LiftCategory): number {
  return DEFAULT_BASELINE_BY_CATEGORY[category] ?? 100;
}

/** A movement the coach can pick — either from the shared library or their own customs. */
export interface MovementOption {
  id: string;
  name: string;
  liftCategory: LiftCategory;
  tier: Tier;
  source: 'canonical' | 'custom';
  /** Custom movements may carry saved modifiers. */
  tempoId?: string;
  romId?: string;
  gear?: string[];
}

/** Curated, shared movement metadata (no e1RM). */
export const CANONICAL_EXERCISES: MovementOption[] = [
  { id: 'comp-squat', name: 'Competition Squat', liftCategory: 'Squat', tier: 'Comp', source: 'canonical' },
  { id: 'comp-bench', name: 'Competition Bench', liftCategory: 'Bench', tier: 'Comp', source: 'canonical' },
  { id: 'comp-deadlift', name: 'Competition Deadlift', liftCategory: 'Deadlift', tier: 'Comp', source: 'canonical' },
  { id: 'pause-squat', name: 'Pause Squat', liftCategory: 'Squat', tier: 'Variation', source: 'canonical' },
  { id: 'high-bar-squat', name: 'High Bar Squat', liftCategory: 'Squat', tier: 'Variation', source: 'canonical' },
  { id: 'front-squat', name: 'Front Squat', liftCategory: 'Squat', tier: 'Variation', source: 'canonical' },
  { id: 'spoto-press', name: 'Spoto Press', liftCategory: 'Bench', tier: 'Variation', source: 'canonical' },
  { id: 'close-grip-bench', name: 'Close Grip Bench', liftCategory: 'Bench', tier: 'Variation', source: 'canonical' },
  { id: 'larsen-press', name: 'Larsen Press', liftCategory: 'Bench', tier: 'Variation', source: 'canonical' },
  { id: 'deficit-deadlift', name: 'Deficit Deadlift', liftCategory: 'Deadlift', tier: 'Variation', source: 'canonical' },
  { id: 'block-pull', name: 'Block Pull', liftCategory: 'Deadlift', tier: 'Variation', source: 'canonical' },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', liftCategory: 'Deadlift', tier: 'Variation', source: 'canonical' },
  { id: 'leg-press', name: 'Leg Press', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
  { id: 'barbell-row', name: 'Barbell Row', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
  { id: 'pull-up', name: 'Weighted Pull-up', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
  { id: 'triceps-extension', name: 'Triceps Extension', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
  { id: 'lateral-raise', name: 'Lateral Raise', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
  { id: 'hamstring-curl', name: 'Hamstring Curl', liftCategory: 'Other', tier: 'Accessory', source: 'canonical' },
];

export interface BuilderMovement {
  baseName: string;
  liftCategory: LiftCategory;
  tier: Tier;
  tempoId: string;
  romId: string;
  gear: string[];
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

/**
 * Compiles the canonical movement name from structured parameters, e.g.
 * "[Beltless] Deficit Paused Squat (3-2-0)". Never the reverse (no parsing).
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

/** Resolves an exercise's lift category from metadata, or infers it from the title. */
export function exerciseCategoryOf(ex: { liftCategory?: string; title?: string }): LiftCategory {
  if (ex.liftCategory && LIFT_CATEGORIES.includes(ex.liftCategory as LiftCategory)) {
    return ex.liftCategory as LiftCategory;
  }
  const t = (ex.title || '').toLowerCase();
  if (t.includes('squat')) return 'Squat';
  if (t.includes('bench') || t.includes('press')) return 'Bench';
  if (t.includes('dead') || t.includes('pull')) return 'Deadlift';
  return 'Other';
}

/**
 * Derives a baseline e1RM anchor for a lift category from the ATHLETE'S OWN
 * training data (dynamic, per-athlete), so a newly added movement is scaled to
 * the lifter's real strength rather than a static library constant.
 *
 * Priority: highest e1RM from logged sets → highest planned baseline already on
 * record → category default.
 */
export function deriveBaselineE1RM(microcycles: MicrocycleData[], category: LiftCategory): number {
  let bestLogged = 0;
  let bestPlanned = 0;

  for (const mc of microcycles) {
    for (const w of mc.workouts) {
      for (const ex of w.exercises) {
        if (exerciseCategoryOf(ex) !== category) continue;
        for (const s of ex.sets) {
          const weight = Number(s.actual ?? 0);
          const reps = Number(s.reps ?? 0);
          const rpe = Number(s.executedRpe ?? 8);
          if (weight > 0 && reps > 0) {
            const e1rm = calculateE1RM(weight, reps, rpe);
            if (e1rm > bestLogged) bestLogged = e1rm;
          }
          const planned = Number(s.baseline_e1rm ?? 0);
          if (planned > bestPlanned) bestPlanned = planned;
        }
      }
    }
  }

  if (bestLogged > 0) return Math.round(bestLogged * 100) / 100;
  if (bestPlanned > 0) return bestPlanned;
  return categoryDefaultBaseline(category);
}

/**
 * Builds an ExerciseData block for the chosen movement with a single blank
 * starter set. The baseline anchor is intentionally left unset here — it is
 * seeded from the athlete's history when the exercise is added to a workout
 * (see PeriodizationContext.addExercise). The coach authors the set-by-set
 * prescription (reps / intensity / weight, add / remove sets) in the card.
 */
export function buildExercise(movement: BuilderMovement): ExerciseData {
  const idBase = `e-cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const starterSet: SetData = {
    id: `${idBase}-s1`,
    label: 'Set 1',
    plannedWeight: null,
    plannedReps: null,
    plannedRpe: null,
    intensity_type: 'RPE',
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

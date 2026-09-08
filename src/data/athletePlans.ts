import { MicrocycleData } from '../types';
import { ZAHAR_BLOCK_31 } from './fixtures/zaharBlock31';

/**
 * A block of training converted offline from a coach's spreadsheet and attached
 * to an athlete id. Nothing here is parsed at runtime.
 */
export interface ImportedPlan {
  athleteId: string;
  /** Shown on the roster action, so the UI never hardcodes a block name. */
  blockName: string;
  microcycles: MicrocycleData[];
}

/**
 * Content fingerprint of a plan. Cached copies compare against this instead of a
 * hand-maintained version string, so editing a fixture always invalidates the
 * cache without anyone remembering to bump a number.
 */
export function planVersion(microcycles: MicrocycleData[]): string {
  const json = JSON.stringify(microcycles);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${json.length.toString(36)}-${hash.toString(36)}`;
}

/** Adding the next athlete's block is an entry here, not a code change elsewhere. */
const IMPORTED_PLANS: ImportedPlan[] = [ZAHAR_BLOCK_31];

export function importedPlanFor(athleteId: string | null | undefined): ImportedPlan | null {
  if (!athleteId) return null;
  return IMPORTED_PLANS.find((plan) => plan.athleteId === athleteId) ?? null;
}

export function athleteIdsWithImportedPlan(): string[] {
  return IMPORTED_PLANS.map((plan) => plan.athleteId);
}

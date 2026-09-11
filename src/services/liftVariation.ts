export type LiftCategory = 'Squat' | 'Bench' | 'Deadlift' | 'Other';
export type RomMod = 'Full' | 'Deficit' | 'Pin' | 'Board' | 'Partial';
export type GearMod = 'Beltless' | 'Bands' | 'Chains' | 'Wraps' | 'SlingShot';

export type LiftModifiers = {
  bar: string;
  tempo: string;
  rom: RomMod;
  gear: GearMod[];
};

export const DEFAULT_TEMPO = '1-0-1';

export const BAR_OPTIONS: Record<LiftCategory, string[]> = {
  Squat: ['Competition', 'High Bar', 'Low Bar', 'SSB', 'Front', 'Box', 'Hatfield'],
  Bench: ['Competition', 'Close Grip', 'Wide Grip', 'Incline', 'Decline', 'Floor', 'Spoto'],
  Deadlift: ['Competition', 'Conventional', 'Sumo', 'RDL', 'Block', 'Snatch Grip'],
  Other: ['Standard'],
};

export const ROM_OPTIONS: RomMod[] = ['Full', 'Deficit', 'Pin', 'Board', 'Partial'];
export const GEAR_OPTIONS: Record<LiftCategory, GearMod[]> = {
  Squat: ['Beltless', 'Bands', 'Chains', 'Wraps'],
  Bench: ['Beltless', 'Bands', 'Chains', 'Wraps', 'SlingShot'],
  Deadlift: ['Beltless', 'Bands', 'Chains', 'Wraps'],
  Other: ['Beltless', 'Bands', 'Chains'],
};

const ROM_WORD: Record<RomMod, string | null> = {
  Full: null,
  Deficit: 'Deficit',
  Pin: 'Pin',
  Board: 'Board',
  Partial: 'Partial',
};

function clampTempoPart(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(9, Math.round(value)));
}

export function parseTempoParts(tempo: string): [number, number, number] {
  const match = (tempo || '').match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (!match) return [1, 0, 1];
  return [clampTempoPart(Number(match[1])), clampTempoPart(Number(match[2])), clampTempoPart(Number(match[3]))];
}

export function formatTempo(eccentric: number, pause: number, concentric: number): string {
  return `${clampTempoPart(eccentric)}-${clampTempoPart(pause)}-${clampTempoPart(concentric)}`;
}

export function isDefaultTempo(tempo: string): boolean {
  return formatTempo(...parseTempoParts(tempo)) === DEFAULT_TEMPO;
}

export function defaultModifiers(category: LiftCategory): LiftModifiers {
  const bars = BAR_OPTIONS[category] ?? BAR_OPTIONS.Other;
  return {
    bar: bars[0],
    tempo: DEFAULT_TEMPO,
    rom: 'Full',
    gear: [],
  };
}

export function toggleGear(gear: GearMod[], item: GearMod): GearMod[] {
  return gear.includes(item) ? gear.filter((g) => g !== item) : [...gear, item];
}

export function compileVariation(title: string, mods: LiftModifiers): string {
  const bits: string[] = [];
  for (const item of mods.gear) bits.push(item);
  const romWord = ROM_WORD[mods.rom];
  if (romWord) bits.push(romWord);
  if (mods.bar && mods.bar !== 'Competition' && mods.bar !== 'Standard') {
    bits.push(mods.bar);
  } else if (bits.length === 0) {
    bits.push('Competition');
  }
  const tempo = formatTempo(...parseTempoParts(mods.tempo));
  const note = tempo === DEFAULT_TEMPO ? '' : ` (${tempo})`;
  return `${bits.join(' ')} ${title}${note}`.replace(/\s+/g, ' ').trim();
}

export function variationTier(mods: LiftModifiers): 'Comp' | 'Variation' {
  const isComp =
    (mods.bar === 'Competition' || mods.bar === 'Standard' || mods.bar === 'Conventional')
    && isDefaultTempo(mods.tempo)
    && mods.rom === 'Full'
    && mods.gear.length === 0;
  return isComp ? 'Comp' : 'Variation';
}

export function parseModifiers(variation: string, category: LiftCategory): LiftModifiers {
  const text = (variation || '').toLowerCase();
  const mods = defaultModifiers(category);
  const bars = BAR_OPTIONS[category] ?? BAR_OPTIONS.Other;
  const matchedBar = [...bars].sort((a, b) => b.length - a.length).find((bar) => {
    if (bar === 'Competition' || bar === 'Standard') return false;
    return text.includes(bar.toLowerCase());
  });
  if (matchedBar) mods.bar = matchedBar;

  const gearOpts = GEAR_OPTIONS[category] ?? GEAR_OPTIONS.Other;
  mods.gear = gearOpts.filter((item) => text.includes(item.toLowerCase()));

  if (/deficit/.test(text)) mods.rom = 'Deficit';
  else if (/board/.test(text)) mods.rom = 'Board';
  else if (/partial/.test(text)) mods.rom = 'Partial';
  else if (/\bpin\b/.test(text)) mods.rom = 'Pin';

  const triple = variation.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (triple) {
    mods.tempo = formatTempo(Number(triple[1]), Number(triple[2]), Number(triple[3]));
  } else if (/pause/.test(text)) {
    mods.tempo = '3-2-0';
  } else if (/slow\s*ecc/.test(text)) {
    mods.tempo = '3-0-0';
  } else if (/\biso\b/.test(text)) {
    mods.tempo = '1-3-1';
  }
  return mods;
}

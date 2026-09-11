export type LiftCategory = 'Squat' | 'Bench' | 'Deadlift' | 'Other';
export type TempoMod = 'Standard' | 'Paused' | 'Slow ecc' | 'Iso';
export type RomMod = 'Full' | 'Deficit' | 'Pin' | 'Board' | 'Partial';
export type GearMod = 'Beltless' | 'Bands' | 'Chains' | 'Wraps' | 'SlingShot';

export type LiftModifiers = {
  bar: string;
  tempo: TempoMod;
  rom: RomMod;
  gear: GearMod[];
};

export const BAR_OPTIONS: Record<LiftCategory, string[]> = {
  Squat: ['Competition', 'High Bar', 'Low Bar', 'SSB', 'Front', 'Box', 'Hatfield'],
  Bench: ['Competition', 'Close Grip', 'Wide Grip', 'Incline', 'Decline', 'Floor', 'Spoto'],
  Deadlift: ['Competition', 'Conventional', 'Sumo', 'RDL', 'Block', 'Snatch Grip'],
  Other: ['Standard'],
};

export const TEMPO_OPTIONS: TempoMod[] = ['Standard', 'Paused', 'Slow ecc', 'Iso'];
export const ROM_OPTIONS: RomMod[] = ['Full', 'Deficit', 'Pin', 'Board', 'Partial'];
export const GEAR_OPTIONS: Record<LiftCategory, GearMod[]> = {
  Squat: ['Beltless', 'Bands', 'Chains', 'Wraps'],
  Bench: ['Beltless', 'Bands', 'Chains', 'Wraps', 'SlingShot'],
  Deadlift: ['Beltless', 'Bands', 'Chains', 'Wraps'],
  Other: ['Beltless', 'Bands', 'Chains'],
};

const TEMPO_NOTE: Record<TempoMod, string> = {
  Standard: '',
  Paused: ' (3-2-0)',
  'Slow ecc': ' (3-0-0)',
  Iso: ' (1-3-1)',
};

const TEMPO_WORD: Record<TempoMod, string | null> = {
  Standard: null,
  Paused: 'Pause',
  'Slow ecc': 'Slow ecc',
  Iso: 'Iso',
};

const ROM_WORD: Record<RomMod, string | null> = {
  Full: null,
  Deficit: 'Deficit',
  Pin: 'Pin',
  Board: 'Board',
  Partial: 'Partial',
};

export function defaultModifiers(category: LiftCategory): LiftModifiers {
  const bars = BAR_OPTIONS[category] ?? BAR_OPTIONS.Other;
  return {
    bar: bars[0],
    tempo: 'Standard',
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
  const tempoWord = TEMPO_WORD[mods.tempo];
  if (tempoWord) bits.push(tempoWord);
  if (mods.bar && mods.bar !== 'Competition' && mods.bar !== 'Standard') {
    bits.push(mods.bar);
  } else if (bits.length === 0) {
    bits.push('Competition');
  }
  const note = TEMPO_NOTE[mods.tempo] ?? '';
  return `${bits.join(' ')} ${title}${note}`.replace(/\s+/g, ' ').trim();
}

export function variationTier(mods: LiftModifiers): 'Comp' | 'Variation' {
  const isComp =
    (mods.bar === 'Competition' || mods.bar === 'Standard' || mods.bar === 'Conventional')
    && mods.tempo === 'Standard'
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

  if (/pause/.test(text) || /3-2-0/.test(text)) mods.tempo = 'Paused';
  else if (/slow\s*ecc|3-0-0/.test(text)) mods.tempo = 'Slow ecc';
  else if (/\biso\b|1-3-1/.test(text)) mods.tempo = 'Iso';
  return mods;
}

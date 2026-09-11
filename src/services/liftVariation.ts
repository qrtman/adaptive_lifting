export type LiftCategory = 'Squat' | 'Bench' | 'Deadlift' | 'Other';
export type TempoMod = 'Standard' | 'Paused' | 'Slow ecc';
export type RomMod = 'Full' | 'Deficit' | 'Pin';

export type LiftModifiers = {
  bar: string;
  tempo: TempoMod;
  rom: RomMod;
  beltless: boolean;
};

export const BAR_OPTIONS: Record<LiftCategory, string[]> = {
  Squat: ['Competition', 'High Bar', 'Low Bar', 'SSB', 'Front'],
  Bench: ['Competition', 'Close Grip', 'Incline', 'Floor'],
  Deadlift: ['Competition', 'Conventional', 'Sumo', 'RDL'],
  Other: ['Standard'],
};

export const TEMPO_OPTIONS: TempoMod[] = ['Standard', 'Paused', 'Slow ecc'];
export const ROM_OPTIONS: RomMod[] = ['Full', 'Deficit', 'Pin'];

const TEMPO_NOTE: Record<TempoMod, string> = {
  Standard: '',
  Paused: ' (3-2-0)',
  'Slow ecc': ' (3-0-0)',
};

export function defaultModifiers(category: LiftCategory): LiftModifiers {
  const bars = BAR_OPTIONS[category] ?? BAR_OPTIONS.Other;
  return {
    bar: bars[0],
    tempo: 'Standard',
    rom: 'Full',
    beltless: false,
  };
}

export function compileVariation(title: string, mods: LiftModifiers): string {
  const bits: string[] = [];
  if (mods.beltless) bits.push('Beltless');
  if (mods.rom === 'Deficit') bits.push('Deficit');
  if (mods.rom === 'Pin') bits.push('Pin');
  if (mods.tempo === 'Paused') bits.push('Pause');
  if (mods.tempo === 'Slow ecc') bits.push('Slow ecc');
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
    && !mods.beltless;
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
  if (/beltless/.test(text)) mods.beltless = true;
  if (/deficit/.test(text)) mods.rom = 'Deficit';
  else if (/\bpin\b/.test(text)) mods.rom = 'Pin';
  if (/pause/.test(text) || /3-2-0/.test(text)) mods.tempo = 'Paused';
  else if (/slow\s*ecc|3-0-0/.test(text)) mods.tempo = 'Slow ecc';
  return mods;
}

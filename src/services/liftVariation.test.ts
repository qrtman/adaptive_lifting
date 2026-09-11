import { describe, expect, it } from 'vitest';
import { compileVariation, parseModifiers, variationTier } from './liftVariation';

describe('liftVariation', () => {
  it('compiles pause high-bar squat the way RTS names a lift', () => {
    const name = compileVariation('Squat', {
      bar: 'High Bar',
      tempo: 'Paused',
      rom: 'Full',
      gear: [],
    });
    expect(name).toBe('Pause High Bar Squat (3-2-0)');
    expect(variationTier({
      bar: 'High Bar',
      tempo: 'Paused',
      rom: 'Full',
      gear: [],
    })).toBe('Variation');
  });

  it('round-trips deficit pause deadlift', () => {
    const compiled = compileVariation('Deadlift', {
      bar: 'Competition',
      tempo: 'Paused',
      rom: 'Deficit',
      gear: ['Beltless'],
    });
    expect(compiled).toBe('Beltless Deficit Pause Deadlift (3-2-0)');
    const parsed = parseModifiers(compiled, 'Deadlift');
    expect(parsed.gear).toEqual(['Beltless']);
    expect(parsed.rom).toBe('Deficit');
    expect(parsed.tempo).toBe('Paused');
  });

  it('compiles box squat with bands and chains', () => {
    const name = compileVariation('Squat', {
      bar: 'Box',
      tempo: 'Standard',
      rom: 'Full',
      gear: ['Bands', 'Chains'],
    });
    expect(name).toBe('Bands Chains Box Squat');
    const parsed = parseModifiers(name, 'Squat');
    expect(parsed.bar).toBe('Box');
    expect(parsed.gear).toEqual(['Bands', 'Chains']);
  });

  it('compiles spoto bench with slingshot', () => {
    const name = compileVariation('Bench', {
      bar: 'Spoto',
      tempo: 'Iso',
      rom: 'Board',
      gear: ['SlingShot'],
    });
    expect(name).toBe('SlingShot Board Iso Spoto Bench (1-3-1)');
    const parsed = parseModifiers(name, 'Bench');
    expect(parsed.bar).toBe('Spoto');
    expect(parsed.rom).toBe('Board');
    expect(parsed.tempo).toBe('Iso');
    expect(parsed.gear).toEqual(['SlingShot']);
  });
});

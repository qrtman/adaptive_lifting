import { describe, expect, it } from 'vitest';
import { compileVariation, parseModifiers, variationTier } from './liftVariation';

describe('liftVariation', () => {
  it('puts a custom tempo on the compiled name', () => {
    const name = compileVariation('Squat', {
      bar: 'High Bar',
      tempo: '3-2-0',
      rom: 'Full',
      gear: [],
    });
    expect(name).toBe('High Bar Squat (3-2-0)');
    expect(variationTier({
      bar: 'High Bar',
      tempo: '3-2-0',
      rom: 'Full',
      gear: [],
    })).toBe('Variation');
  });

  it('round-trips deficit deadlift with custom tempo', () => {
    const compiled = compileVariation('Deadlift', {
      bar: 'Competition',
      tempo: '5-3-0',
      rom: 'Deficit',
      gear: ['Beltless'],
    });
    expect(compiled).toBe('Beltless Deficit Deadlift (5-3-0)');
    const parsed = parseModifiers(compiled, 'Deadlift');
    expect(parsed.gear).toEqual(['Beltless']);
    expect(parsed.rom).toBe('Deficit');
    expect(parsed.tempo).toBe('5-3-0');
  });

  it('omits default 1-0-1 tempo from the name', () => {
    const name = compileVariation('Squat', {
      bar: 'Box',
      tempo: '1-0-1',
      rom: 'Full',
      gear: ['Bands', 'Chains'],
    });
    expect(name).toBe('Bands Chains Box Squat');
    const parsed = parseModifiers(name, 'Squat');
    expect(parsed.bar).toBe('Box');
    expect(parsed.tempo).toBe('1-0-1');
    expect(parsed.gear).toEqual(['Bands', 'Chains']);
  });

  it('compiles spoto bench with slingshot and iso tempo digits', () => {
    const name = compileVariation('Bench', {
      bar: 'Spoto',
      tempo: '1-3-1',
      rom: 'Board',
      gear: ['SlingShot'],
    });
    expect(name).toBe('SlingShot Board Spoto Bench (1-3-1)');
    const parsed = parseModifiers(name, 'Bench');
    expect(parsed.bar).toBe('Spoto');
    expect(parsed.rom).toBe('Board');
    expect(parsed.tempo).toBe('1-3-1');
    expect(parsed.gear).toEqual(['SlingShot']);
  });

  it('does not add a competition prefix to standard custom names', () => {
    expect(compileVariation('Hamstring Curls', {
      bar: 'Standard',
      tempo: '1-0-1',
      rom: 'Full',
      gear: [],
    })).toBe('Hamstring Curls');
  });

  it('does not duplicate a catalog modifier in the exercise name', () => {
    expect(compileVariation('Sumo Deadlift', {
      bar: 'Sumo',
      tempo: '1-0-1',
      rom: 'Full',
      gear: [],
    })).toBe('Sumo Deadlift');
  });

  it('does not treat an exact RDL exercise name as an RDL bar prefix', () => {
    expect(compileVariation('RDL', {
      bar: 'RDL',
      tempo: '1-0-1',
      rom: 'Full',
      gear: [],
    })).toBe('RDL');
  });
});

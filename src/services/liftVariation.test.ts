import { describe, expect, it } from 'vitest';
import { compileVariation, parseModifiers, variationTier } from './liftVariation';

describe('liftVariation', () => {
  it('compiles pause high-bar squat the way RTS names a lift', () => {
    const name = compileVariation('Squat', {
      bar: 'High Bar',
      tempo: 'Paused',
      rom: 'Full',
      beltless: false,
    });
    expect(name).toBe('Pause High Bar Squat (3-2-0)');
    expect(variationTier({
      bar: 'High Bar',
      tempo: 'Paused',
      rom: 'Full',
      beltless: false,
    })).toBe('Variation');
  });

  it('round-trips deficit pause deadlift', () => {
    const compiled = compileVariation('Deadlift', {
      bar: 'Competition',
      tempo: 'Paused',
      rom: 'Deficit',
      beltless: true,
    });
    expect(compiled).toBe('Beltless Deficit Pause Deadlift (3-2-0)');
    const parsed = parseModifiers(compiled, 'Deadlift');
    expect(parsed.beltless).toBe(true);
    expect(parsed.rom).toBe('Deficit');
    expect(parsed.tempo).toBe('Paused');
  });
});

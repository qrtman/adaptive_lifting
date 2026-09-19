import { describe, expect, it } from 'vitest';
import { CATALOG_EXERCISES, filterCatalog } from './exerciseCatalog';

describe('exerciseCatalog', () => {
  it('groups squat under knee dominant', () => {
    const rows = filterCatalog('Knee Dominant', '');
    expect(rows.map((row) => row.name)).toContain('Squat');
    expect(rows.every((row) => row.category === 'Knee Dominant')).toBe(true);
  });

  it('search finds bench across categories', () => {
    const rows = filterCatalog('', 'bench');
    expect(rows.map((row) => row.name)).toEqual([
      'Bench',
      'Close Grip Bench',
      'Incline Bench',
      'Floor Press',
    ]);
  });

  it('matches name substrings', () => {
    const rows = filterCatalog('', 'squat');
    expect(rows.map((row) => row.name)).toEqual([
      'Squat',
      'Front Squat',
      'Box Squat',
      'SSB Squat',
      'Split Squat',
    ]);
  });

  it('matches movement pattern tokens', () => {
    const rows = filterCatalog('', 'vertical');
    expect(rows.map((row) => row.name)).toEqual([
      'Press',
      'Push Press',
      'Pull-up',
      'Lat Pulldown',
    ]);
    expect(rows.every((row) => row.movementPattern.toLowerCase().includes('vertical'))).toBe(true);
  });

  it('matches category tokens', () => {
    const rows = filterCatalog('', 'hip');
    expect(rows.every((row) => row.category === 'Hip Dominant')).toBe(true);
    expect(rows.map((row) => row.name)[0]).toBe('Hip Thrust');
    expect(rows.map((row) => row.name)).toEqual([
      'Hip Thrust',
      'Deadlift',
      'Sumo Deadlift',
      'RDL',
      'Good Morning',
    ]);
  });

  it('ANDs search with category constraint', () => {
    const rows = filterCatalog('Knee Dominant', 'press');
    expect(rows.map((row) => row.name)).toEqual(['Leg Press']);
    expect(rows.some((row) => row.name === 'Bench' || row.name === 'Press')).toBe(false);
  });

  it('returns no rows for User Defined', () => {
    expect(filterCatalog('User Defined', '')).toEqual([]);
    expect(filterCatalog('User Defined', 'squat')).toEqual([]);
  });

  it('matches compact aliases', () => {
    expect(filterCatalog('', 'rdl').map((row) => row.name)).toEqual(['RDL']);
    expect(filterCatalog('', 'romanian').map((row) => row.name)).toEqual(['RDL']);
    expect(filterCatalog('', 'ssb').map((row) => row.name)).toEqual(['SSB Squat']);
    expect(filterCatalog('', 'safety').map((row) => row.name)).toEqual(['SSB Squat']);
  });

  it('requires every search token to match', () => {
    expect(filterCatalog('', 'close bench').map((row) => row.name)).toEqual(['Close Grip Bench']);
    expect(filterCatalog('', 'close  bench').map((row) => row.name)).toEqual(['Close Grip Bench']);
  });

  it('returns the full catalog for an empty query', () => {
    const rows = filterCatalog('', '');
    expect(rows).toEqual(CATALOG_EXERCISES);
    expect(filterCatalog('', '   ')).toEqual(CATALOG_EXERCISES);
    expect(rows.length).toBeGreaterThan(0);
  });
});

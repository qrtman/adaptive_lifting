import { describe, expect, it } from 'vitest';
import { filterCatalog } from './exerciseCatalog';

describe('exerciseCatalog', () => {
  it('groups squat under knee dominant', () => {
    const rows = filterCatalog('Knee Dominant', '');
    expect(rows.map((row) => row.name)).toContain('Squat');
    expect(rows.every((row) => row.category === 'Knee Dominant')).toBe(true);
  });

  it('search finds bench across categories', () => {
    const rows = filterCatalog('', 'bench');
    expect(rows.map((row) => row.name)).toEqual(['Bench', 'Close Grip Bench', 'Incline Bench']);
  });
});

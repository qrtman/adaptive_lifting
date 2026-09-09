import { describe, expect, it } from 'vitest';
import type { LocalAthlete } from '../types';
import { mergeRoster, rosterHasName } from './localRoster';

const LOCAL: LocalAthlete = {
  id: 'athlete-local',
  name: 'Local Athlete',
  email: null,
  currentBlock: 'Block A',
  activeMicrocycles: 1,
  peakE1RM: { squat: 200, bench: 140, deadlift: 240 },
  linked: false,
};

describe('mergeRoster', () => {
  it('keeps a local identity when the API roster is empty', () => {
    expect(mergeRoster([], [LOCAL])).toEqual([LOCAL]);
  });

  it('does not drop a local identity when a linked athlete is also present', () => {
    const merged = mergeRoster(
      [{ id: 'u-1', email: 'coach-athlete@example.com', activeMicrocycles: 2 }],
      [LOCAL],
    );
    expect(merged.map((row) => row.id).sort()).toEqual(['athlete-local', 'u-1']);
    expect(merged.find((row) => row.id === 'athlete-local')?.linked).toBe(false);
    expect(merged.find((row) => row.id === 'u-1')?.linked).toBe(true);
  });

  it('keeps the local name and peaks when the API links the same id', () => {
    const merged = mergeRoster(
      [{ id: LOCAL.id, email: 'local@example.com', activeMicrocycles: 3 }],
      [LOCAL],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Local Athlete');
    expect(merged[0].peakE1RM.squat).toBe(200);
    expect(merged[0].activeMicrocycles).toBe(3);
    expect(merged[0].linked).toBe(true);
  });
});

describe('rosterHasName', () => {
  it('treats the same name with different casing as a duplicate', () => {
    expect(rosterHasName([LOCAL], 'local athlete')).toBe(true);
    expect(rosterHasName([LOCAL], 'Other Athlete')).toBe(false);
  });
});

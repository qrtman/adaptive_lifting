import { describe, expect, it } from 'vitest';
import { mergeRoster, ZAHAR_ATHLETE } from './localRoster';

describe('mergeRoster', () => {
  it('keeps Zahar when the API roster is empty', () => {
    expect(mergeRoster([], [ZAHAR_ATHLETE])).toEqual([ZAHAR_ATHLETE]);
  });

  it('does not drop a local identity when a linked athlete is also present', () => {
    const merged = mergeRoster(
      [{ id: 'u-1', email: 'coach-athlete@example.com', activeMicrocycles: 2 }],
      [ZAHAR_ATHLETE],
    );
    expect(merged.map((row) => row.id).sort()).toEqual(['athlete-zahar', 'u-1']);
    expect(merged.find((row) => row.id === 'athlete-zahar')?.linked).toBe(false);
    expect(merged.find((row) => row.id === 'u-1')?.linked).toBe(true);
  });
});

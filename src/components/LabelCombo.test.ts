import { describe, expect, it } from 'vitest';
import { uniquePlanTitles } from './LabelCombo';
import type { MicrocycleData } from '../types';

describe('uniquePlanTitles', () => {
  it('returns distinct titles most recent first', () => {
    const micros = [
      {
        workouts: [
          { id: 'a', date: '2026-09-01', title: 'Day 1' },
          { id: 'b', date: '2026-09-10', title: 'Meet prep' },
          { id: 'c', date: '2026-09-08', title: 'Day 1' },
        ],
      },
    ] as unknown as MicrocycleData[];
    expect(uniquePlanTitles(micros)).toEqual(['Meet prep', 'Day 1']);
  });
});

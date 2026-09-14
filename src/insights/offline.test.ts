import { describe, expect, it } from 'vitest';
import { insightResultIsStale } from './types';

describe('insightResultIsStale', () => {
  it('marks cached results stale when offline', () => {
    expect(insightResultIsStale(false, false)).toBe(true);
    expect(insightResultIsStale(false, true)).toBe(true);
  });

  it('marks failed live fetch that fell back to cache as stale', () => {
    expect(insightResultIsStale(true, true)).toBe(true);
  });

  it('is fresh when online and served from the query', () => {
    expect(insightResultIsStale(true, false)).toBe(false);
  });
});

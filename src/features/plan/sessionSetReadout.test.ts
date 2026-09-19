import { describe, expect, it } from 'vitest';
import { formatSessionStatusMeta, formatSetReadout } from './sessionSetReadout';

describe('formatSetReadout', () => {
  it('formats a full triple with spaces', () => {
    expect(formatSetReadout(150, 5, 6)).toBe('150 × 5 @ 6');
  });

  it('omits missing kg instead of emitting a dash mash', () => {
    expect(formatSetReadout(null, 5, 8)).toBe('5 @ 8');
    expect(formatSetReadout(undefined, 5, 8)).toBe('5 @ 8');
  });

  it('returns an em dash when nothing is present', () => {
    expect(formatSetReadout(null, null, null)).toBe('—');
  });

  it('keeps kg-only and kg×reps without inventing RPE', () => {
    expect(formatSetReadout(150, null, null)).toBe('150');
    expect(formatSetReadout(150, 5, null)).toBe('150 × 5');
    expect(formatSetReadout(150, null, 6)).toBe('150 @ 6');
  });
});

describe('formatSessionStatusMeta', () => {
  it('hides planned sessions with zero tonnage', () => {
    expect(formatSessionStatusMeta('PLANNED', 0)).toBeNull();
  });

  it('shows Done without 0 kg', () => {
    expect(formatSessionStatusMeta('COMPLETED', 0)).toBe('Done');
  });

  it('pairs Done with positive tonnage', () => {
    expect(formatSessionStatusMeta('COMPLETED', 3787.5)).toBe('Done · 3787.5 kg');
  });
});

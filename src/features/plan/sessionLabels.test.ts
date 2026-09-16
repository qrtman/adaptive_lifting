import { describe, expect, it } from 'vitest';
import { formatPlanLabel } from './sessionLabels';

describe('formatPlanLabel', () => {
  it('returns null when unlabeled so the header can show No block/week', () => {
    expect(formatPlanLabel('Week', null)).toBeNull();
    expect(formatPlanLabel('Block', undefined)).toBeNull();
    expect(formatPlanLabel('Week', '')).toBeNull();
    expect(formatPlanLabel('Block', '   ')).toBeNull();
  });

  it('prefixes bare numbers with the domain term', () => {
    expect(formatPlanLabel('Week', '1')).toBe('Week 1');
    expect(formatPlanLabel('Block', '1')).toBe('Block 1');
  });

  it('normalizes glued prefixes such as Week1', () => {
    expect(formatPlanLabel('Week', 'Week1')).toBe('Week 1');
    expect(formatPlanLabel('Week', 'Week 1')).toBe('Week 1');
    expect(formatPlanLabel('Block', 'Block2')).toBe('Block 2');
    expect(formatPlanLabel('Block', 'block 2')).toBe('Block 2');
  });

  it('keeps named blocks with the Block term', () => {
    expect(formatPlanLabel('Block', 'Hypertrophy')).toBe('Block Hypertrophy');
    expect(formatPlanLabel('Block', 'Meet')).toBe('Block Meet');
  });
});

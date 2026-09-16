import { describe, expect, it } from 'vitest';
import {
  displayDayField,
  formatPlanLabel,
  isUnlabeledDay,
  normalizeDayLabel,
} from './sessionLabels';

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

  it('formats Day slots as Day n and hides ISO unlabeled sentinels', () => {
    expect(formatPlanLabel('Day', '1')).toBe('Day 1');
    expect(formatPlanLabel('Day', 'D1')).toBe('Day 1');
    expect(formatPlanLabel('Day', 'd1')).toBe('Day 1');
    expect(formatPlanLabel('Day', 'Day1')).toBe('Day 1');
    expect(formatPlanLabel('Day', 'Day 1')).toBe('Day 1');
    expect(formatPlanLabel('Day', '8')).toBe('Day 8');
    expect(formatPlanLabel('Day', '2026-09-04')).toBeNull();
    expect(formatPlanLabel('Day', '')).toBeNull();
    expect(formatPlanLabel('Day', null)).toBeNull();
  });

  it('keeps custom non-numeric Day tokens as typed', () => {
    expect(formatPlanLabel('Day', 'AM')).toBe('AM');
    expect(formatPlanLabel('Day', 'Meet')).toBe('Meet');
  });
});

describe('normalizeDayLabel', () => {
  it('stores Day aliases as 1…7 and treats ISO as unlabeled', () => {
    expect(normalizeDayLabel('1')).toBe('1');
    expect(normalizeDayLabel('D7')).toBe('7');
    expect(normalizeDayLabel('Day 3')).toBe('3');
    expect(normalizeDayLabel('day3')).toBe('3');
    expect(normalizeDayLabel('2026-09-04')).toBeNull();
    expect(normalizeDayLabel('')).toBeNull();
    expect(normalizeDayLabel('AM')).toBe('AM');
  });
});

describe('isUnlabeledDay / displayDayField', () => {
  it('treats empty and ISO dates as unlabeled', () => {
    expect(isUnlabeledDay('')).toBe(true);
    expect(isUnlabeledDay('2026-09-04')).toBe(true);
    expect(isUnlabeledDay('1')).toBe(false);
    expect(isUnlabeledDay('AM')).toBe(false);
  });

  it('shows Day n in the field and nothing when unlabeled', () => {
    expect(displayDayField('1')).toBe('Day 1');
    expect(displayDayField('D2')).toBe('Day 2');
    expect(displayDayField('2026-09-04')).toBe('');
    expect(displayDayField('')).toBe('');
  });
});

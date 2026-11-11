import { describe, expect, it } from 'vitest';
import {
  buildBlockClipboard,
  buildCopyWeekRequest,
  buildDayClipboard,
  buildWeekClipboard,
  copyBannerText,
  dateOffsetDays,
  groupLabeledSessions,
  minSourceDate,
  resolveDayTargetBlock,
  resolveWeekTargetBlock,
} from './copyClipboard';

const squat = { id: 'w1', date: '2026-09-15', title: 'Squat', blockLabel: 'Block2', weekLabel: 'Week3' };
const bench = { id: 'w2', date: '2026-09-17', title: 'Bench', blockLabel: 'Block2', weekLabel: 'Week3' };
const unlabeled = { id: 'w3', date: '2026-09-14', title: 'Open', blockLabel: null, weekLabel: null };
const meet = { id: 'w4', date: '2026-09-16', title: 'Meet', blockLabel: 'Meet', weekLabel: 'Week1' };

describe('dateOffsetDays', () => {
  it('shifts D1 by dest minus min source date', () => {
    expect(minSourceDate(['2026-09-17', '2026-09-15'])).toBe('2026-09-15');
    expect(dateOffsetDays('2026-09-22', '2026-09-15')).toBe(7);
    expect(dateOffsetDays('2026-09-10', '2026-09-15')).toBe(-5);
    expect(dateOffsetDays('2026-09-15', '2026-09-15')).toBe(0);
  });
});

describe('resolveDayTargetBlock', () => {
  it('never stamps a remembered block onto unlabeled sessions', () => {
    expect(resolveDayTargetBlock([unlabeled], 'Hypertrophy')).toBeUndefined();
    expect(resolveDayTargetBlock([unlabeled], '')).toBeUndefined();
  });

  it('uses the shared labeled block', () => {
    expect(resolveDayTargetBlock([squat, bench], 'Meet')).toBe('Block2');
  });

  it('omits when labeled blocks are mixed', () => {
    expect(resolveDayTargetBlock([squat, meet], 'Hypertrophy')).toBeUndefined();
  });

  it('omits when labeled and unlabeled are mixed so unlabeled stay unlabeled', () => {
    expect(resolveDayTargetBlock([squat, unlabeled], 'Hypertrophy')).toBeUndefined();
  });
});

describe('resolveWeekTargetBlock', () => {
  it('prefers the source block over recent', () => {
    expect(resolveWeekTargetBlock([squat, bench], 'Meet')).toBe('Block2');
  });

  it('keeps an unlabeled week unlabeled (no remembered block)', () => {
    expect(resolveWeekTargetBlock([{ ...squat, blockLabel: null }, { ...bench, blockLabel: '' }], 'Meet')).toBeUndefined();
  });
});

describe('clipboard grains', () => {
  it('day preserves week labels and keeps relative dates', () => {
    const clip = buildDayClipboard([squat, bench], '');
    expect(clip.grain).toBe('day');
    expect(clip.preserveWeekLabel).toBe(true);
    expect(clip.targetBlockLabel).toBe('Block2');
    const req = buildCopyWeekRequest(clip, '2026-09-22', false, 'ath-1');
    expect(req.dateOffsetDays).toBe(7);
    expect(req.copyMode).toBe('plan');
    expect(req.preserveWeekLabel).toBe(true);
    expect(req.targetBlockLabel).toBe('Block2');
    expect(req).not.toHaveProperty('targetWeekLabel');
    expect(copyBannerText(clip)).toBe('Copy 2 sessions — click where D1 lands');
  });

  it('maps explicit modes and legacy booleans', () => {
    const clip = buildDayClipboard([squat], '');
    expect(buildCopyWeekRequest(clip, '2026-09-22', 'lifts').copyMode).toBe('lifts');
    expect(buildCopyWeekRequest(clip, '2026-09-22', 'plan').copyMode).toBe('plan');
    expect(buildCopyWeekRequest(clip, '2026-09-22', 'logs').copyMode).toBe('logs');
    expect(buildCopyWeekRequest(clip, '2026-09-22', true).copyMode).toBe('logs');
    expect(buildCopyWeekRequest(clip, '2026-09-22', false).copyMode).toBe('plan');
  });

  it('single day copy keeps the existing calendar banner copy', () => {
    const clip = buildDayClipboard([squat], '');
    expect(copyBannerText(clip)).toBe('Copy Squat — click a day');
  });

  it('week increments week labels', () => {
    const clip = buildWeekClipboard([squat, bench], '');
    expect(clip.grain).toBe('week');
    expect(clip.preserveWeekLabel).toBe(false);
    expect(clip.targetBlockLabel).toBe('Block2');
    expect(copyBannerText(clip)).toBe('Copy week — click where D1 lands');
  });

  it('block preserves week labels and stamps the source block', () => {
    const clip = buildBlockClipboard([squat, bench], 'Block2');
    expect(clip.grain).toBe('block');
    expect(clip.preserveWeekLabel).toBe(true);
    expect(clip.targetBlockLabel).toBe('Block2');
    expect(copyBannerText(clip)).toBe('Copy block — click where D1 lands');
  });
});

describe('groupLabeledSessions', () => {
  it('does not invent week or block rows for unlabeled sessions', () => {
    const grouped = groupLabeledSessions(
      [unlabeled, squat, { ...bench, weekLabel: null }, { ...meet, blockLabel: null }],
      (item) => item,
    );
    expect(grouped.unlabeled.map((item) => item.id)).toEqual(['w3']);
    expect(grouped.blocks).toEqual([
      {
        blockLabel: 'Block2',
        all: [squat, { ...bench, weekLabel: null }],
        weeks: [{ weekLabel: '3', items: [squat] }],
        noWeek: [{ ...bench, weekLabel: null }],
      },
    ]);
    expect(grouped.weeksNoBlock).toEqual([
      { weekLabel: '1', items: [{ ...meet, blockLabel: null }] },
    ]);
  });
});

describe('groupLabeledSessions merges spellings', () => {
  it('puts "Week1" and "1" in one week and ignores block case', () => {
    const items = [
      { id: 'a', blockLabel: 'Hypertrophy', weekLabel: 'Week1' },
      { id: 'b', blockLabel: 'hypertrophy', weekLabel: '1' },
      { id: 'c', blockLabel: 'Hypertrophy', weekLabel: '10' },
      { id: 'd', blockLabel: 'Hypertrophy', weekLabel: '2' },
    ];
    const grouped = groupLabeledSessions(items, (item) => item);
    expect(grouped.blocks).toHaveLength(1);
    expect(grouped.blocks[0].blockLabel).toBe('Hypertrophy');
    expect(grouped.blocks[0].weeks.map((week) => [week.weekLabel, week.items.map((item) => item.id)])).toEqual([
      ['1', ['a', 'b']],
      ['2', ['d']],
      ['10', ['c']],
    ]);
  });
});

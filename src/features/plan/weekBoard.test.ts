import { describe, expect, it } from 'vitest';
import { sortByFirstSession, weekBoardRows } from './weekBoard';

type Entry = { id: string; date: string };
const dateOf = (entry: Entry) => entry.date;

describe('week comparison board', () => {
  it('orders weeks by their first session and sessions within each week', () => {
    const weeks = sortByFirstSession([
      { weekLabel: '1', items: [{ id: 'late', date: '2026-09-10' }] },
      { weekLabel: '2', items: [{ id: 'second', date: '2026-09-04' }, { id: 'first', date: '2026-09-01' }] },
    ], dateOf);
    expect(weeks.map((week) => week.weekLabel)).toEqual(['2', '1']);
    expect(weeks[0].items.map((item) => item.id)).toEqual(['first', 'second']);
  });

  it('places internal and boundary rest dates in the earlier week, without trailing dates', () => {
    const first = [{ id: 'a', date: '2026-09-01' }, { id: 'b', date: '2026-09-03' }];
    const second = [{ id: 'c', date: '2026-09-06' }];
    const occupied = new Set(['2026-09-01', '2026-09-03', '2026-09-06']);
    expect(weekBoardRows(first, second[0].date, dateOf, occupied)).toEqual([
      { kind: 'session', item: first[0] },
      { kind: 'rest', date: '2026-09-02' },
      { kind: 'session', item: first[1] },
      { kind: 'rest', date: '2026-09-04' },
      { kind: 'rest', date: '2026-09-05' },
    ]);
    expect(weekBoardRows(second, undefined, dateOf, occupied)).toEqual([
      { kind: 'session', item: second[0] },
    ]);
  });

  it('does not mark another session date as rest or add a gap for same-day sessions', () => {
    const items = [{ id: 'a', date: '2026-09-01' }, { id: 'b', date: '2026-09-01' }];
    expect(weekBoardRows(items, '2026-09-04', dateOf, new Set(['2026-09-02']))).toEqual([
      { kind: 'session', item: items[0] },
      { kind: 'session', item: items[1] },
      { kind: 'rest', date: '2026-09-03' },
    ]);
  });
});

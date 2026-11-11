// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicrocycleData, SetData, WorkoutData } from '../types';
import { buildWeekRail } from '../features/plan/weekRail';
import { WeekRail } from './WeekRail';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const sets = (reps: number, rpe: number, count: number) =>
  Array.from({ length: count }, () => ({ plannedWeight: 100, plannedReps: reps, plannedRpe: rpe }) as SetData);
const workout = (id: string, date: string, dayLabel: string, weekLabel: string | null, lifts: [string, SetData[]][]): WorkoutData => ({
  id, date, dayLabel, title: 'Session', weekLabel, blockLabel: 'Hypertrophy', tonnage: 0, delta: 0, color: 'gray',
  status: 'PLANNED' as WorkoutData['status'],
  exercises: lifts.map(([title, s], i) => ({ id: `${id}-e${i}`, title, variation: title, tags: [], top: '', vol: '', sets: s })),
});
const day1 = workout('d1', '2026-11-10', '1', '3', [['Squat', sets(5, 7, 3)], ['Bench', sets(6, 8, 4)]]);
const day2 = workout('d2', '2026-11-12', '2', '3', [['Deadlift', sets(3, 8, 3)]]);
const loose = workout('d3', '2026-11-11', '2026-11-11', null, []);
const micro: MicrocycleData[] = [{ id: 'm', weekName: '', focus: '', status: 'ACTIVE' as MicrocycleData['status'], workouts: [day1, day2, loose] }];

async function render(activeId: string, extra: Partial<React.ComponentProps<typeof WeekRail>> = {}) {
  const props = {
    model: buildWeekRail(micro, activeId)!, activeId, notes: { '2026-11-12': 'Gym closes at 20:00' },
    onOpen: vi.fn(), canAssign: true, onAssign: vi.fn(), onAssignWeek: vi.fn(), ...extra,
  };
  await act(async () => { root.render(<WeekRail {...props} />); });
  return props;
}
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('WeekRail', () => {
  it('lists every day of the week with one line per lift', async () => {
    await render('d1');
    expect(q('week-rail-title')!.textContent).toBe('Week 3');
    const d1 = q('week-rail-day-d1')!;
    expect(d1.getAttribute('aria-current')).toBe('page');
    expect(d1.textContent).toContain('Day 1');
    expect(d1.textContent).toContain('7 sets');
    expect(d1.textContent).toContain('Squat');
    expect(d1.textContent).toContain('3×5 @7');
    expect(d1.textContent).toContain('4×6 @8');
    expect(q('week-rail-note-d2')!.textContent).toBe('Gym closes at 20:00');
    expect(q('week-rail-day-d3')!.textContent).toContain('no Week');
    // An unlabeled day is named by its date once, not twice.
    expect(q('week-rail-day-d3')!.textContent!.match(/Wed, 11 Nov/g)).toHaveLength(1);
  });

  it('opens another day, and assigns an inferred day only on click', async () => {
    const props = await render('d1');
    await act(async () => { q('week-rail-day-d2')!.click(); });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ workout: day2 }));
    await act(async () => { q('week-rail-day-d1')!.click(); });
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onAssign).not.toHaveBeenCalled();
    await act(async () => { q('week-rail-assign-d3')!.click(); });
    expect(props.onAssign).toHaveBeenCalledWith(expect.objectContaining({ inferred: true, workout: loose }));
  });

  it('disables Assign without rights and shows a hint when the session has no week', async () => {
    await render('d1', { canAssign: false, assignDisabledReason: 'Connect to change labels.' });
    expect((q('week-rail-assign-d3') as HTMLButtonElement).disabled).toBe(true);
    const lonely: MicrocycleData[] = [{ ...micro[0], workouts: [workout('x', '2026-12-01', '1', null, [])] }];
    const props = { model: buildWeekRail(lonely, 'x')!, activeId: 'x', notes: {}, onOpen: vi.fn(), canAssign: true, onAssign: vi.fn(), onAssignWeek: vi.fn() };
    await act(async () => { root.render(<WeekRail {...props} />); });
    await act(async () => { q('week-rail-assign-week')!.click(); });
    expect(props.onAssignWeek).toHaveBeenCalled();
  });

  it('renders a phone strip of days in strip mode', async () => {
    await render('d2', { variant: 'strip' });
    expect(q('week-rail')).toBeNull();
    const strip = q('week-rail-strip')!;
    expect([...strip.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Day 17 sets', 'Wed, 11 Nov0 sets', 'Day 23 sets']);
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicrocycleData } from '../types';

const periodization = {
  microcycles: [] as MicrocycleData[],
  mesocycles: [],
  setMicrocycles: vi.fn(),
  activeAthleteId: 'athlete-1',
  planAthleteId: 'athlete-1',
  reloadMicrocycles: vi.fn(),
};

vi.mock('../contexts/PeriodizationContext', () => ({ usePeriodization: () => periodization }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'athlete-1', role: 'ATHLETE' } }) }));
vi.mock('../contexts/SyncContext', () => ({ useSync: () => ({ isOnline: true, lockedWorkoutIds: [] }) }));
vi.mock('../services/api', () => ({
  apiService: { fetchDayNotes: vi.fn().mockResolvedValue([]), copyWeek: vi.fn() },
}));

import { CalendarView, DAY_HOVER_INTENT_MS } from './CalendarView';
import { EMPTY_LIFT_FILTER } from '../services/liftFilter';
import type { CopyClipboard } from '../features/plan/copyClipboard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

const noop = () => undefined;
const renderCalendar = async (onViewSession = vi.fn(), copyClipboard: CopyClipboard | null = null) => {
  await act(async () => root.render(
    <CalendarView
      onViewSession={onViewSession}
      onDeleteSession={noop}
      filter={EMPTY_LIFT_FILTER}
      onFilterChange={noop}
      copyClipboard={copyClipboard}
      onStartCopy={noop}
      onClearCopy={noop}
    />,
  ));
  return onViewSession;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2027, 2, 15, 12));
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener: noop, removeEventListener: noop })) as never);
  periodization.microcycles = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

const heading = () => container.querySelector('h3')?.textContent;

describe('CalendarView', () => {
  it('starts on the real current month and Today returns to it', async () => {
    await renderCalendar();
    expect(heading()).toBe('March 2027');

    const next = container.querySelector<HTMLButtonElement>('[aria-label="Next month"]');
    const prev = container.querySelector<HTMLButtonElement>('[aria-label="Previous month"]');
    expect(prev).toBeTruthy();
    await act(async () => { next!.click(); });
    await act(async () => { next!.click(); });
    expect(heading()).toBe('May 2027');

    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="calendar-today"]')!.click(); });
    expect(heading()).toBe('March 2027');
  });

  it('opens a session chip from the keyboard', async () => {
    periodization.microcycles = [{
      id: 'micro-1',
      workouts: [{ id: 'w1', title: 'Heavy squat', date: '2027-03-10', status: 'PLANNED', exercises: [] }],
    } as unknown as MicrocycleData];
    const onViewSession = await renderCalendar();
    const chip = container.querySelector<HTMLElement>('[data-testid="workout-card-w1"]')!;
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.tabIndex).toBe(0);
    await act(async () => {
      chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onViewSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }), 'micro-1');
  });

  it('shows Day · Week for an unnamed session, without repeating them', async () => {
    periodization.microcycles = [{
      id: 'micro-1',
      workouts: [
        { id: 'w1', title: 'Session', dayLabel: '1', weekLabel: '2', blockLabel: 'Hypertrophy', date: '2027-03-10', status: 'PLANNED', exercises: [] },
        { id: 'w2', title: 'Meet', dayLabel: '3', weekLabel: '2', date: '2027-03-12', status: 'PLANNED', exercises: [] },
      ],
    } as unknown as MicrocycleData];
    await renderCalendar();
    const unnamed = container.querySelector<HTMLElement>('[data-testid="workout-card-w1"]')!;
    expect(unnamed.textContent).toContain('Day 1 · Week 2');
    expect(unnamed.textContent).toContain('Block Hypertrophy');
    expect(unnamed.textContent).not.toContain('Session');
    expect(unnamed.textContent?.match(/Day 1/g)).toHaveLength(1);
    expect(unnamed.getAttribute('aria-label')).toMatch(/^Open Day 1 · Week 2,/);
    const named = container.querySelector<HTMLElement>('[data-testid="workout-card-w2"]')!;
    expect(named.textContent).toContain('Meet');
    expect(named.textContent).toContain('Day 3 · Week 2');
  });

  it('copy mode reuses the hover dock and marks the source session', async () => {
    periodization.microcycles = [{
      id: 'micro-1',
      workouts: [{ id: 'w1', title: 'Session', dayLabel: '1', weekLabel: '1', date: '2027-03-10', status: 'PLANNED', exercises: [] }],
    } as unknown as MicrocycleData];
    const clip: CopyClipboard = {
      grain: 'day', sessionIds: ['w1'], sourceDates: { w1: '2027-03-10' }, titles: { w1: 'Session' },
      sourceBlocks: { w1: '' }, preserveWeekLabel: true,
    };
    await renderCalendar(vi.fn(), clip);
    expect(container.querySelector('[data-testid="workout-card-w1"]')!.getAttribute('data-copy-source')).toBe('true');
    expect(container.querySelector('[data-testid="calendar-paste-2027-03-12"]')?.textContent).toBe('Paste');
    // The source day is not a paste target; no day gets a custom outline.
    expect(container.querySelector('[data-testid="calendar-paste-2027-03-10"]')).toBeNull();
    expect(container.querySelector('.cal-copy-target')).toBeNull();
  });

  it('waits before showing a day\'s buttons, and cancels if the pointer moves on', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2027, 2, 15, 12));
    await renderCalendar();
    const day = (date: string) => container.querySelector<HTMLElement>(`[data-testid="calendar-day-${date}"]`)!;
    const dock = (date: string) => container.querySelector<HTMLElement>(`[data-testid="calendar-day-hover-${date}"]`)!;
    const enter = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    const leave = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));

    expect(DAY_HOVER_INTENT_MS).toBeGreaterThanOrEqual(200);
    await act(async () => { enter(day('2027-03-10')); });
    await act(async () => { vi.advanceTimersByTime(DAY_HOVER_INTENT_MS - 50); });
    expect(dock('2027-03-10').getAttribute('data-open')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(DAY_HOVER_INTENT_MS); });
    expect(dock('2027-03-10').getAttribute('data-open')).toBe('true');

    // Sweeping across a day without resting never opens it.
    await act(async () => { leave(day('2027-03-10')); enter(day('2027-03-11')); });
    await act(async () => { vi.advanceTimersByTime(DAY_HOVER_INTENT_MS - 50); leave(day('2027-03-11')); });
    await act(async () => { vi.advanceTimersByTime(DAY_HOVER_INTENT_MS); });
    expect(dock('2027-03-11').getAttribute('data-open')).toBeNull();
  });

  it('keeps day actions in the date row and shows a status dot on each session', async () => {
    periodization.microcycles = [{
      id: 'micro-1',
      workouts: [
        { id: 'w1', title: 'Session', dayLabel: '1', weekLabel: '1', date: '2027-03-10', status: 'PLANNED', exercises: [] },
        { id: 'w2', title: 'Meet', date: '2027-03-11', status: 'COMPLETED', exercises: [] },
      ],
    } as unknown as MicrocycleData];
    await renderCalendar();
    const dock = container.querySelector<HTMLElement>('[data-testid="calendar-day-hover-2027-03-10"]')!;
    expect([...dock.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['New session', 'Copy to', 'Notes']);
    // The toolbar shares the date row: nothing is reserved at the bottom of the day.
    expect(dock.parentElement!.textContent).toContain('10');
    const planned = container.querySelector('[data-testid="workout-card-w1"] [data-status]')!;
    expect(planned.getAttribute('data-status')).toBe('planned');
    expect(container.querySelector('[data-testid="workout-card-w1"]')!.textContent).toContain('No lifts');
    const done = container.querySelector('[data-testid="workout-card-w2"] [data-status]')!;
    expect(done.getAttribute('data-status')).toBe('done');
  });
});

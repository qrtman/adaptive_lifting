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

import { CalendarView } from './CalendarView';
import { EMPTY_LIFT_FILTER } from '../services/liftFilter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

const noop = () => undefined;
const renderCalendar = async (onViewSession = vi.fn()) => {
  await act(async () => root.render(
    <CalendarView
      onViewSession={onViewSession}
      onDeleteSession={noop}
      filter={EMPTY_LIFT_FILTER}
      onFilterChange={noop}
      copyClipboard={null}
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
});

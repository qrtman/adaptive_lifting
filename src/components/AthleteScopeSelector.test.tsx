// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  activeAthleteId: null as string | null,
  roster: [] as { id: string; email: string; displayName?: string | null }[],
  pending: null as null | Promise<unknown>,
}));
const setActiveAthleteId = vi.fn((id: string | null) => { state.activeAthleteId = id; });

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'coach-1', email: 'coach@example.com', role: 'COACH' } }),
}));
vi.mock('../contexts/PeriodizationContext', () => ({
  usePeriodization: () => ({ activeAthleteId: state.activeAthleteId, setActiveAthleteId }),
}));
vi.mock('../services/api', () => ({
  apiService: { fetchRoster: vi.fn(async () => { if (state.pending) await state.pending; return state.roster; }), pushProgramming: vi.fn() },
}));
vi.mock('../storage/uiPrefs', () => ({ getUiPref: () => null, UI_KEYS: { role: 'role', userId: 'userId' } }));

import { AthleteScopeSelector } from './AthleteScopeSelector';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  state.activeAthleteId = null;
  state.roster = [];
  state.pending = null;
  setActiveAthleteId.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function render() {
  await act(async () => { root.render(<AthleteScopeSelector />); });
  // Re-render so the component sees the selection made after the roster loaded.
  await act(async () => { root.render(<AthleteScopeSelector />); });
}
const q = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const options = () => [...container.querySelectorAll('[role="option"]')].map((el) => el.textContent);

describe('coach plan switcher', () => {
  it('opens the coach on their own training when no athletes are linked', async () => {
    await render();
    expect(setActiveAthleteId).toHaveBeenLastCalledWith('coach-1');
    expect(q('athlete-scope-selector')?.textContent).toBe('My training');
    await act(async () => { q('athlete-scope-selector')!.click(); });
    expect(options()).toEqual(['My trainingcoach@example.com']);
    expect(container.textContent).toContain('No linked athletes.');
    expect(q('athlete-scope-security')).not.toBeNull();
  });

  it('lists My training first, then linked athletes, and defaults to the first athlete', async () => {
    state.roster = [{ id: 'ath-1', email: 'a@example.com', displayName: 'Ana' }];
    await render();
    expect(setActiveAthleteId).toHaveBeenLastCalledWith('ath-1');
    await act(async () => { q('athlete-scope-selector')!.click(); });
    expect(options()).toEqual(['My trainingcoach@example.com', 'Anaa@example.com']);
    expect(container.textContent).not.toContain('No linked athletes.');
  });

  it('keeps a pick made while the roster is still loading', async () => {
    state.roster = [{ id: 'ath-1', email: 'a@example.com' }];
    let release!: () => void;
    state.pending = new Promise<void>((resolve) => { release = resolve; });
    await act(async () => { root.render(<AthleteScopeSelector />); });
    // The coach picks My training before the roster answers.
    state.activeAthleteId = 'coach-1';
    await act(async () => { root.render(<AthleteScopeSelector />); });
    await act(async () => { release(); await state.pending; });
    expect(setActiveAthleteId).not.toHaveBeenCalledWith('ath-1');
  });

  it('keeps My training selected across reloads and hides athlete-only actions', async () => {
    state.roster = [{ id: 'ath-1', email: 'a@example.com' }];
    state.activeAthleteId = 'coach-1';
    await render();
    expect(setActiveAthleteId).not.toHaveBeenCalled();
    expect(q('athlete-scope-selector')?.textContent).toBe('My training');
    await act(async () => { q('athlete-scope-menu')!.click(); });
    expect(q('athlete-push-program')).toBeNull();
  });
});

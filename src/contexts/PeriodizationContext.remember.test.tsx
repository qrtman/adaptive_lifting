// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { authState, prefs } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string; role: string } },
  prefs: new Map<string, string>(),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../storage/uiPrefs', () => ({
  UI_KEYS: { activeAthleteId: 'athlete', activeWorkoutId: 'workout', activeMicrocycleId: 'micro', role: 'role', userId: 'uid' },
  getUiPref: (key: string) => prefs.get(key) ?? null,
  setUiPref: (key: string, value: string) => { prefs.set(key, value); },
  removeUiPref: (key: string) => { prefs.delete(key); },
}));
vi.mock('../services/api', () => ({
  ApiRequestError: class ApiRequestError extends Error { status = 403; },
  apiService: { fetchMicrocycles: vi.fn(async () => []) },
}));
vi.mock('../services/db', () => ({
  saveSnapshot: vi.fn(async () => undefined), getSnapshot: vi.fn(async () => null),
  clearSnapshot: vi.fn(async () => undefined), evictOldSyncedData: vi.fn(async () => undefined),
  getPendingMutations: vi.fn(async () => []),
  microcycleSnapshotKey: (id: string) => `microcycles:${id}`,
}));
vi.mock('../services/sync_engine', () => ({ queueMutation: vi.fn(async () => undefined) }));

import { PeriodizationProvider, usePeriodization } from './PeriodizationContext';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;
function Probe() {
  const { activeAthleteId, activeWorkoutId } = usePeriodization();
  return <span>{`${activeAthleteId ?? '-'}|${activeWorkoutId ?? '-'}`}</span>;
}
const renderApp = async () => act(async () => root.render(<PeriodizationProvider><Probe /></PeriodizationProvider>));

beforeEach(() => {
  prefs.clear();
  authState.user = null;
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('keeps the remembered plan and session through a reload (no user → same user)', async () => {
  prefs.set('athlete', 'coach-1');
  prefs.set('workout', 'w-1');
  await renderApp();
  authState.user = { id: 'coach-1', role: 'COACH' };
  await renderApp();
  expect(node.textContent).toBe('coach-1|w-1');
  expect(prefs.get('athlete')).toBe('coach-1');
});

it('starts over when the account changes, and on sign-out', async () => {
  prefs.set('athlete', 'ath-9');
  prefs.set('workout', 'w-1');
  authState.user = { id: 'coach-1', role: 'COACH' };
  await renderApp();
  expect(node.textContent).toBe('ath-9|w-1');

  authState.user = { id: 'coach-2', role: 'COACH' };
  await renderApp();
  expect(node.textContent).toBe('-|-');
  expect(prefs.has('athlete')).toBe(false);
  expect(prefs.has('workout')).toBe(false);

  prefs.set('workout', 'w-2');
  await renderApp();
  authState.user = null;
  await renderApp();
  expect(node.textContent.startsWith('-|')).toBe(true);
});

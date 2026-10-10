// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { authState, fetchMicrocycles } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string; role: string } },
  fetchMicrocycles: vi.fn(),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../services/api', () => ({
  ApiRequestError: class ApiRequestError extends Error { status = 403; },
  apiService: { fetchMicrocycles },
}));
vi.mock('../services/db', () => ({
  saveSnapshot: vi.fn(async () => undefined), getSnapshot: vi.fn(async () => null),
  clearSnapshot: vi.fn(async () => undefined), evictOldSyncedData: vi.fn(async () => undefined),
  microcycleSnapshotKey: (id: string) => `microcycles:${id}`,
}));
vi.mock('../services/sync_engine', () => ({ queueMutation: vi.fn(async () => undefined) }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;
const cycle = (name: string) => ({ id: name, name, workouts: [] }) as any;
function Probe() {
  const { microcycles } = usePeriodization();
  return <span>{microcycles.map((item) => item.name).join(',')}</span>;
}

import { PeriodizationProvider, usePeriodization } from './PeriodizationContext';

beforeEach(() => {
  authState.user = null;
  fetchMicrocycles.mockReset();
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('hides the prior account training tree until the next account data loads', async () => {
  let resolveAccountB: ((value: any[]) => void) | undefined;
  fetchMicrocycles.mockImplementation((owner: string) => owner === 'account-a'
    ? Promise.resolve([cycle('account-a-plan')])
    : new Promise((resolve) => { resolveAccountB = resolve; }));

  authState.user = { id: 'account-a', role: 'ATHLETE' };
  await act(async () => root.render(<PeriodizationProvider><Probe /></PeriodizationProvider>));
  await vi.waitFor(() => expect(node.textContent).toBe('account-a-plan'));

  authState.user = { id: 'account-b', role: 'ATHLETE' };
  await act(async () => root.render(<PeriodizationProvider><Probe /></PeriodizationProvider>));
  expect(node.textContent).toBe('');

  await act(async () => resolveAccountB?.([cycle('account-b-plan')]));
  await vi.waitFor(() => expect(node.textContent).toBe('account-b-plan'));
});

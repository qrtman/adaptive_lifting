// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { authState, processPendingQueues, getPendingMutations, countMutationsByStatus } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
  processPendingQueues: vi.fn(async () => []),
  getPendingMutations: vi.fn(async () => []),
  countMutationsByStatus: vi.fn(async () => 0),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../services/db', () => ({ getPendingMutations, countMutationsByStatus }));
vi.mock('../services/sync_engine', () => ({ isLockSyncCode: () => false, processPendingQueues }));
vi.mock('../components/ConflictReviewCard', () => ({ ConflictReviewCard: () => null }));
vi.mock('../components/WorkoutLockBanner', () => ({ WorkoutLockBanner: () => null }));
vi.mock('../components/SyncQueueOverlay', () => ({ SyncQueueOverlay: () => null }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;

beforeEach(() => {
  authState.user = null;
  processPendingQueues.mockClear().mockResolvedValue([]);
  getPendingMutations.mockClear().mockResolvedValue([]);
  countMutationsByStatus.mockClear().mockResolvedValue(0);
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

it('flushes retained mutations when a user reauthenticates while already online', async () => {
  const { SyncProvider } = await import('./SyncContext');
  await act(async () => root.render(<SyncProvider><span>app</span></SyncProvider>));
  expect(processPendingQueues).not.toHaveBeenCalled();

  authState.user = { id: 'synthetic-user' };
  await act(async () => root.render(<SyncProvider><span>app</span></SyncProvider>));

  expect(processPendingQueues).toHaveBeenCalledTimes(1);
  expect(getPendingMutations).toHaveBeenCalled();
});

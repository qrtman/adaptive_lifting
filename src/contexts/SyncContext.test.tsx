// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { authState, processPendingQueues, getPendingMutations, getConflictedMutations, countMutationsByStatus, conflictCard } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
  processPendingQueues: vi.fn(async () => []),
  getPendingMutations: vi.fn(async () => []),
  getConflictedMutations: vi.fn(async () => []),
  countMutationsByStatus: vi.fn(async () => 0),
  conflictCard: vi.fn(() => null),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../services/db', () => ({ getPendingMutations, getConflictedMutations, countMutationsByStatus }));
vi.mock('../services/sync_engine', () => ({ isLockSyncCode: () => false, processPendingQueues }));
vi.mock('../components/ConflictReviewCard', () => ({ ConflictReviewCard: conflictCard }));
vi.mock('../components/WorkoutLockBanner', () => ({ WorkoutLockBanner: () => null }));
vi.mock('../components/SyncQueueOverlay', () => ({ SyncQueueOverlay: () => null }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;

beforeEach(() => {
  authState.user = null;
  processPendingQueues.mockClear().mockResolvedValue([]);
  getPendingMutations.mockClear().mockResolvedValue([]);
  getConflictedMutations.mockClear().mockResolvedValue([]);
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

it('reloads a persisted conflict into the review card after authentication', async () => {
  const conflict = {
    mutation_id: 'old-v1-edit', entity_type: 'ExerciseSet', entity_id: 'set-1',
    fields: { actual: 100 }, conflict: { reason: 'BASELINE_REQUIRED', server_fields: { actual: 105 } },
  };
  getConflictedMutations.mockResolvedValue([conflict] as any);
  const { SyncProvider } = await import('./SyncContext');
  authState.user = { id: 'synthetic-user' };
  await act(async () => root.render(<SyncProvider><span>app</span></SyncProvider>));
  expect(getConflictedMutations).toHaveBeenCalled();
  expect(conflictCard).toHaveBeenCalledWith(expect.objectContaining({
    mutationId: 'old-v1-edit', entityType: 'ExerciseSet', entityId: 'set-1',
    serverFields: { actual: 105 }, clientFields: { actual: 100 },
  }), undefined);
});

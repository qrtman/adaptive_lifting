export type SyncOverlayKind = 'hidden' | 'offline' | 'syncing' | 'error';

export type SyncOverlayState =
  | { kind: 'hidden' }
  | { kind: 'offline'; pendingCount: number }
  | { kind: 'syncing'; pendingCount: number }
  | { kind: 'error'; rejectedCount: number };

export function syncOverlayState(input: {
  isOnline: boolean;
  pendingCount: number;
  rejectedCount: number;
}): SyncOverlayState {
  if (!input.isOnline) return { kind: 'offline', pendingCount: input.pendingCount };
  if (input.rejectedCount > 0) return { kind: 'error', rejectedCount: input.rejectedCount };
  if (input.pendingCount > 0) return { kind: 'syncing', pendingCount: input.pendingCount };
  return { kind: 'hidden' };
}

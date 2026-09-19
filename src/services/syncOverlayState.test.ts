import { describe, expect, it } from 'vitest';
import { syncOverlayState } from './syncOverlayState';

describe('syncOverlayState', () => {
  it('shows offline even with an empty queue', () => {
    expect(syncOverlayState({ isOnline: false, pendingCount: 0, rejectedCount: 0 })).toEqual({
      kind: 'offline',
      pendingCount: 0,
    });
  });

  it('keeps offline above rejected while disconnected', () => {
    expect(syncOverlayState({ isOnline: false, pendingCount: 3, rejectedCount: 1 })).toEqual({
      kind: 'offline',
      pendingCount: 3,
    });
  });

  it('shows syncing when online with a pending queue', () => {
    expect(syncOverlayState({ isOnline: true, pendingCount: 2, rejectedCount: 0 })).toEqual({
      kind: 'syncing',
      pendingCount: 2,
    });
  });

  it('shows error instead of a spinner when rejected rows exist', () => {
    expect(syncOverlayState({ isOnline: true, pendingCount: 2, rejectedCount: 1 })).toEqual({
      kind: 'error',
      rejectedCount: 1,
    });
  });

  it('hides when online with an empty queue', () => {
    expect(syncOverlayState({ isOnline: true, pendingCount: 0, rejectedCount: 0 })).toEqual({
      kind: 'hidden',
    });
  });
});

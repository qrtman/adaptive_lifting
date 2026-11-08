import { describe, expect, it } from 'vitest';
import { sessionReadOnlyReason } from './sessionReadOnly';

describe('sessionReadOnlyReason', () => {
  it('keeps a completed session editable', () => {
    expect(sessionReadOnlyReason({ id: 'w1', status: 'COMPLETED' }, [])).toBeNull();
    expect(sessionReadOnlyReason({ id: 'w1', status: 'Completed' }, [])).toBeNull();
  });

  it('treats a session locked by another writer as read-only', () => {
    expect(sessionReadOnlyReason({ id: 'w1', status: 'PLANNED' }, ['w1'])).toBe('locked');
  });

  it('keeps open, unlocked sessions editable', () => {
    expect(sessionReadOnlyReason({ id: 'w1', status: 'IN_PROGRESS' }, ['w2'])).toBeNull();
    expect(sessionReadOnlyReason(null, ['w1'])).toBeNull();
  });
});

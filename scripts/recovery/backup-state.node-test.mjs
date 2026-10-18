import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBackupState, requiredVerifiedPointFields } from './backup-state.mjs';

const base = {
  now: '2026-10-18T00:45:00.000Z',
  expectedBy: '2026-10-18T01:00:00.000Z',
  maxRunMs: 30 * 60 * 1000,
};
const attempt = { id: 'run-1', state: 'succeeded', startedAt: '2026-10-18T00:10:00.000Z', completedAt: '2026-10-18T00:20:00.000Z' };
const point = {
  artifactId: 'synthetic-artifact-1', attemptId: 'run-1', verifiedAt: '2026-10-18T00:30:00.000Z',
  uploaded: true, readbackHashVerified: true, decryptionAuthenticated: true, restoreVerified: true,
  reconciliationVerified: true, cleanupVerified: true,
};

test('pending and running attempts have explicit states before their deadline', () => {
  assert.deepEqual(evaluateBackupState({ ...base, attempt: null }), { status: 'pending', reason: 'no attempt is due yet' });
  assert.equal(evaluateBackupState({ ...base, attempt: { id: 'run-1', state: 'pending' } }).status, 'pending');
  assert.equal(evaluateBackupState({ ...base, attempt: { id: 'run-1', state: 'running', startedAt: '2026-10-18T00:20:00Z' } }).status, 'running');
});

test('a synthetic lifecycle progresses from queued to running to verified', () => {
  const queued = { id: 'synthetic-run-queued', state: 'pending' };
  const running = { id: 'synthetic-run-active', state: 'running', startedAt: '2026-10-18T00:20:00Z' };
  const completed = { ...attempt, id: 'synthetic-run-complete' };
  const completedPoint = { ...point, attemptId: completed.id };

  assert.equal(evaluateBackupState({ ...base, attempt: queued }).status, 'pending');
  assert.equal(evaluateBackupState({ ...base, attempt: running }).status, 'running');
  assert.equal(evaluateBackupState({ ...base, attempt: completed, point: completedPoint }).status, 'verified');
});

test('only latest fully verified artifact can report verified', () => {
  assert.deepEqual(evaluateBackupState({ ...base, attempt, point }), {
    status: 'verified', reason: 'latest attempt has a complete verified restore point',
  });
  assert.deepEqual(requiredVerifiedPointFields(), [
    'artifactId', 'attemptId', 'verifiedAt', 'uploaded', 'readbackHashVerified', 'decryptionAuthenticated',
    'restoreVerified', 'reconciliationVerified', 'cleanupVerified',
  ]);
});

test('older verified artifact cannot hide a latest failure or incomplete archive', () => {
  const latestFailed = { ...attempt, id: 'run-2', state: 'failed' };
  assert.equal(evaluateBackupState({ ...base, attempt: latestFailed, point }).status, 'failed');
  assert.equal(evaluateBackupState({ ...base, attempt: { ...attempt, id: 'run-2' }, point }).status, 'failed');
  assert.equal(evaluateBackupState({ ...base, attempt, point: { ...point, restoreVerified: false } }).status, 'failed');
});

test('missing, corrupt, or individually incomplete evidence never verifies a completed attempt', () => {
  const cases = [
    null,
    {},
    { ...point, verifiedAt: 'not-a-timestamp' },
    { ...point, artifactId: '   ' },
    { ...point, uploaded: false },
    { ...point, readbackHashVerified: false },
    { ...point, decryptionAuthenticated: false },
    { ...point, restoreVerified: false },
    { ...point, reconciliationVerified: false },
    { ...point, cleanupVerified: false },
  ];

  for (const evidence of cases) {
    assert.equal(evaluateBackupState({ ...base, attempt, point: evidence }).status, 'failed');
  }
});

test('classifier output remains secret-free and does not expose supplied evidence', () => {
  const secretBearingInput = {
    ...attempt,
    id: 'PRIVATE-ATTEMPT-IDENTIFIER',
  };
  const result = evaluateBackupState({
    ...base,
    attempt: secretBearingInput,
    point: { ...point, artifactId: 'PRIVATE-OBJECT-NAME', attemptId: secretBearingInput.id },
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, 'verified');
  assert.doesNotMatch(serialized, /PRIVATE-ATTEMPT-IDENTIFIER|PRIVATE-OBJECT-NAME/);
});

test('missing, failed, and overlong attempts become overdue only after the deadline/limit', () => {
  const after = { ...base, now: '2026-10-18T02:00:00.000Z' };
  assert.equal(evaluateBackupState({ ...after, attempt: null }).status, 'overdue');
  assert.equal(evaluateBackupState({ ...after, attempt: { id: 'run-1', state: 'failed', startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:10:00Z' } }).status, 'overdue');
  assert.equal(evaluateBackupState({ ...after, attempt: { id: 'run-1', state: 'running', startedAt: '2026-10-18T01:55:00Z' } }).status, 'overdue');
  assert.equal(evaluateBackupState({ ...base, now: '2026-10-18T00:41:00Z', attempt: { id: 'run-1', state: 'running', startedAt: '2026-10-18T00:10:00Z' } }).status, 'overdue');
});

test('late or mismatched success cannot pass on an earlier artifact', () => {
  assert.equal(evaluateBackupState({ ...base, now: '2026-10-18T01:30:00Z', attempt: { ...attempt, completedAt: '2026-10-18T01:05:00Z' },
    point: { ...point, verifiedAt: '2026-10-18T01:10:00Z' } }).status, 'overdue');
  assert.equal(evaluateBackupState({ ...base, attempt: { ...attempt, id: 'run-2' }, point }).status, 'failed');
});

test('invalid states, timestamps, and run limits fail closed', () => {
  assert.throws(() => evaluateBackupState({ ...base, expectedBy: 'bad' }), /timestamp/);
  assert.throws(() => evaluateBackupState({ ...base, maxRunMs: 0 }), /maximum run duration/);
  assert.throws(() => evaluateBackupState({ ...base, attempt: { id: 'run-1', state: 'complete' } }), /malformed/);
  assert.throws(() => evaluateBackupState({ ...base, attempt: { id: 'run-1', state: 'running' } }), /timestamp/);
});

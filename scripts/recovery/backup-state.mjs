const ATTEMPT_STATES = new Set(['pending', 'running', 'failed', 'succeeded']);
const VERIFIED_POINT_FIELDS = [
  'artifactId', 'attemptId', 'verifiedAt', 'uploaded', 'readbackHashVerified',
  'decryptionAuthenticated', 'restoreVerified', 'reconciliationVerified', 'cleanupVerified',
];

function timestamp(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid recovery status timestamp: ${field}.`);
  }
  return Date.parse(value);
}

function pointIsComplete(point, attemptId) {
  return Boolean(point && typeof point.artifactId === 'string' && point.artifactId.trim() &&
    point.attemptId === attemptId && point.uploaded === true && point.readbackHashVerified === true &&
    point.decryptionAuthenticated === true && point.restoreVerified === true &&
    point.reconciliationVerified === true && point.cleanupVerified === true &&
    Number.isFinite(Date.parse(point.verifiedAt)));
}

/** Classifies only the latest attempt. Older verified points never hide a newer
 * incomplete, failed, missing, or overdue attempt. This pure function does not
 * read provider state or schedule/dispatch a backup itself.
 */
export function evaluateBackupState({ now, expectedBy, maxRunMs, attempt = null, point = null }) {
  const nowMs = timestamp(now, 'now');
  const dueMs = timestamp(expectedBy, 'expectedBy');
  if (!Number.isSafeInteger(maxRunMs) || maxRunMs < 1) throw new Error('A positive maximum run duration is required.');
  const overdue = nowMs > dueMs;
  const status = (candidate, reason) => ({ status: candidate, reason });

  if (attempt === null) return status(overdue ? 'overdue' : 'pending', overdue ? 'expected backup is missing' : 'no attempt is due yet');
  if (!attempt || typeof attempt.id !== 'string' || !attempt.id.trim() || !ATTEMPT_STATES.has(attempt.state)) {
    throw new Error('Latest backup attempt is malformed.');
  }
  if (attempt.state === 'pending') return status(overdue ? 'overdue' : 'pending', overdue ? 'expected backup has not started' : 'latest attempt is queued');
  const startedMs = timestamp(attempt.startedAt, 'attempt.startedAt');
  if (attempt.state === 'running') {
    return nowMs - startedMs > maxRunMs
      ? status('overdue', 'latest attempt exceeded its maximum run duration')
      : status('running', 'latest attempt is still running');
  }

  const completedMs = timestamp(attempt.completedAt, 'attempt.completedAt');
  if (attempt.state === 'failed') return status(overdue ? 'overdue' : 'failed', overdue ? 'latest attempt failed and the next backup is overdue' : 'latest attempt failed');
  if (completedMs > nowMs) throw new Error('Latest backup completion is in the future.');
  if (!pointIsComplete(point, attempt.id)) {
    return status(overdue ? 'overdue' : 'failed', overdue ? 'latest attempt has no complete verified restore point' : 'latest attempt evidence is incomplete');
  }
  const verifiedMs = timestamp(point.verifiedAt, 'point.verifiedAt');
  if (verifiedMs > nowMs) throw new Error('Restore-point verification is in the future.');
  if (verifiedMs < completedMs) throw new Error('Restore-point verification predates backup completion.');
  if (completedMs > dueMs || verifiedMs > dueMs) return status('overdue', 'latest verified restore point missed its deadline');
  return status('verified', 'latest attempt has a complete verified restore point');
}

export function requiredVerifiedPointFields() {
  return [...VERIFIED_POINT_FIELDS];
}

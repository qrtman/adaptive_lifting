import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/recovery-daily-backup.yml', import.meta.url);
const monitorUrl = new URL('../../.github/workflows/recovery-backup-missed-run-monitor.yml', import.meta.url);

const workflow = await readFile(workflowUrl, 'utf8');
const monitor = await readFile(monitorUrl, 'utf8');

function extractJobCondition(source, jobName) {
  const jobStart = source.indexOf(`  ${jobName}:`);
  assert.notEqual(jobStart, -1, `missing job ${jobName}`);
  const conditionStart = source.indexOf('    if: >-', jobStart);
  assert.notEqual(conditionStart, -1, `missing condition for ${jobName}`);
  const nextKey = source.indexOf('\n    runs-on:', conditionStart);
  assert.notEqual(nextKey, -1, `condition for ${jobName} must end before runs-on`);
  return source.slice(conditionStart, nextKey);
}

const productionCondition = extractJobCondition(workflow, 'production-backup');
const monitorCondition = extractJobCondition(monitor, 'check-latest-scheduled-success');

// This truth table mirrors the reviewed GitHub condition below. It is a local
// deterministic gate check; it does not execute GitHub Actions expressions.
function productionGate({ enabled, scheduleEnabled, eventName, ref, defaultBranch }) {
  return enabled === 'true' && (
    (eventName === 'schedule' && scheduleEnabled === 'true') ||
    (eventName === 'workflow_dispatch' && ref === `refs/heads/${defaultBranch}`)
  );
}

test('production job condition retains both fail-closed flags and event/branch guards', () => {
  assert.match(productionCondition, /vars\.RECOVERY_BACKUP_ENABLED == 'true'/);
  assert.match(productionCondition, /github\.event_name == 'schedule'/);
  assert.match(productionCondition, /vars\.RECOVERY_BACKUP_SCHEDULE_ENABLED == 'true'/);
  assert.match(productionCondition, /github\.event_name == 'workflow_dispatch'/);
  assert.match(productionCondition, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
});

test('off and manual-only settings never enable scheduled production backups', () => {
  const base = {
    scheduleEnabled: 'false',
    eventName: 'schedule',
    ref: 'refs/heads/main',
    defaultBranch: 'main',
  };
  assert.equal(productionGate({ ...base, enabled: 'false' }), false);
  assert.equal(productionGate({ ...base, enabled: 'true' }), false);
  assert.equal(productionGate({
    ...base,
    enabled: 'true',
    scheduleEnabled: 'true',
  }), true);
});

test('manual dispatch is restricted to the repository default branch', () => {
  const base = { enabled: 'true', scheduleEnabled: 'false', eventName: 'workflow_dispatch', defaultBranch: 'main' };
  assert.equal(productionGate({ ...base, ref: 'refs/heads/main' }), true);
  assert.equal(productionGate({ ...base, ref: 'refs/heads/feature/backup' }), false);
  assert.equal(productionGate({ ...base, enabled: 'false', ref: 'refs/heads/main' }), false);
});

test('missed-run monitor remains disabled unless both opt-in flags and schedule event are present', () => {
  assert.match(monitorCondition, /github\.event_name == 'schedule'/);
  assert.match(monitorCondition, /github\.ref_type == 'branch'/);
  assert.match(monitorCondition, /vars\.RECOVERY_BACKUP_ENABLED == 'true'/);
  assert.match(monitorCondition, /vars\.RECOVERY_BACKUP_SCHEDULE_ENABLED == 'true'/);

  const monitorGate = ({ enabled, scheduleEnabled, eventName, refType }) =>
    eventName === 'schedule' && refType === 'branch' &&
    enabled === 'true' && scheduleEnabled === 'true';
  assert.equal(monitorGate({ enabled: 'false', scheduleEnabled: 'true', eventName: 'schedule', refType: 'branch' }), false);
  assert.equal(monitorGate({ enabled: 'true', scheduleEnabled: 'false', eventName: 'schedule', refType: 'branch' }), false);
  assert.equal(monitorGate({ enabled: 'true', scheduleEnabled: 'true', eventName: 'workflow_dispatch', refType: 'branch' }), false);
  assert.equal(monitorGate({ enabled: 'true', scheduleEnabled: 'true', eventName: 'schedule', refType: 'branch' }), true);
});

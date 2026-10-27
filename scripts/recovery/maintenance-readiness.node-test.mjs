import test from 'node:test';
import assert from 'node:assert/strict';
import { MAINTENANCE_READINESS_SQL, assessMaintenanceReadiness, collectMaintenanceReadiness,
  runProductionMaintenanceInspection, validateMaintenanceMetadata } from './maintenance-readiness.mjs';

const metadata = () => ({ database: 'postgres', role: 'postgres', sessionRole: 'postgres',
  serverVersionNum: '170011', readOnly: true, isolation: 'repeatable read', appliedMigrations: 63,
  scopedTables: 37, scopedSequences: 1, cronJobs: 2, activeCronJobs: 2,
  loginRoles: 5, privilegedLoginRoles: 2, preparedTransactions: 0,
  runtimeCanLogin: true, pgNetInstalled: true, vaultInstalled: true });
const observedAt = new Date('2026-10-27T00:00:00.000Z');
const sensitive = 'SYNTHETIC_PRIVATE_DIAGNOSTIC_MUST_NOT_ESCAPE';
function harness({ failureAt, badMetadata } = {}) {
  const calls = [];
  return { calls, client: { identity: { database: 'postgres', tls: true, version: '170011' },
    async query(sql) {
      calls.push(sql);
      if (calls.length === failureAt) throw new Error(sensitive);
      return { rowCount: 1, rows: [{ metadata: badMetadata ?? metadata() }] };
    }, async close() { calls.push('close'); } } };
}
const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main' };
const eventGate = { allowed: true, event: 'workflow_dispatch', ref: 'refs/heads/main' };

test('read-only probe executes a fixed bounded transaction and confirms rollback before reporting', async () => {
  const f = harness();
  const report = await collectMaintenanceReadiness({ client: f.client, observedAt });
  assert.deepEqual(f.calls, ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'SET LOCAL search_path = pg_catalog',
    "SET LOCAL statement_timeout = '10s'", "SET LOCAL lock_timeout = '2s'", MAINTENANCE_READINESS_SQL, 'ROLLBACK']);
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.captureAllowed, false);
  assert.equal(report.observations.scopedSequences, 1);
  assert.ok(report.blockers.includes('SEQUENCE_FENCE_AND_RECOVERY_NOT_VERIFIED'));
  assert.equal(report.observedAt, observedAt.toISOString());
});

test('all-green metadata never establishes a writer freeze or recovery readiness', () => {
  const green = { ...metadata(), scopedSequences: 0, activeCronJobs: 0, runtimeCanLogin: false,
    pgNetInstalled: false, privilegedLoginRoles: 0, preparedTransactions: 0 };
  const report = assessMaintenanceReadiness(green, observedAt);
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.captureAllowed, false);
  assert.equal(report.writerFreeze, 'NOT TESTED'); assert.equal(report.interruptionRecovery, 'NOT TESTED');
  assert.equal(report.productionRecovery, 'NOT TESTED');
  assert.deepEqual(report.blockers, ['CLOSED_WRITER_INVENTORY_NOT_REVIEWED',
    'WRITER_FREEZE_NOT_VERIFIED', 'INDEPENDENT_FENCED_CLEANUP_NOT_VERIFIED']);
});

test('inactive cron does not imply previously dispatched pg_net workers drained', () => {
  const report = assessMaintenanceReadiness({ ...metadata(), activeCronJobs: 0 }, observedAt);
  assert.ok(!report.blockers.includes('ACTIVE_CRON_JOBS'));
  assert.ok(report.blockers.includes('DISPATCHED_WORKER_DRAIN_NOT_VERIFIED'));
});

test('prepared transactions and privileged writers remain explicit blockers', () => {
  const report = assessMaintenanceReadiness({ ...metadata(), preparedTransactions: 1 }, observedAt);
  assert.ok(report.blockers.includes('PREPARED_TRANSACTIONS_PRESENT'));
  assert.ok(report.blockers.includes('PRIVILEGED_WRITER_COVERAGE_NOT_VERIFIED'));
});

test('malformed, extra, missing, wrong-identity and coercible metadata fail closed', () => {
  const mutations = [v => { v.database = 'staging'; }, v => { v.role = 'runtime'; },
    v => { v.sessionRole = 'runtime'; }, v => { v.readOnly = false; },
    v => { v.serverVersionNum = '160011'; }, v => { v.serverVersionNum = 170011; },
    v => { v.serverVersionNum = ['170011']; }, v => { v.isolation = 'read committed'; },
    v => { v.scopedSequences = '1'; }, v => { v.scopedTables = -1; },
    v => { v.scopedTables = Infinity; }, v => { v.activeCronJobs = 3; },
    v => { v.privilegedLoginRoles = 6; }, v => { v.pgNetInstalled = 1; },
    v => { delete v.runtimeCanLogin; }, v => { v.private = sensitive; }];
  for (const mutate of mutations) {
    const value = metadata(); mutate(value);
    assert.throws(() => validateMaintenanceMetadata(value), e => !e.message.includes(sensitive));
  }
  assert.throws(() => assessMaintenanceReadiness(metadata(), new Date(NaN)));
});

test('every transaction failure attempts rollback, suppresses diagnostics and never reports observations', async () => {
  for (const failureAt of [1, 2, 3, 4, 5, 6]) {
    const f = harness({ failureAt });
    await assert.rejects(collectMaintenanceReadiness({ client: f.client, observedAt }), e => {
      assert.doesNotMatch(JSON.stringify(e.evidence) + e.message, new RegExp(sensitive));
      assert.equal(e.evidence.cleanup, failureAt === 6 ? 'FAIL' : 'PASS');
      assert.equal(e.evidence.status, 'failed'); return true;
    });
    assert.equal(f.calls.at(-1), 'ROLLBACK');
  }
});

test('unverified transport or source identity is rejected without issuing metadata queries', async () => {
  for (const identity of [{ database: 'staging', tls: true, version: '170011' },
    { database: 'postgres', tls: false, version: '170011' },
    { database: 'postgres', tls: true, version: '160011' }]) {
    const f = harness(); f.client.identity = identity;
    await assert.rejects(collectMaintenanceReadiness({ client: f.client }));
    assert.deepEqual(f.calls, []);
  }
});

test('metadata query has no application/Vault rows, secret-bearing columns or source mutation', () => {
  assert.doesNotMatch(MAINTENANCE_READINESS_SQL, /vault\.secrets|decrypted_secret|rolpassword|\bcommand\b|query\s*,|nextval|setval|ALTER |UPDATE |DELETE |INSERT /i);
  assert.match(MAINTENANCE_READINESS_SQL, /pg_prepared_xacts/);
});

test('manual hosted inspection closes the connection and flags cannot turn observations into authorization', async () => {
  const f = harness();
  const report = await runProductionMaintenanceInspection({ env: { ...env, RECOVERY_BACKUP_ENABLED: 'true',
    RECOVERY_FREE_CAPACITY_REVIEWED: 'true', RECOVERY_RESTORE_ENABLED: 'true' },
    platform: 'linux', eventGate, connectSource: async () => f.client, observedAt });
  assert.equal(f.calls.at(-1), 'close'); assert.equal(report.captureAllowed, false); assert.equal(report.cleanup, 'PASS');
});

test('non-hosted, scheduled, wrong-branch and malformed gates never connect', async () => {
  for (const change of [{ env: {} }, { platform: 'win32' },
    { env: { ...env, GITHUB_EVENT_NAME: 'schedule' } }, { eventGate: null },
    { eventGate: { ...eventGate, ref: 'refs/heads/other' } },
    { env: { ...env, GITHUB_REF: 'refs/heads/../main' }, eventGate: { ...eventGate, ref: 'refs/heads/../main' } }]) {
    let called = false;
    await assert.rejects(runProductionMaintenanceInspection({ env, platform: 'linux', eventGate,
      connectSource: async () => { called = true; }, ...change }));
    assert.equal(called, false);
  }
});

test('inspection closes after query failure and suppresses failed close diagnostics', async () => {
  for (const closeFails of [false, true]) {
    const f = harness({ failureAt: closeFails ? undefined : 4 });
    f.client.close = async () => { f.calls.push('close'); if (closeFails) throw new Error(sensitive); };
    await assert.rejects(runProductionMaintenanceInspection({ env, platform: 'linux', eventGate,
      connectSource: async () => f.client }), e => {
      assert.equal(e.evidence.cleanup, closeFails ? 'FAIL' : 'PASS');
      assert.ok(!e.message.includes(sensitive)); return true;
    });
    assert.equal(f.calls.at(-1), 'close');
  }
});



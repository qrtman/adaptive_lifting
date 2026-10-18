import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductionBackupCliOptions,
  deriveGitHubDefaultBranchGate,
  parseProductionReleaseInventory,
  runProductionBackupCli,
} from './production-backup.mjs';

const syntheticInventory = () => ({
  format: 'adaptive-production-release-v1',
  source: {
    project: 'gadusaizqnshxqcckibq',
    host: 'aws-0-ap-northeast-2.pooler.supabase.com',
    port: 5432,
    user: 'postgres.gadusaizqnshxqcckibq',
    database: 'postgres',
    majorVersion: 17,
  },
  schemas: ['public', 'al_private', 'supabase_migrations'],
  expectedRelations: [
    { schema: 'public', name: 'athletes', kind: 'r', persistence: 'p', inherited: false },
    { schema: 'al_private', name: 'session_log', kind: 'r', persistence: 'p', inherited: false },
  ],
  expectedVersions: ['20261002090404', '20261002092347'],
});

const protectedEnv = (extra = {}) => ({
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_REF: 'refs/heads/production-bootstrap',
  RECOVERY_BACKUP_ENABLED: 'true',
  RECOVERY_AGE_RECIPIENT: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  RECOVERY_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  RECOVERY_R2_BUCKET: 'adaptive-backups',
  RECOVERY_R2_PREFIX: 'production/recovery',
  AWS_ACCESS_KEY_ID: 'synthetic-access-key',
  AWS_SECRET_ACCESS_KEY: 'synthetic-secret-key',
  ...extra,
});

test('scheduled run accepts a safe default-branch ref with the documented empty payload', () => {
  assert.deepEqual(deriveGitHubDefaultBranchGate({
    env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/production-bootstrap' },
    eventPayload: {},
  }), {
    allowed: true,
    event: 'schedule',
    ref: 'refs/heads/production-bootstrap',
  });
});

test('scheduled run rejects tags and unsafe refs', () => {
  for (const ref of ['refs/tags/v1.0.0', 'refs/heads/../private', 'refs/heads/branch name']) {
    assert.equal(deriveGitHubDefaultBranchGate({
      env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: ref },
      eventPayload: {},
    }), null);
  }
});

test('workflow dispatch accepts only the payload repository default branch', () => {
  assert.deepEqual(deriveGitHubDefaultBranchGate({
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/production-bootstrap' },
    eventPayload: { repository: { default_branch: 'production-bootstrap' } },
  }), {
    allowed: true,
    event: 'workflow_dispatch',
    ref: 'refs/heads/production-bootstrap',
  });
  assert.equal(deriveGitHubDefaultBranchGate({
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature/backup' },
    eventPayload: { repository: { default_branch: 'production-bootstrap' } },
  }), null);
});

test('workflow dispatch rejects missing or malformed default branch data', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' };
  for (const eventPayload of [{}, { repository: {} }, { repository: { default_branch: '../main' } }, null]) {
    assert.equal(deriveGitHubDefaultBranchGate({ env, eventPayload }), null);
  }
});

test('strictly parses a reviewed inventory and constructs pinned CLI options', () => {
  const inventory = parseProductionReleaseInventory(syntheticInventory());
  const options = buildProductionBackupCliOptions({
    env: protectedEnv(),
    platform: 'linux',
    eventPayload: {},
    inventory,
  });
  assert.deepEqual(options.expectedRelations, syntheticInventory().expectedRelations);
  assert.deepEqual(options.expectedVersions, syntheticInventory().expectedVersions);
  assert.equal(options.sourceTarget.project, 'gadusaizqnshxqcckibq');
  assert.equal(options.eventGate.ref, 'refs/heads/production-bootstrap');
  assert.equal(options.recipient, protectedEnv().RECOVERY_AGE_RECIPIENT);
  assert.equal(options.r2.prefix, 'production/recovery');
  assert.equal(Object.hasOwn(options, 'privateIdentity'), false);
});

test('inventory parser rejects wrong target, unknown fields, duplicate relations and unsorted versions', () => {
  const wrongTarget = syntheticInventory();
  wrongTarget.source.host = 'attacker.example';
  assert.throws(() => parseProductionReleaseInventory(wrongTarget), /pinned target/);

  const unknownField = syntheticInventory();
  unknownField.extra = true;
  assert.throws(() => parseProductionReleaseInventory(unknownField), /shape or pinned target/);

  const duplicate = syntheticInventory();
  duplicate.expectedRelations.push({ ...duplicate.expectedRelations[0] });
  assert.throws(() => parseProductionReleaseInventory(duplicate), /duplicates/);

  const unsorted = syntheticInventory();
  unsorted.expectedVersions.reverse();
  assert.throws(() => parseProductionReleaseInventory(unsorted), /unique and sorted/);
});

test('CLI fails closed on missing reviewed inventory before invoking backup runner', async () => {
  let backupCalls = 0;
  const result = await runProductionBackupCli({
    env: protectedEnv(),
    platform: 'linux',
    readEventPayload: async () => ({}),
    loadInventory: async () => { throw new Error('Blocked: committed inventory is unavailable.'); },
    backupRunner: async () => { backupCalls += 1; return { status: 'captured-restore-unverified' }; },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /^Blocked:/);
  assert.equal(backupCalls, 0);
});

test('CLI exposes only the verified receipt key after a capture-only success', async () => {
  const result = await runProductionBackupCli({
    env: protectedEnv(),
    platform: 'linux',
    readEventPayload: async () => ({}),
    loadInventory: async () => parseProductionReleaseInventory(syntheticInventory()),
    backupRunner: async () => ({
      status: 'captured-restore-unverified',
      artifacts: [
        { kind: 'archive', key: 'production/recovery/20261018/archive.age', size: 410, sha256: 'b'.repeat(64), byteVerified: true },
        { kind: 'manifest', key: 'production/recovery/20261018/manifest.age', size: 218, sha256: 'c'.repeat(64), byteVerified: true },
        { kind: 'receipt', key: 'production/recovery/20261018/receipt.age', size: 83, sha256: 'a'.repeat(64), byteVerified: true },
      ],
    }),
  });
  assert.deepEqual(result, {
    ok: true,
    status: 'captured-restore-unverified',
    receiptKey: 'production/recovery/20261018/receipt.age',
  });
  assert.equal(Object.hasOwn(result, 'restoreVerified'), false);
});

test('CLI fails closed if no verified receipt key is available', async () => {
  const result = await runProductionBackupCli({
    env: protectedEnv(),
    platform: 'linux',
    readEventPayload: async () => ({}),
    loadInventory: async () => parseProductionReleaseInventory(syntheticInventory()),
    backupRunner: async () => ({ status: 'captured-restore-unverified', artifacts: [] }),
  });
  assert.equal(result.ok, false);
  assert.equal('receiptKey' in result, false);
});

test('CLI rejects duplicate or out-of-prefix recovery object keys', async (t) => {
  for (const mutate of [
    (artifacts) => { artifacts[2].key = artifacts[1].key; },
    (artifacts) => { artifacts[2].key = 'other/recovery/receipt.age'; },
  ]) {
    await t.test('invalid object key set', async () => {
      const artifacts = [
        { kind: 'archive', key: 'production/recovery/20261018/archive.age', size: 410, sha256: 'b'.repeat(64), byteVerified: true },
        { kind: 'manifest', key: 'production/recovery/20261018/manifest.age', size: 218, sha256: 'c'.repeat(64), byteVerified: true },
        { kind: 'receipt', key: 'production/recovery/20261018/receipt.age', size: 83, sha256: 'a'.repeat(64), byteVerified: true },
      ];
      mutate(artifacts);
      const result = await runProductionBackupCli({
        env: protectedEnv(),
        platform: 'linux',
        readEventPayload: async () => ({}),
        loadInventory: async () => parseProductionReleaseInventory(syntheticInventory()),
        backupRunner: async () => ({ status: 'captured-restore-unverified', artifacts }),
      });
      assert.equal(result.ok, false);
      assert.equal('receiptKey' in result, false);
    });
  }
});

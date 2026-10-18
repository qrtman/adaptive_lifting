import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PRODUCTION_SOURCE } from './production-source.mjs';
import { runProductionBackup } from './production-backup.mjs';

const env = Object.freeze({
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  RUNNER_TEMP: '/runner/temp',
  RECOVERY_BACKUP_ENABLED: 'true',
});
const r2 = Object.freeze({ accountId: '0123456789abcdef0123456789abcdef', bucket: 'synthetic-backups', prefix: 'production/adaptive-lifting' });
const recipient = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const expectedRelations = [{ schema: 'public', name: 'synthetic_table', kind: 'r', persistence: 'p', inherited: false }];
const expectedVersions = ['202610180001'];
const protectedRow = 'SYNTHETIC_SOURCE_ROW_MUST_NOT_ESCAPE';
const protectedDiagnostic = 'SYNTHETIC_PROVIDER_DIAGNOSTIC_MUST_NOT_ESCAPE';

function makeHarness({ failUploadAt = null, badReadbackAt = null, captureResult = null } = {}) {
  const calls = { connect: [], prepareCa: 0, capture: 0, createArchive: 0, encrypted: [], uploaded: [], cleanup: [], order: [], close: 0 };
  const ciphertext = new Map();
  let sequence = 0;
  const adapters = {
    async connectSource(args) {
      calls.connect.push(args);
      assert.deepEqual(args.expectedSource, PRODUCTION_SOURCE);
      return {
        query: async () => ({ rows: [] }),
        close: async () => { calls.close += 1; },
        identity: { database: 'postgres', version: '170006', tls: true },
      };
    },
    async prepareCaFile() {
      calls.prepareCa += 1;
      return { path: '/runner/temp/synthetic-ca.pem', cleanup: async () => { calls.cleanup.push('ca'); } };
    },
    createArchiveCapture(args) {
      calls.createArchive += 1;
      assert.equal(typeof args.encrypt, 'function');
      return async () => args.encrypt(Readable.from([Buffer.from('SYNTHETIC_ARCHIVE_BYTES')]));
    },
    async encryptArchiveStream(stream, suppliedRecipient, options) {
      assert.equal(suppliedRecipient, recipient);
      assert.deepEqual(options.env, env);
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const plaintext = Buffer.concat(chunks);
      calls.encrypted.push(plaintext.toString('utf8'));
      calls.order.push('encrypt');
      const outputPath = `/private/synthetic-${++sequence}.age`;
      // Synthetic envelope marker lets the test ensure upload sees only adapter-encrypted bytes.
      ciphertext.set(outputPath, Buffer.concat([Buffer.from('SYNTHETIC-CIPHERTEXT\0'), plaintext]));
      return { outputPath, cleanup: async () => { calls.cleanup.push(outputPath); ciphertext.delete(outputPath); } };
    },
    async uploadAndVerifyCiphertext(args) {
      const index = calls.uploaded.length;
      const bytes = ciphertext.get(args.sourcePath);
      assert.ok(bytes, 'upload receives a live encrypted artifact');
      assert.ok(bytes.subarray(0, 21).equals(Buffer.from('SYNTHETIC-CIPHERTEXT\0')));
      calls.uploaded.push({ ...args, bytes: Buffer.from(bytes) });
      calls.order.push('upload');
      if (failUploadAt === index) throw new Error(protectedDiagnostic);
      return {
        key: args.key,
        size: bytes.length,
        sha256: badReadbackAt === index ? '0'.repeat(64) : 'a'.repeat(64),
        byteVerified: badReadbackAt !== index,
      };
    },
    newObjectKey(prefix, now) {
      return `${prefix}/${now.toISOString().replaceAll(':', '').replaceAll('-', '')}/${++sequence}.age`;
    },
    async captureSnapshot(args) {
      calls.capture += 1;
      assert.equal(args.client.identity.database, 'postgres');
      assert.deepEqual(args.schemas, ['public', 'al_private', 'supabase_migrations']);
      await args.captureArchive({ snapshot: 'synthetic-snapshot', dumpArgs: ['synthetic-dump'] });
      await args.persistManifest({ syntheticRow: protectedRow, format: 'synthetic' });
      return captureResult ?? { status: 'captured-restore-unverified', archive: { byteVerified: true }, tableCount: 1 };
    },
  };
  return { calls, adapters };
}

function backupOptions(adapters, extra = {}) {
  return {
    env,
    platform: 'linux',
    eventGate: { allowed: true, event: 'schedule', ref: 'refs/heads/main' },
    sourceTarget: { ...PRODUCTION_SOURCE },
    expectedRelations,
    expectedVersions,
    r2,
    recipient,
    now: new Date('2026-10-18T00:00:00.000Z'),
    adapters,
    ...extra,
  };
}

test('injected synthetic flow encrypts archive and manifest, uploads immutable distinct keys, and verifies byte readback', async () => {
  const { calls, adapters } = makeHarness();
  const result = await runProductionBackup(backupOptions(adapters));

  assert.equal(result.status, 'captured-restore-unverified');
  assert.equal(result.artifacts.length, 2);
  assert.deepEqual(result.artifacts.map(({ kind }) => kind), ['archive', 'manifest']);
  assert.equal(new Set(result.artifacts.map(({ key }) => key)).size, 2);
  assert.ok(result.artifacts.every(({ byteVerified }) => byteVerified === true));
  assert.ok(calls.encrypted.some((text) => text === 'SYNTHETIC_ARCHIVE_BYTES'));
  assert.ok(calls.encrypted.some((text) => text.includes(protectedRow)));
  assert.equal(calls.uploaded.length, 2);
  assert.deepEqual(calls.order, ['encrypt', 'encrypt', 'upload', 'upload']);
  assert.ok(calls.uploaded.every(({ key, bytes }) => key.startsWith('production/adaptive-lifting/') && bytes.includes(Buffer.from('SYNTHETIC-CIPHERTEXT\0'))));
  assert.equal(calls.cleanup.filter((item) => item === 'ca').length, 1);
  assert.equal(calls.cleanup.filter((item) => typeof item === 'string' && item.endsWith('.age')).length, 2);
  assert.equal(calls.close, 1);
  assert.equal('restoreVerified' in result, false);
  assert.equal('verified' in result, false);
  assert.equal(JSON.stringify(result).includes(protectedRow), false);
  assert.equal(JSON.stringify(result).includes('/private/'), false);
});

test('hosted Linux, explicit caller gate, and recipient-only identity checks precede source connection', async (t) => {
  const cases = [
    ['non-hosted runner', { env: { ...env, RUNNER_ENVIRONMENT: 'self-hosted' } }],
    ['non-Linux platform', { platform: 'win32' }],
    ['caller gate disabled', { eventGate: { allowed: false, event: 'schedule', ref: 'refs/heads/main' } }],
    ['pull request event rejected', { eventGate: { allowed: true, event: 'pull_request', ref: 'refs/heads/main' } }],
    ['malformed branch ref rejected', { eventGate: { allowed: true, event: 'schedule', ref: 'refs/heads/../main' } }],
    ['backup opt-in disabled', { env: { ...env, RECOVERY_BACKUP_ENABLED: 'false' } }],
    ['AGE private identity in environment', { env: { ...env, AGE_SECRET_KEY: 'synthetic-private-identity' } }],
    ['invalid public recipient', { recipient: 'not-a-recipient' }],
  ];
  for (const [label, override] of cases) {
    await t.test(label, async () => {
      const { calls, adapters } = makeHarness();
      await assert.rejects(runProductionBackup(backupOptions(adapters, override)), /Production backup failed/);
      assert.equal(calls.connect.length, 0);
      assert.equal(calls.capture, 0);
    });
  }
});

test('scheduled and manually dispatched events on the default branch are accepted', async (t) => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    await t.test(event, async () => {
      const { calls, adapters } = makeHarness();
      const result = await runProductionBackup(backupOptions(adapters, {
        eventGate: { allowed: true, event, ref: 'refs/heads/main' },
      }));
      assert.equal(result.status, 'captured-restore-unverified');
      assert.equal(calls.connect.length, 1);
    });
  }
});

test('each pinned source identity field rejects a mismatch before connection', async (t) => {
  const mismatches = {
    project: 'wrong-project',
    host: 'wrong.example.invalid',
    user: 'wrong-user',
    database: 'wrong-database',
    majorVersion: 16,
  };
  for (const [field, value] of Object.entries(mismatches)) {
    await t.test(field, async () => {
      const { calls, adapters } = makeHarness();
      const sourceTarget = { ...PRODUCTION_SOURCE, [field]: value };
      await assert.rejects(runProductionBackup(backupOptions(adapters, { sourceTarget })), /Production backup failed/);
      assert.equal(calls.connect.length, 0);
    });
  }
});

test('wrong connected database or PostgreSQL version prevents capture and closes the connection', async (t) => {
  for (const identity of [
    { database: 'wrong-database', version: '170006', tls: true },
    { database: 'postgres', version: '160006', tls: true },
    { database: 'postgres', version: '170006', tls: false },
  ]) {
    await t.test(JSON.stringify(identity), async () => {
      const { calls, adapters } = makeHarness();
      adapters.connectSource = async () => ({
        query: async () => ({ rows: [] }),
        close: async () => { calls.close += 1; },
        identity,
      });
      await assert.rejects(runProductionBackup(backupOptions(adapters)), /Production backup failed/);
      assert.equal(calls.capture, 0);
      assert.equal(calls.close, 1);
    });
  }
});

test('upload and readback failures are sanitized, prevent success, and still clean owned resources', async (t) => {
  for (const failure of [{ failUploadAt: 0 }, { badReadbackAt: 0 }, { failUploadAt: 1 }, { badReadbackAt: 1 }]) {
    await t.test(JSON.stringify(failure), async () => {
      const { calls, adapters } = makeHarness(failure);
      let thrown;
      try { await runProductionBackup(backupOptions(adapters)); } catch (error) { thrown = error; }
      assert.ok(thrown);
      assert.match(thrown.message, /Production backup failed/);
      assert.doesNotMatch(thrown.message, /SYNTHETIC_PROVIDER_DIAGNOSTIC|SYNTHETIC_SOURCE_ROW/);
      assert.equal(calls.close, 1);
      assert.equal(calls.cleanup.filter((item) => item === 'ca').length, 1);
      assert.ok(calls.cleanup.some((item) => typeof item === 'string' && item.endsWith('.age')));
      assert.equal(JSON.stringify(thrown).includes(protectedDiagnostic), false);
    });
  }
});

test('an unverified capture result cannot be turned into a verified recovery point', async () => {
  const { calls, adapters } = makeHarness({ captureResult: { status: 'verified', restoreVerified: true } });
  await assert.rejects(runProductionBackup(backupOptions(adapters)), /Production backup failed/);
  assert.equal(calls.close, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRODUCTION_SOURCE,
  connectPinnedProductionSource,
  connectProductionSource,
  pgDumpEnvironment,
  productionArchiveCapture,
  productionClientConfig,
  startProductionPgDump,
  validateCaBundle,
  verifyPgDumpVersion,
  writePgDumpCaFile,
} from './production-source.mjs';
import { snapshotDumpArgs } from './snapshot-capture.mjs';

const env = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  RECOVERY_DB_PASSWORD: 'synthetic-protected-password',
  RECOVERY_DB_CA_PEM: '-----BEGIN CERTIFICATE-----\nsynthetic-public-ca\n-----END CERTIFICATE-----\n',
  PATH: '/usr/bin:/bin',
  PGHOST: 'staging.invalid',
  PGPORT: '6543',
  PGDATABASE: 'staging',
  PGSERVICE: 'staging',
};
const linux = 'linux';
const snapshot = '00000003-0000001B-1';
const schemas = ['public', 'al_private', 'supabase_migrations'];

async function withCaFile(callback) {
  const root = await mkdtemp(join(tmpdir(), 'adaptive-test-'));
  try {
    const caFile = await writePgDumpCaFile({ env: { ...env, RUNNER_TEMP: root }, platform: linux, tempRoot: root });
    return await callback(caFile, { ...env, RUNNER_TEMP: root });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('production target and TLS config are fixed and explicitly verified', () => {
  const config = productionClientConfig(env);
  assert.deepEqual({ host: config.host, port: config.port, user: config.user, database: config.database }, {
    host: PRODUCTION_SOURCE.host, port: PRODUCTION_SOURCE.port, user: PRODUCTION_SOURCE.user, database: PRODUCTION_SOURCE.database,
  });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.servername, PRODUCTION_SOURCE.host);
  assert.equal(config.password, env.RECOVERY_DB_PASSWORD);
  assert.equal('connectionString' in config, false);
  assert.equal(validateCaBundle(env.RECOVERY_DB_CA_PEM), env.RECOVERY_DB_CA_PEM);
  assert.throws(() => validateCaBundle('-----BEGIN CERTIFICATE----- broken'), /malformed/);
  assert.throws(() => productionClientConfig({ ...env, RECOVERY_DB_PASSWORD: '' }), /missing/);
  assert.throws(() => productionClientConfig({ ...env, RECOVERY_DB_CA_PEM: 'attacker input' }), /malformed/);
});

test('source client refuses local runner and bad source identity before exposing queries', async () => {
  let created = false;
  class Client {
    constructor(config) { created = true; this.config = config; }
    on() {}
    async connect() {}
    async query() { return { rows: [{ database: 'wrong', version: '170006', tls: true }] }; }
    async end() {}
  }
  await assert.rejects(connectProductionSource({ Client, env: {}, platform: 'win32' }), /hosted Linux/);
  assert.equal(created, false);
  await assert.rejects(connectProductionSource({ Client, env, platform: linux }), /identity check failed/);
  await assert.rejects(connectPinnedProductionSource({ env: {}, platform: 'win32' }), /hosted Linux/);
});

test('connected client validates database, server major and encrypted transport', async () => {
  let clientConfig;
  let closed = false;
  class Client {
    constructor(config) { clientConfig = config; }
    on() {}
    async connect() {}
    async query(sql) {
      assert.match(sql, /pg_stat_ssl/);
      return { rows: [{ database: 'postgres', version: '170006', tls: true }] };
    }
    async end() { closed = true; }
  }
  const source = await connectProductionSource({ Client, env, platform: linux });
  assert.equal(source.identity.tls, true);
  assert.equal(clientConfig.host, PRODUCTION_SOURCE.host);
  assert.equal(clientConfig.ssl.rejectUnauthorized, true);
  await source.close();
  assert.equal(closed, true);
});

test('CA temp material is private and cleaned after use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adaptive-test-'));
  try {
    const material = await writePgDumpCaFile({ env: { ...env, RUNNER_TEMP: root }, platform: linux, tempRoot: root });
    assert.equal(await readFile(material.path, 'utf8'), validateCaBundle(env.RECOVERY_DB_CA_PEM));
    assert.ok(material.path.startsWith(root));
    if (process.platform === 'linux') assert.equal((await stat(material.path)).mode & 0o777, 0o600);
    await material.cleanup();
    await assert.rejects(stat(material.path));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pg_dump receives a binary stdout stream and no inherited staging or password argv', async () => {
  let called;
  const spawn = (executable, args, options) => {
    called = { executable, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.end(Buffer.from([0, 1, 2, 255]));
      child.stderr.end('synthetic native warning');
      child.emit('close', 0);
    });
    return child;
  };
  const dump = startProductionPgDump({ snapshot, schemas, env, platform: linux, caPath: '/tmp/db-root.crt', spawn });
  const chunks = [];
  for await (const chunk of dump.archive) chunks.push(chunk);
  await dump.completion;
  assert.equal(Buffer.concat(chunks).toString('hex'), '000102ff');
  assert.equal(called.executable, 'pg_dump');
  assert.deepEqual(called.args, ['--no-password', '--format=custom', '--strict-names', '--file=-',
    `--snapshot=${snapshot}`, ...schemas.map((schema) => `--schema=${schema}`)]);
  assert.ok(!called.args.join(' ').includes(env.RECOVERY_DB_PASSWORD));
  assert.equal(called.options.shell, false);
  assert.equal(called.options.env.PGHOST, PRODUCTION_SOURCE.host);
  assert.equal(called.options.env.PGSSLMODE, 'verify-full');
  assert.equal(called.options.env.PGSSLROOTCERT, '/tmp/db-root.crt');
  assert.equal(called.options.env.PGDATABASE, 'postgres');
  assert.equal(called.options.env.PGPORT, '5432');
  assert.equal(called.options.env.PGUSER, PRODUCTION_SOURCE.user);
  assert.equal(called.options.env.PGPASSWORD, env.RECOVERY_DB_PASSWORD);
  assert.equal(called.options.env.PGSERVICE, undefined);
  assert.equal(called.options.env.PGHOST === env.PGHOST, false);
});

test('pg_dump rejects local runner, unsafe snapshot/schema and non-production archive scope', async () => {
  const noop = () => { throw new Error('spawn should not run'); };
  assert.throws(() => startProductionPgDump({ snapshot, schemas, env: {}, platform: 'win32', caPath: '/tmp/ca', spawn: noop }), /hosted Linux/);
  assert.throws(() => startProductionPgDump({ snapshot: '--host=evil', schemas, env, platform: linux, caPath: '/tmp/ca', spawn: noop }), /snapshot/);
  assert.throws(() => startProductionPgDump({ snapshot, schemas: ['public*'], env, platform: linux, caPath: '/tmp/ca', spawn: noop }), /allowlist/);
  assert.throws(() => productionArchiveCapture({ env, platform: linux, caPath: '/tmp/ca', encrypt: async () => ({}), schemas: ['public'] }), /fixed/);
});

test('pg_dump version check accepts only PostgreSQL 17 and omits DB passwords', async () => {
  const spawnFor = (version) => (_executable, args, options) => {
    assert.deepEqual(args, ['--version']);
    assert.equal(options.env.PGPASSWORD, undefined);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = () => true;
    setImmediate(() => { child.stdout.end(`pg_dump (PostgreSQL) ${version}\n`); child.emit('close', 0); });
    return child;
  };
  assert.equal(await verifyPgDumpVersion({ env, platform: linux, caPath: '/tmp/ca', spawn: spawnFor('17.4') }), '17');
  await assert.rejects(verifyPgDumpVersion({ env, platform: linux, caPath: '/tmp/ca', spawn: spawnFor('16.9') }), /must match/);
});

test('snapshot archive adapter waits for encryption and successful pg_dump completion', async () => {
  const spawn = (_executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    if (args[0] === '--version') {
      assert.equal(options.env.PGPASSWORD, undefined);
      setImmediate(() => { child.stdout.end('pg_dump (PostgreSQL) 17.4\n'); child.emit('close', 0); });
    } else setImmediate(() => {
      child.stdout.end(Buffer.from('synthetic archive'));
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  };
  await withCaFile(async (caFile, captureEnv) => {
    const order = [];
    const capture = productionArchiveCapture({ env: captureEnv, platform: linux, caFile, spawn,
      encrypt: async (stream) => {
        let bytes = 0;
        for await (const chunk of stream) bytes += chunk.length;
        order.push('encrypted');
        return { bytes, cleanup: async () => {} };
      } });
    const result = await capture({ snapshot, dumpArgs: snapshotDumpArgs(snapshot, schemas) });
    order.push('done');
    assert.deepEqual(order, ['encrypted', 'done']);
    assert.equal(result.bytes, Buffer.byteLength('synthetic archive'));
  });
});

test('failed native dump cannot return encrypted output and diagnostics stay suppressed', async () => {
  const spawn = (_executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    if (args[0] === '--version') {
      assert.equal(options.env.PGPASSWORD, undefined);
      setImmediate(() => { child.stdout.end('pg_dump (PostgreSQL) 17.4\n'); child.emit('close', 0); });
    } else setImmediate(() => {
      child.stdout.end(Buffer.from('partial synthetic archive'));
      child.stderr.end('private-row secret');
      child.emit('close', 1);
    });
    return child;
  };
  await withCaFile(async (caFile, captureEnv) => {
    let cleaned = false;
    const capture = productionArchiveCapture({ env: captureEnv, platform: linux, caFile, spawn,
      encrypt: async (stream) => { for await (const _chunk of stream) {} return { cleanup: async () => { cleaned = true; } }; } });
    await assert.rejects(capture({ snapshot, dumpArgs: snapshotDumpArgs(snapshot, schemas) }), (error) => {
      assert.equal(error.message, 'Encrypted source archive capture failed.');
      assert.doesNotMatch(error.message, /private-row|secret/);
      return true;
    });
    assert.equal(cleaned, true);
  });
});

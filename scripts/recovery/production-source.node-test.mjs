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
  parseArchiveToc,
  productionArchiveCapture,
  productionClientConfig,
  reconcileArchiveToc,
  reconcileCatalogInventory,
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

const catalogFixture = [
  { kind: 'SCHEMA', schema: null, identity: 'public', definitionSha256: 'a'.repeat(64) },
  { kind: 'TABLE', schema: 'public', identity: 'private_workouts', definitionSha256: 'b'.repeat(64) },
  { kind: 'FUNCTION', schema: 'public', identity: 'private_lookup(integer, text)', definitionSha256: 'c'.repeat(64) },
  { kind: 'ROLE', schema: null, identity: 'private_role', definitionSha256: 'd'.repeat(64) },
  { kind: 'SEQUENCE', schema: 'public', identity: 'private_workouts_id_seq', definitionSha256: 'e'.repeat(64) },
  { kind: 'EXTENSION', schema: 'extensions', identity: 'private_extension', definitionSha256: 'f'.repeat(64) },
];
const tocFixture = [
  { description: 'SCHEMA', schema: '-', tag: 'public', owner: 'postgres' },
  { description: 'TABLE', schema: 'public', tag: 'private_workouts', owner: 'postgres' },
  { description: 'TABLE DATA', schema: 'public', tag: 'private_workouts', owner: 'postgres' },
  { description: 'FUNCTION', schema: 'public', tag: 'private_lookup(integer, text)', owner: 'postgres' },
  { description: 'SEQUENCE SET', schema: 'public', tag: 'private_workouts_id_seq', owner: 'postgres' },
  { description: 'ACL', schema: 'public', tag: 'TABLE private_workouts', owner: 'postgres' },
  { description: 'DEFAULT ACL', schema: 'public', tag: 'DEFAULT PRIVILEGES FOR TABLES', owner: 'postgres' },
];
function tocText(entries = tocFixture) {
  return '; Synthetic PostgreSQL 17 listing\n; Selected TOC Entries:\n' + entries.map((entry, index) =>
    `${index + 1}; 1259 ${16000 + index} ${entry.description} ${entry.schema} ${entry.tag} ${entry.owner}`).join('\n') + '\n';
}

function redactedFailure(pattern) {
  return (error) => {
    assert.match(error.message, pattern);
    assert.match(error.message, /Review the protected inventory/);
    assert.doesNotMatch(error.message, /private_|synthetic-protected-password/);
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('catalog comparison is deterministic across record and property order', () => {
  const expected = structuredClone(catalogFixture);
  const actual = expected.toReversed().map(({ identity, definitionSha256, kind, schema }) =>
    ({ identity, definitionSha256, kind, schema }));
  const result = reconcileCatalogInventory({ expected, actual });
  assert.equal(result.status, 'catalog-matched');
  assert.equal(result.objectCount, catalogFixture.length);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, reconcileCatalogInventory({ expected: actual, actual: expected }));
});

test('catalog comparison rejects missing objects and changed protected metadata', () => {
  assert.throws(() => reconcileCatalogInventory({ expected: catalogFixture, actual: catalogFixture.slice(1) }),
    redactedFailure(/missing=1, inconsistent=0, unexpected=0/));
  const actual = structuredClone(catalogFixture);
  actual[1].definitionSha256 = '0'.repeat(64);
  assert.throws(() => reconcileCatalogInventory({ expected: catalogFixture, actual }),
    redactedFailure(/missing=0, inconsistent=1, unexpected=0/));
});

test('catalog comparison rejects unexpected objects rather than filtering them', () => {
  const actual = [...catalogFixture, { ...catalogFixture[1], identity: 'private_unreviewed_table' }];
  assert.throws(() => reconcileCatalogInventory({ expected: catalogFixture, actual }),
    redactedFailure(/missing=0, inconsistent=0, unexpected=1/));
});

test('catalog comparison rejects empty, duplicate, malformed and unsupported evidence', () => {
  assert.throws(() => reconcileCatalogInventory(null), redactedFailure(/comparison inputs are malformed/));
  for (const actual of [[], [...catalogFixture, catalogFixture[0]],
    [{ ...catalogFixture[0], definitionSha256: 'private_invalid_digest' }],
    [{ ...catalogFixture[0], kind: 'UNSUPPORTED' }],
    [{ ...catalogFixture[0], extra: 'private_secret' }]]) {
    assert.throws(() => reconcileCatalogInventory({ expected: catalogFixture, actual }),
      redactedFailure(/Recovery catalog validation failed/));
  }
});

test('archive TOC parser preserves multitype objects, exact routine signatures and owners', () => {
  assert.deepEqual(parseArchiveToc(tocText()), tocFixture);
  assert.deepEqual(parseArchiveToc(tocText().replaceAll('\n', '\r\n')), tocFixture);
  assert.deepEqual(reconcileArchiveToc({ expectedEntries: tocFixture.toReversed(), tocText: tocText() }),
    { status: 'archive-toc-matched', entryCount: tocFixture.length });
});

test('archive TOC reconciliation rejects a missing table-data or sequence-state entry', () => {
  for (const description of ['TABLE DATA', 'SEQUENCE SET']) {
    assert.throws(() => reconcileArchiveToc({ expectedEntries: tocFixture,
      tocText: tocText(tocFixture.filter((record) => record.description !== description)) }),
    redactedFailure(/missing=1, inconsistent=0, unexpected=0/));
  }
});

test('archive TOC reconciliation rejects unexpected objects and changed ownership', () => {
  const unexpected = [...tocFixture, { description: 'TABLE', schema: 'public', tag: 'private_unreviewed', owner: 'postgres' }];
  assert.throws(() => reconcileArchiveToc({ expectedEntries: tocFixture, tocText: tocText(unexpected) }),
    redactedFailure(/missing=0, inconsistent=0, unexpected=1/));
  const inconsistent = structuredClone(tocFixture);
  inconsistent[1].owner = 'private_unreviewed_role';
  assert.throws(() => reconcileArchiveToc({ expectedEntries: tocFixture, tocText: tocText(inconsistent) }),
    redactedFailure(/missing=0, inconsistent=1, unexpected=0/));
});

test('archive TOC parser rejects malformed and unsupported listings without exposing content', () => {
  for (const text of ['', '; private_empty_listing', '1; 0 0 UNKNOWN public private_secret postgres',
    '1; 0 0 TABLE public private_secret postgres\n1; 0 1 TABLE public private_other postgres',
    '0; 0 0 TABLE public private_secret postgres', '01; 0 0 TABLE public private_secret postgres',
    '1; 4294967296 0 TABLE public private_secret postgres', '1; 0 0 TABLE public private_secret "quoted owner"',
    '1; 0 0 TABLE public private_secret postgres\u0000', 'private_secret native failure']) {
    assert.throws(() => parseArchiveToc(text), redactedFailure(/Recovery archive TOC validation failed/));
  }
});

test('archive TOC comparison rejects duplicate identities and malformed reviewed input', () => {
  assert.throws(() => reconcileArchiveToc(null), redactedFailure(/comparison inputs are malformed/));
  assert.throws(() => reconcileArchiveToc({ expectedEntries: tocFixture,
    tocText: tocText([...tocFixture, tocFixture[1]]) }), redactedFailure(/duplicate object identity/));
  for (const expectedEntries of [[], [...tocFixture, tocFixture[1]],
    [{ ...tocFixture[0], description: 'UNSUPPORTED' }], [{ ...tocFixture[0], extra: 'private_secret' }]]) {
    assert.throws(() => reconcileArchiveToc({ expectedEntries, tocText: tocText() }),
      redactedFailure(/Recovery archive TOC validation failed/));
  }
});

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
  assert.deepEqual(called.args, ['--no-password', '--format=custom', '--strict-names',
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

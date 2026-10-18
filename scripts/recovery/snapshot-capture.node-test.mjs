import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureSnapshot, quoteIdentifier, snapshotDumpArgs } from './snapshot-capture.mjs';

const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
const relation = { schema: 'public', name: 'workouts', kind: 'r', persistence: 'p', inherited: false };
const version = '20261001000000';
const catalog = {
  owner: 'postgres', kind: 'r', row_security: true, force_row_security: false, acl: null,
  columns: [{ name: 'kg', type: 'numeric', not_null: false, identity: '', generated: '', default: null }],
  constraints: [{ name: 'workouts_pkey', type: 'p', definition: 'PRIMARY KEY (id)', validated: true, deferrable: false, deferred: false }],
  indexes: [{ name: 'workouts_pkey', definition: 'CREATE UNIQUE INDEX workouts_pkey ON public.workouts USING btree (id)', primary: true, unique: true, valid: true, ready: true }],
  triggers: [],
  policies: [{ name: 'workouts_owner', command: 'r', permissive: true, roles: ['authenticated'], using: '(owner_id = auth.uid())', check: null }],
};
function fixture({ inventory = [relation], catalogRows = [catalog], rows = ['{"kg":9007199254740993.123,"deleted_at":null}'], chunks, failAt, rollbackFails = false } = {}) {
  const queries = [];
  let fetch = 0;
  return { queries, async query(sql, values) {
    queries.push({ sql, values });
    if (failAt && sql.includes(failAt)) throw new Error('private-user-row secret-token');
    if (sql === 'ROLLBACK' && rollbackFails) throw new Error('private-source');
    if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'postgres', read_only: 'on', version: '170006', tls: true }] };
    if (sql.includes('AS policies')) return { rows: catalogRows };
    if (sql.includes('c.relkind AS kind')) return { rows: inventory };
    if (sql.includes('to_jsonb(m)::text AS record')) return { rows: [{ version, record: JSON.stringify({ version, statements: ['CREATE TABLE synthetic_fixture (id integer);'] }) }] };
    if (sql.startsWith('SELECT pg_export_snapshot')) return { rows: [{ snapshot: '00000003-0000001B-1', captured_at: '2026-10-15 00:00:00+00' }] };
    if (sql.startsWith('FETCH')) return { rows: fetch++ === 0 ? (chunks ?? rows.map((payload) => ({ row_bytes: `${Buffer.byteLength(payload)}`, offset: '1', chunk: payload }))) : [] };
    return { rows: [] };
  } };
}
function options(client, more = {}) {
  return { client, schemas: ['public', 'supabase_migrations'], expectedRelations: [relation], expectedVersions: [version],
    env, platform: 'linux', captureArchive: async () => ({ encrypted: true }), persistManifest: async () => {}, ...more };
}

test('snapshot stays open until archive and encrypted manifest sinks finish; only ROLLBACK closes it', async () => {
  const client = fixture();
  let manifest;
  const result = await captureSnapshot(options(client, {
    captureArchive: async ({ snapshot, dumpArgs }) => {
      assert.equal(snapshot, '00000003-0000001B-1');
      assert.ok(dumpArgs.includes('--snapshot=00000003-0000001B-1'));
      assert.ok(!client.queries.some((q) => q.sql === 'ROLLBACK'));
      return { key: 'synthetic.age' };
    }, persistManifest: async (value) => {
      assert.ok(!client.queries.some((q) => q.sql === 'ROLLBACK'));
      manifest = value;
    },
  }));
  assert.equal(client.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(client.queries[1].sql, /row_security=off/);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(result.status, 'captured-restore-unverified');
  const payload = '{"kg":9007199254740993.123,"deleted_at":null}';
  const expected = createHash('sha256').update(`${Buffer.byteLength(payload)}:`).update(payload).digest('hex');
  assert.equal(manifest.tables[0].sha256, expected);
  assert.equal(manifest.tables[0].count, 1);
  assert.equal(manifest.tables[0].catalog.owner, 'postgres');
  assert.equal(manifest.tables[0].catalog.row_security, true);
  assert.equal(manifest.tables[0].catalog.columns[0].type, 'numeric');
  assert.equal(manifest.tables[0].catalog.constraints[0].validated, true);
  assert.equal(manifest.tables[0].catalog.indexes[0].valid, true);
  assert.deepEqual(manifest.tables[0].catalog.policies[0].roles, ['authenticated']);
  assert.deepEqual(manifest.migrationVersions, [version]);
  assert.equal(manifest.migrationLedger.count, 1);
  assert.equal(manifest.migrationLedger.sha256,
    createHash('sha256').update(`${Buffer.byteLength(JSON.stringify({ version, statements: ['CREATE TABLE synthetic_fixture (id integer);'] }))}:`)
      .update(JSON.stringify({ version, statements: ['CREATE TABLE synthetic_fixture (id integer);'] })).digest('hex'));
  const catalogQuery = client.queries.find((q) => q.sql.includes('AS policies'));
  assert.deepEqual(catalogQuery.values, ['public', 'workouts']);
  assert.match(catalogQuery.sql, /pg_get_constraintdef/);
  assert.match(catalogQuery.sql, /pg_get_triggerdef/);
  assert.match(client.queries.find((q) => q.sql.startsWith('DECLARE')).sql, /FROM ONLY "public"\."workouts"/);
  assert.match(client.queries.find((q) => q.sql.startsWith('DECLARE')).sql, /FOR 16384/);
});

test('empty tables get a zero count and hash instead of being omitted', async () => {
  const client = fixture({ rows: [] });
  let manifest;
  await captureSnapshot(options(client, { persistManifest: async (m) => { manifest = m; } }));
  assert.equal(manifest.tables.length, 1);
  assert.equal(manifest.tables[0].count, 0);
  assert.equal(manifest.tables[0].sha256, createHash('sha256').digest('hex'));
});

test('chunked large UTF-8 rows hash losslessly without client-side whole-row buffering', async () => {
  const payload = '한'.repeat(20000);
  const client = fixture({ chunks: [
    { row_bytes: `${Buffer.byteLength(payload)}`, offset: '1', chunk: payload.slice(0, 16384) },
    { row_bytes: `${Buffer.byteLength(payload)}`, offset: '16385', chunk: payload.slice(16384) },
  ] });
  let manifest;
  await captureSnapshot(options(client, { persistManifest: async (m) => { manifest = m; } }));
  assert.equal(manifest.tables[0].count, 1);
  assert.equal(manifest.tables[0].sha256, createHash('sha256').update(`${Buffer.byteLength(payload)}:`).update(payload).digest('hex'));
});

test('oversized or truncated manifest chunks fail closed', async () => {
  for (const chunks of [
    [{ row_bytes: '70000', offset: '1', chunk: 'x'.repeat(70000) }],
    [{ row_bytes: '10', offset: '1', chunk: 'x' }],
  ]) await assert.rejects(captureSnapshot(options(fixture({ chunks }))), /Snapshot capture failed/);
});

test('unreviewed or unsupported relations fail before archive output', async () => {
  for (const inventory of [[], [{ ...relation, name: 'unknown' }], [{ ...relation, kind: 'p' }], [{ ...relation, inherited: true }]]) {
    const client = fixture({ inventory });
    let called = false;
    await assert.rejects(captureSnapshot(options(client, { captureArchive: async () => { called = true; } })), /Snapshot capture failed/);
    assert.equal(called, false);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  }
});

test('migration mismatch fails before snapshot export and archive output', async () => {
  const client = fixture();
  await assert.rejects(captureSnapshot(options(client, { expectedVersions: ['20261002000000'] })), /Snapshot capture failed/);
  assert.ok(!client.queries.some((q) => q.sql.startsWith('SELECT pg_export_snapshot')));
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
});

test('migration ledger digest covers full recorded statements and malformed records fail closed', async () => {
  const first = fixture();
  const original = first.query.bind(first);
  first.query = async (sql, values) => sql.includes('to_jsonb(m)::text AS record')
    ? { rows: [{ version, record: JSON.stringify({ version, statements: ['SELECT 1;'] }) }] }
    : original(sql, values);
  let manifest;
  await captureSnapshot(options(first, { persistManifest: async (value) => { manifest = value; } }));
  const second = fixture();
  const secondOriginal = second.query.bind(second);
  second.query = async (sql, values) => sql.includes('to_jsonb(m)::text AS record')
    ? { rows: [{ version, record: JSON.stringify({ version, statements: ['SELECT 2;'] }) }] }
    : secondOriginal(sql, values);
  let changedManifest;
  await captureSnapshot(options(second, { persistManifest: async (value) => { changedManifest = value; } }));
  assert.notEqual(manifest.migrationLedger.sha256, changedManifest.migrationLedger.sha256);

  for (const records of [[], [{ version, record: '' }], [{ version: 'not-a-version', record: '{}' }]]) {
    const client = fixture();
    const query = client.query.bind(client);
    client.query = async (sql, values) => sql.includes('to_jsonb(m)::text AS record')
      ? { rows: records } : query(sql, values);
    let archiveStarted = false;
    await assert.rejects(captureSnapshot(options(client, { captureArchive: async () => { archiveStarted = true; } })), /Snapshot capture failed/);
    assert.equal(archiveStarted, false);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  }
});

test('missing or malformed relation catalog metadata fails before archive output', async () => {
  for (const catalogRows of [[], [{ ...catalog, owner: null }], [{ ...catalog, row_security: 'true' }]]) {
    const client = fixture({ catalogRows });
    let archiveStarted = false;
    await assert.rejects(captureSnapshot(options(client, { captureArchive: async () => { archiveStarted = true; } })), /Snapshot capture failed/);
    assert.equal(archiveStarted, false);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  }
});

test('database identity mismatch, unverified TLS or server-major mismatch fail before capture', async () => {
  for (const identity of [
    { database: 'staging', read_only: 'on', version: '170006', tls: true },
    { database: 'postgres', read_only: 'on', version: '170006', tls: false },
    { database: 'postgres', read_only: 'on', version: '160010', tls: true },
  ]) {
    const client = fixture();
    const original = client.query.bind(client);
    client.query = async (sql, values) => sql.startsWith('SELECT current_database')
      ? { rows: [identity] } : original(sql, values);
    let archiveStarted = false;
    await assert.rejects(captureSnapshot(options(client, { captureArchive: async () => { archiveStarted = true; } })), /Snapshot capture failed/);
    assert.equal(archiveStarted, false);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  }
});

test('archive, manifest and database failures always roll back and suppress sensitive diagnostics', async () => {
  for (const stage of ['query', 'archive', 'manifest']) {
    const client = fixture(stage === 'query' ? { failAt: 'FETCH' } : {});
    const fail = async () => { throw new Error('private-user-row secret-token'); };
    const sinks = stage === 'archive' ? { captureArchive: fail } : stage === 'manifest' ? { persistManifest: fail } : {};
    await assert.rejects(captureSnapshot(options(client, sinks)), (error) => {
      assert.doesNotMatch(JSON.stringify(error) + error.message, /private-user-row|secret-token/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  }
});

test('manifest persistence failure cleans an already-created archive and hides cleanup details', async () => {
  const client = fixture();
  let cleaned = false;
  await assert.rejects(captureSnapshot(options(client, {
    captureArchive: async () => ({ encrypted: true, cleanup: async () => { cleaned = true; } }),
    persistManifest: async () => { throw new Error('private manifest secret'); },
  })), (error) => {
    assert.match(error.message, /Snapshot capture failed/);
    assert.doesNotMatch(error.message, /private manifest secret/);
    return true;
  });
  assert.equal(cleaned, true);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
});

test('archive cleanup failure remains visible without leaking the underlying diagnostic', async () => {
  const client = fixture();
  await assert.rejects(captureSnapshot(options(client, {
    captureArchive: async () => ({ encrypted: true, cleanup: async () => { throw new Error('private filesystem path'); } }),
    persistManifest: async () => { throw new Error('private manifest secret'); },
  })), (error) => {
    assert.match(error.message, /archive cleanup also failed/);
    assert.doesNotMatch(error.message, /private filesystem path|private manifest secret/);
    return true;
  });
});

test('transaction cleanup failure never reports captured status', async () => {
  await assert.rejects(captureSnapshot(options(fixture({ rollbackFails: true }))), /transaction cleanup failed/);
});

test('transaction rollback failure also cleans the archive temporary material', async () => {
  let cleaned = false;
  await assert.rejects(captureSnapshot(options(fixture({ rollbackFails: true }), {
    captureArchive: async () => ({ encrypted: true, cleanup: async () => { cleaned = true; } }),
  })), /transaction cleanup failed/);
  assert.equal(cleaned, true);
});

test('local/self-hosted capture rejects before touching supplied client', async () => {
  const client = fixture();
  for (const more of [{ env: {} }, { platform: 'win32' }, { env: { ...env, RUNNER_ENVIRONMENT: 'self-hosted' } }]) {
    await assert.rejects(captureSnapshot(options(client, more)), /hosted Linux/);
  }
  assert.equal(client.queries.length, 0);
});

test('dump flags preserve owners and ACLs; snapshot/schema input cannot inject options or SQL', () => {
  const args = snapshotDumpArgs('00000003-0000001B-1', ['public', 'al_private', 'supabase_migrations']);
  assert.ok(args.includes('--strict-names') && args.includes('--file=-'));
  assert.ok(!args.includes('--no-owner') && !args.includes('--no-acl'));
  for (const value of ["x'; COMMIT;--", '--snapshot=other', '']) assert.throws(() => snapshotDumpArgs(value, ['public']));
  assert.throws(() => snapshotDumpArgs('00000003-0000001B-1', ['public*']));
  assert.equal(quoteIdentifier('a"b'), '"a""b"');
  assert.throws(() => quoteIdentifier('a\0b'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReviewedCatalogScope, assertSyntheticCatalogFixture, canonicalCatalogRecords,
  catalogEvidenceSql, collectCatalogEvidence, collectSyntheticArchiveToc, syntheticCatalogExpectedIdentities,
} from './catalog-evidence.mjs';
import { reconcileArchiveToc, reconcileCatalogInventory } from './production-source.mjs';

// Independently authored synthetic expectations. No DB/credentials/processes are
// created, and no observed collector records are used to manufacture expectations.
const SCHEMA = 'synthetic_recovery';
const object = (kind, identity, definition, schema = SCHEMA) => ({ kind, schema, identity, definition });
const roleDefinition = () => ({ superuser: false, inherit: true, createRole: false, createDb: false,
  canLogin: false, replication: false, bypassRls: false, connectionLimit: -1, validUntil: null, configuration: [] });
const tableDefinition = () => ({ owner: 'postgres', acl: null, persistence: 'p', options: [], replicaIdentity: 'd', tablespace: null, accessMethod: 'heap' });
const columnDefinition = () => ({ type: 'bigint', notNull: true, identity: '', generated: '', default: null,
  collation: null, acl: null, storage: 'p', compression: '' });
const constraintDefinition = () => ({ definition: 'PRIMARY KEY (id)', validated: true, deferrable: false, deferred: false });
const indexDefinition = () => ({ owner: 'postgres', definition: 'CREATE UNIQUE INDEX workouts_pkey ON synthetic_recovery.workouts USING btree (id)',
  valid: true, ready: true, clustered: false, replicaIdentity: false, options: [], tablespace: null });
const sequenceDefinition = () => ({ owner: 'postgres', acl: null, type: 'bigint', start: '1', increment: '1', minimum: '1',
  maximum: '9223372036854775807', cache: '1', cycle: false, lastValue: '25', isCalled: true });
const functionDefinition = () => ({ owner: 'postgres', acl: null, definition: 'CREATE OR REPLACE FUNCTION synthetic_recovery.touch_workout()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$BEGIN RETURN NEW; END$function$\n',
  configuration: [], securityDefiner: false, leakproof: false });
const dependency = () => ({ source: { type: 'table column', schema: SCHEMA, name: 'workouts', identity: 'synthetic_recovery.workouts.id' },
  target: { type: 'type', schema: 'pg_catalog', name: 'int8', identity: 'bigint' }, dependencyType: 'n' });
function reviewedEntries() {
  return [
    object('SCHEMA', SCHEMA, { owner: 'postgres', acl: null }),
    object('TABLE', 'workouts', tableDefinition()),
    object('COLUMN', 'workouts.id', columnDefinition()),
    object('CONSTRAINT', 'workouts.workouts_pkey', constraintDefinition()),
    object('INDEX', 'workouts_pkey', indexDefinition()),
    object('TRIGGER', 'workouts.workouts_touch', { definition: 'CREATE TRIGGER workouts_touch BEFORE UPDATE ON synthetic_recovery.workouts FOR EACH ROW EXECUTE FUNCTION synthetic_recovery.touch_workout()', enabled: 'O' }),
    object('POLICY', 'workouts.workouts_owner', { command: '*', permissive: true, roles: ['PUBLIC'], using: "(athlete_id = (current_setting('app.user_id'::text, true))::uuid)", check: null }),
    object('ROW SECURITY', 'workouts', { enabled: true, forced: false }),
    object('FUNCTION', 'touch_workout()', functionDefinition()),
    object('PROCEDURE', 'refresh_workout()', { ...functionDefinition(), definition: 'CREATE PROCEDURE synthetic_recovery.refresh_workout() LANGUAGE SQL AS $$ SELECT 1 $$' }),
    object('SEQUENCE', 'workout_id_seq', sequenceDefinition()),
    object('VIEW', 'workout_view', { owner: 'postgres', acl: null, definition: 'SELECT id FROM synthetic_recovery.workouts;', options: [] }),
    object('MATERIALIZED VIEW', 'workout_cache', { owner: 'postgres', acl: null, definition: 'SELECT id FROM synthetic_recovery.workouts;', options: [], populated: true, tablespace: null, accessMethod: 'heap' }),
    object('TYPE', 'session_state', { owner: 'postgres', acl: null, type: 'e', definition: ['draft', 'finished'] }),
    object('ROLE', 'al_recovery_reader', roleDefinition(), null),
    object('ROLE MEMBERSHIP', 'al_recovery_reader>postgres@postgres', { role: 'al_recovery_reader', member: 'postgres', grantor: 'postgres', admin: false, inherit: true, set: true }, null),
    object('DEFAULT ACL', 'postgres:r', { owner: 'postgres', objectType: 'r', acl: ['al_recovery_reader=r/postgres'] }),
    object('EXTENSION', 'plpgsql', { owner: 'postgres', schema: 'pg_catalog', version: '1.0', relocatable: false, configuration: [], conditions: [], members: ['language plpgsql'] }, null),
    object('EXTERNAL DEPENDENCY', 'table column:synthetic_recovery.workouts.id>type:bigint:n', dependency(), null),
  ];
}
function census(entries = reviewedEntries()) {
  return { version: 17, isolation: 'repeatable read', readOnly: 'on', searchPath: 'pg_catalog', schemas: [SCHEMA], complete: true, unsupported: [], entries };
}
function clientFor(value = census(), sequence = { last_value: '25', is_called: true }) {
  const calls = [];
  return { calls, query: async (sql, values) => {
    calls.push({ sql, values });
    return { rowCount: 1, rows: [sql.startsWith('SELECT last_value') ? sequence : { evidence: structuredClone(value) }] };
  } };
}

test('all supported kinds hash deterministically independent of object key order and inventory order', () => {
  const expected = canonicalCatalogRecords(reviewedEntries());
  const reversed = reviewedEntries().reverse().map((entry) => ({ ...entry,
    definition: Object.fromEntries(Object.entries(entry.definition).reverse()) }));
  assert.deepEqual(canonicalCatalogRecords(reversed), expected);
  assert.equal(expected.length, 19);
  assert.equal(reconcileCatalogInventory({ expected, actual: canonicalCatalogRecords(reversed) }).status, 'catalog-matched');
});

for (const [name, kind, field, replacement] of [
  ['owner', 'TABLE', 'owner', 'another_owner'], ['ACL', 'TABLE', 'acl', ['al_recovery_reader=ar/postgres']],
  ['column default', 'COLUMN', 'default', '999'], ['constraint', 'CONSTRAINT', 'definition', 'CHECK (id > 5)'],
  ['index validity', 'INDEX', 'valid', false], ['trigger', 'TRIGGER', 'enabled', 'D'],
  ['policy security', 'POLICY', 'using', 'true'], ['RLS security', 'ROW SECURITY', 'forced', true],
  ['function security', 'FUNCTION', 'securityDefiner', true], ['procedure security', 'PROCEDURE', 'leakproof', true],
  ['sequence value', 'SEQUENCE', 'lastValue', '26'], ['sequence called state', 'SEQUENCE', 'isCalled', false],
  ['sequence parameters', 'SEQUENCE', 'increment', '2'], ['role bypass', 'ROLE', 'bypassRls', true],
  ['membership', 'ROLE MEMBERSHIP', 'admin', true], ['default privilege', 'DEFAULT ACL', 'acl', []],
  ['extension version', 'EXTENSION', 'version', '1.1'], ['extension member', 'EXTENSION', 'members', ['language changed']],
  ['dependency metadata', 'EXTERNAL DEPENDENCY', 'dependencyType', 'a'], ['type order', 'TYPE', 'definition', ['finished', 'draft']],
]) {
  test(`exact inventory comparison rejects changed ${name}`, () => {
    const actual = reviewedEntries();
    actual.find((entry) => entry.kind === kind).definition[field] = replacement;
    assert.throws(() => reconcileCatalogInventory({ expected: canonicalCatalogRecords(reviewedEntries()), actual: canonicalCatalogRecords(actual) }), /inconsistent=1/);
  });
}

test('NULL default ACL differs from an explicit empty ACL', () => {
  const expected = reviewedEntries();
  const actual = reviewedEntries(); actual[1].definition.acl = [];
  assert.notEqual(canonicalCatalogRecords(expected).find((r) => r.kind === 'TABLE').definitionSha256,
    canonicalCatalogRecords(actual).find((r) => r.kind === 'TABLE').definitionSha256);
});

for (const [name, mutate] of [
  ['empty', () => []], ['duplicate', (entries) => [...entries, entries[0]]],
  ['unsupported kind', (entries) => [{ ...entries[0], kind: 'COLLATION' }]],
  ['extra envelope field', (entries) => [{ ...entries[0], ignored: true }]],
  ['missing owner', (entries) => { delete entries[0].definition.owner; return entries; }],
  ['malformed boolean', (entries) => { entries.find((e) => e.kind === 'ROW SECURITY').definition.enabled = 'true'; return entries; }],
  ['unsafe sequence integer', (entries) => { entries.find((e) => e.kind === 'SEQUENCE').definition.lastValue = '9223372036854775808'; return entries; }],
  ['numeric sequence coercion', (entries) => { entries.find((e) => e.kind === 'SEQUENCE').definition.lastValue = 25; return entries; }],
  ['malformed dependency', (entries) => { delete entries.find((e) => e.kind === 'EXTERNAL DEPENDENCY').definition.target.identity; return entries; }],
  ['malformed ACL', (entries) => { entries[0].definition.acl = [null]; return entries; }],
  ['missing namespace', (entries) => { entries[1].schema = null; return entries; }],
  ['ambiguous identifier', (entries) => { entries[1].identity = 'work.outs'; return entries; }],
]) test(`canonicalization rejects ${name}`, () => assert.throws(() => canonicalCatalogRecords(mutate(reviewedEntries())), /Recovery evidence rejected/));

test('independent exact membership rejects missing, unexpected, duplicate and malformed records', () => {
  const records = canonicalCatalogRecords(reviewedEntries());
  // This independent reviewed list describes the small raw fixture above.
  const expectedIdentities = [
    ['SCHEMA', SCHEMA, SCHEMA], ['TABLE', SCHEMA, 'workouts'], ['COLUMN', SCHEMA, 'workouts.id'],
    ['CONSTRAINT', SCHEMA, 'workouts.workouts_pkey'], ['INDEX', SCHEMA, 'workouts_pkey'],
    ['TRIGGER', SCHEMA, 'workouts.workouts_touch'], ['POLICY', SCHEMA, 'workouts.workouts_owner'],
    ['ROW SECURITY', SCHEMA, 'workouts'], ['FUNCTION', SCHEMA, 'touch_workout()'], ['PROCEDURE', SCHEMA, 'refresh_workout()'],
    ['SEQUENCE', SCHEMA, 'workout_id_seq'], ['VIEW', SCHEMA, 'workout_view'], ['MATERIALIZED VIEW', SCHEMA, 'workout_cache'],
    ['TYPE', SCHEMA, 'session_state'], ['ROLE', null, 'al_recovery_reader'], ['ROLE MEMBERSHIP', null, 'al_recovery_reader>postgres@postgres'],
    ['DEFAULT ACL', SCHEMA, 'postgres:r'], ['EXTENSION', null, 'plpgsql'],
    ['EXTERNAL DEPENDENCY', null, 'table column:synthetic_recovery.workouts.id>type:bigint:n'],
  ].map(([kind, schema, identity]) => ({ kind, schema, identity }));
  assert.equal(assertReviewedCatalogScope({ records, expectedIdentities }).objectCount, 19);
  assert.throws(() => assertReviewedCatalogScope({ records: records.slice(1), expectedIdentities }), /missing=1/);
  assert.throws(() => assertReviewedCatalogScope({ records, expectedIdentities: expectedIdentities.slice(1) }), /unexpected=1/);
  assert.throws(() => assertReviewedCatalogScope({ records: [...records, records[0]], expectedIdentities }), /duplicate/);
  assert.throws(() => assertReviewedCatalogScope({ records: [{ ...records[0], definitionSha256: 'bad' }], expectedIdentities }), /malformed/);
});

test('collector uses parameterized schema census and exact direct sequence state reads', async () => {
  const client = clientFor();
  const result = await collectCatalogEvidence({ client, schemas: [SCHEMA], expectedInventory: reviewedEntries() });
  assert.equal(result.reconciliation.status, 'catalog-matched');
  assert.deepEqual(result.records, canonicalCatalogRecords(reviewedEntries()));
  assert.deepEqual(client.calls[0].values, [[SCHEMA]]);
  assert.equal(client.calls[1].sql, 'SELECT last_value::text AS last_value,is_called FROM "synthetic_recovery"."workout_id_seq"');
  assert.equal(client.calls.length, 2);
});

for (const [name, modify] of [
  ['wrong server', (v) => { v.version = 16; }], ['wrong isolation', (v) => { v.isolation = 'read committed'; }],
  ['writable transaction', (v) => { v.readOnly = 'off'; }], ['unstable search path', (v) => { v.searchPath = 'public'; }],
  ['missing schema', (v) => { v.schemas = []; }], ['duplicate schema', (v) => { v.schemas.push(SCHEMA); }],
  ['partial census', (v) => { v.complete = false; }], ['unsupported object', (v) => { v.unsupported.push('publication'); }],
  ['missing census field', (v) => { delete v.unsupported; }], ['empty objects', (v) => { v.entries = []; }],
  ['escaped schema', (v) => { v.entries[1].schema = 'outside'; }],
]) test(`collector rejects ${name}`, async () => {
  const value = census(); modify(value);
  await assert.rejects(collectCatalogEvidence({ client: clientFor(value), schemas: [SCHEMA] }), /Recovery evidence rejected/);
});

test('collector rejects partial result rows, partial sequence state, invalid inputs and sanitizes query failures', async () => {
  for (const response of [{ rows: [] }, { rows: [{ evidence: census() }, { evidence: census() }] }, { rows: [{ evidence: census() }], rowCount: 0 }]) {
    await assert.rejects(collectCatalogEvidence({ client: { query: async () => response }, schemas: [SCHEMA] }), /census is partial/);
  }
  for (const sequence of [{ last_value: '25' }, { last_value: '25', is_called: 'true' }, { last_value: null, is_called: true }]) {
    await assert.rejects(collectCatalogEvidence({ client: clientFor(census(), sequence), schemas: [SCHEMA] }), /Recovery evidence rejected/);
  }
  for (const schemas of [[], ['bad;sql'], [SCHEMA, SCHEMA], [null], 'schema']) {
    await assert.rejects(collectCatalogEvidence({ client: clientFor(), schemas }), /schema scope is invalid/);
  }
  const secret = 'protected-native-diagnostics';
  await assert.rejects(collectCatalogEvidence({ client: { query: async () => { throw new Error(secret); } }, schemas: [SCHEMA] }),
    (error) => !error.message.includes(secret) && error.message.includes('catalog query failed'));
});

test('SQL contract inventories security, stable dependency identities, extensions and unsupported classes', () => {
  const sql = catalogEvidenceSql();
  for (const catalog of ['pg_namespace', 'pg_class', 'pg_attribute', 'pg_constraint', 'pg_index', 'pg_trigger', 'pg_policy',
    'pg_proc', 'pg_sequence', 'pg_type', 'pg_roles', 'pg_auth_members', 'pg_default_acl', 'pg_extension', 'pg_depend', 'pg_identify_object',
    'pg_publication', 'pg_subscription', 'pg_seclabel', 'pg_description']) assert.ok(sql.includes(`pg_catalog.${catalog}`), catalog);
  assert.ok(sql.includes('LIMIT 100001'));
  assert.ok(sql.includes('transaction_read_only'));
  assert.ok(!sql.includes('rolpassword'));
  assert.ok(!sql.includes('nextval('));
});

test('reviewed authored synthetic inventory stays explicit and does not pretend to review dependencies', () => {
  const baseline = syntheticCatalogExpectedIdentities({ includeLedger: false, includeReader: false });
  const extended = syntheticCatalogExpectedIdentities();
  assert.equal(baseline.length, 52);
  assert.equal(extended.length, 60);
  assert.ok(extended.some((r) => r.kind === 'COLUMN' && r.identity === 'schema_migrations.statements'));
  assert.ok(extended.some((r) => r.kind === 'DEFAULT ACL' && r.identity === 'postgres:r'));
  assert.ok(!extended.some((r) => r.kind === 'EXTERNAL DEPENDENCY'));
  assert.throws(() => syntheticCatalogExpectedIdentities({ includeReader: 'yes' }), /invalid/);
  assert.throws(() => assertSyntheticCatalogFixture({ entries: reviewedEntries() }), /missing=/);
});

function completeAuthoredFixture() {
  const entries = [object('SCHEMA', SCHEMA, { owner: 'postgres', acl: ['al_recovery_reader=U/postgres'] })];
  const tables = {
    workouts: ['id', 'athlete_id', 'load_kg', 'revision', 'logged_at', 'deleted_at'],
    tombstones: ['entity_id', 'entity_kind', 'deleted_at'], revisions: ['entity_id', 'revision', 'payload_hash'],
    idempotency_keys: ['key_hash', 'response_code', 'created_at'], chunk_probe: ['amount', 'payload', 'missing'],
    schema_migrations: ['version', 'statements'],
  };
  for (const [table, columns] of Object.entries(tables)) {
    entries.push(object('TABLE', table, { ...tableDefinition(), acl: table === 'workouts' ? ['al_recovery_reader=r/postgres'] : null }));
    entries.push(object('ROW SECURITY', table, { enabled: table === 'workouts', forced: false }));
    for (const column of columns) entries.push(object('COLUMN', `${table}.${column}`, columnDefinition()));
  }
  const constraints = {
    workouts: ['workouts_pkey', 'workouts_athlete_id_key', 'workouts_load_kg_check', 'workouts_revision_check'],
    tombstones: ['tombstones_pkey', 'tombstones_entity_kind_check'], revisions: ['revisions_pkey', 'revisions_revision_check', 'revisions_payload_hash_check'],
    idempotency_keys: ['idempotency_keys_pkey', 'idempotency_keys_key_hash_check', 'idempotency_keys_response_code_check'], schema_migrations: ['schema_migrations_pkey'],
  };
  for (const [table, names] of Object.entries(constraints)) for (const name of names) entries.push(object('CONSTRAINT', `${table}.${name}`, constraintDefinition()));
  for (const name of ['workouts_pkey', 'workouts_athlete_id_key', 'workouts_active_logged_at_idx', 'tombstones_pkey', 'revisions_pkey', 'idempotency_keys_pkey', 'schema_migrations_pkey']) {
    entries.push(object('INDEX', name, indexDefinition()));
  }
  for (const entry of reviewedEntries()) if (['SEQUENCE', 'FUNCTION', 'TRIGGER', 'POLICY', 'DEFAULT ACL'].includes(entry.kind)) entries.push(entry);
  entries.push(object('ROLE', 'postgres', { ...roleDefinition(), superuser: true, canLogin: true }, null));
  entries.push(object('ROLE', 'al_recovery_reader', roleDefinition(), null));
  return entries;
}

test('authored fixture positive path checks independent identities and critical security invariants', () => {
  const entries = completeAuthoredFixture();
  const result = assertSyntheticCatalogFixture({ entries });
  assert.equal(result.reviewedObjectCount, 60);
  assert.equal(result.unreviewedMetadataCount, 0);
  for (const mutate of [
    (e) => { e.find((r) => r.kind === 'SEQUENCE').definition.lastValue = '26'; },
    (e) => { e.find((r) => r.kind === 'ROW SECURITY').definition.forced = true; },
    (e) => { e.find((r) => r.kind === 'TABLE').definition.owner = 'al_recovery_reader'; },
    (e) => { e.find((r) => r.kind === 'ROLE' && r.identity === 'al_recovery_reader').definition.canLogin = true; },
    (e) => { e.find((r) => r.kind === 'DEFAULT ACL').definition.acl = []; },
  ]) {
    const changed = structuredClone(entries); mutate(changed);
    assert.throws(() => assertSyntheticCatalogFixture({ entries: changed }), /Recovery evidence rejected/);
  }
});

// TOC expectations are authored independently of the listing parser/collector.
const EXPECTED_TOC = [
  { description: 'SCHEMA', schema: '-', tag: SCHEMA, owner: 'postgres' },
  { description: 'TABLE', schema: SCHEMA, tag: 'workouts', owner: 'postgres' },
  { description: 'TABLE DATA', schema: SCHEMA, tag: 'workouts', owner: 'postgres' },
  { description: 'SEQUENCE', schema: SCHEMA, tag: 'workout_id_seq', owner: 'postgres' },
  { description: 'SEQUENCE SET', schema: SCHEMA, tag: 'workout_id_seq', owner: 'postgres' },
  { description: 'ROW SECURITY', schema: SCHEMA, tag: 'workouts', owner: 'postgres' },
  { description: 'POLICY', schema: SCHEMA, tag: 'workouts workouts_owner', owner: 'postgres' },
  { description: 'ACL', schema: SCHEMA, tag: 'TABLE workouts', owner: 'postgres' },
  { description: 'DEFAULT ACL', schema: SCHEMA, tag: 'DEFAULT PRIVILEGES FOR TABLES', owner: 'postgres' },
];
const TOC = `; Archive created at 2026-01-02
1; 2615 42 SCHEMA - synthetic_recovery postgres
2; 1259 43 TABLE synthetic_recovery workouts postgres
3; 0 43 TABLE DATA synthetic_recovery workouts postgres
4; 1259 44 SEQUENCE synthetic_recovery workout_id_seq postgres
5; 0 0 SEQUENCE SET synthetic_recovery workout_id_seq postgres
6; 0 43 ROW SECURITY synthetic_recovery workouts postgres
7; 3256 45 POLICY synthetic_recovery workouts workouts_owner postgres
8; 0 0 ACL synthetic_recovery TABLE workouts postgres
9; 826 46 DEFAULT ACL synthetic_recovery DEFAULT PRIVILEGES FOR TABLES postgres
`;
function tocRunner(listing = TOC, version = 'pg_restore (PostgreSQL) 17.6\n') {
  const calls = [];
  return { calls, run: async (binary, args) => {
    calls.push({ binary, args });
    return { stdout: Buffer.from(args[0] === '--version' ? version : listing), stderr: '', code: 0, signal: null };
  } };
}

test('TOC collection uses pinned major and exact unfiltered arguments; completeness is a separate gate', async () => {
  const runner = tocRunner();
  const result = await collectSyntheticArchiveToc({ run: runner.run, archivePath: '-' });
  assert.deepEqual(runner.calls, [{ binary: 'pg_restore', args: ['--version'] }, { binary: 'pg_restore', args: ['--list', '-'] }]);
  assert.equal(result.toolMajor, 17);
  assert.equal(result.entries.length, 9);
  assert.equal(reconcileArchiveToc({ expectedEntries: EXPECTED_TOC, tocText: result.tocText }).status, 'archive-toc-matched');
  const partial = await collectSyntheticArchiveToc({ run: tocRunner(TOC.replace('3; 0 43 TABLE DATA synthetic_recovery workouts postgres\n', '')).run, archivePath: '-' });
  assert.throws(() => reconcileArchiveToc({ expectedEntries: EXPECTED_TOC, tocText: partial.tocText }), /missing=1/);
});

for (const [name, listing] of [
  ['changed owner', TOC.replace('TABLE synthetic_recovery workouts postgres', 'TABLE synthetic_recovery workouts other_owner')],
  ['missing sequence state', TOC.replace('5; 0 0 SEQUENCE SET synthetic_recovery workout_id_seq postgres\n', '')],
  ['missing security', TOC.replace('6; 0 43 ROW SECURITY synthetic_recovery workouts postgres\n', '')],
  ['missing privilege', TOC.replace('8; 0 0 ACL synthetic_recovery TABLE workouts postgres\n', '')],
  ['missing default privilege', TOC.replace('9; 826 46 DEFAULT ACL synthetic_recovery DEFAULT PRIVILEGES FOR TABLES postgres\n', '')],
  ['unexpected object', `${TOC}10; 1259 99 TABLE synthetic_recovery unexpected postgres\n`],
]) test(`independent TOC reconciliation rejects ${name}`, async () => {
  const extracted = await collectSyntheticArchiveToc({ run: tocRunner(listing).run, archivePath: '/tmp/synthetic.dump' });
  assert.throws(() => reconcileArchiveToc({ expectedEntries: EXPECTED_TOC, tocText: extracted.tocText }), /validation failed/);
});

for (const [name, listing] of [
  ['empty', '; comments only'], ['malformed', 'invalid'], ['unsupported', '1; 0 0 UNKNOWN - object postgres'],
  ['duplicate ID', `${TOC}1; 1259 9 TABLE synthetic_recovery other postgres`],
]) test(`TOC extraction rejects ${name}`, async () => {
  await assert.rejects(collectSyntheticArchiveToc({ run: tocRunner(listing).run, archivePath: '-' }), /validation failed/);
});

test('TOC collector rejects wrong tool, failed process, stderr, option injection and sanitizes diagnostics', async () => {
  for (const version of ['pg_restore (PostgreSQL) 16.4', 'pg_restore (PostgreSQL) 18.0', '', 'unexpected pg_restore 17']) {
    await assert.rejects(collectSyntheticArchiveToc({ run: tocRunner(TOC, version).run, archivePath: '-' }), /must be PostgreSQL 17/);
  }
  for (const result of [{ stdout: TOC, stderr: 'warning', code: 0, signal: null }, { stdout: TOC, stderr: '', code: 1, signal: null },
    { stdout: TOC, stderr: '', code: 0, signal: 'SIGTERM' }, { stdout: null, stderr: '', code: 0, signal: null }, { stdout: TOC }]) {
    await assert.rejects(collectSyntheticArchiveToc({ run: async () => result, archivePath: '-' }), /output is malformed/);
  }
  for (const path of ['--use-list=filtered', '--schema=public', '', 'a\nb', null]) {
    await assert.rejects(collectSyntheticArchiveToc({ run: tocRunner().run, archivePath: path }), /input is invalid/);
  }
  await assert.rejects(collectSyntheticArchiveToc({ run: async () => { throw new Error('protected path and native stderr'); }, archivePath: '-' }),
    (error) => error.message === 'Recovery evidence rejected: synthetic pg_restore failed.');
});

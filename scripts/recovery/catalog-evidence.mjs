import { createHash } from 'node:crypto';
import { parseArchiveToc, reconcileCatalogInventory } from './production-source.mjs';
import { quoteIdentifier } from './snapshot-capture.mjs';

// No connection, process creation, credential handling, or production entrypoint.
// This deliberately bounded PostgreSQL 17 scope rejects features it cannot inventory.
const MAX_ENTRIES = 100_000;
const MAX_BYTES = 32 * 1024 * 1024;
const SIMPLE = /^[a-z_][a-z0-9_]*$/;
const FIELDS = Object.freeze({
  SCHEMA: ['owner', 'acl'],
  TABLE: ['owner', 'acl', 'persistence', 'options', 'replicaIdentity', 'tablespace', 'accessMethod'],
  VIEW: ['owner', 'acl', 'definition', 'options'],
  'MATERIALIZED VIEW': ['owner', 'acl', 'definition', 'options', 'populated', 'tablespace', 'accessMethod'],
  COLUMN: ['type', 'notNull', 'identity', 'generated', 'default', 'collation', 'acl', 'storage', 'compression'],
  CONSTRAINT: ['definition', 'validated', 'deferrable', 'deferred'],
  INDEX: ['owner', 'definition', 'valid', 'ready', 'clustered', 'replicaIdentity', 'options', 'tablespace'],
  TRIGGER: ['definition', 'enabled'],
  POLICY: ['command', 'permissive', 'roles', 'using', 'check'],
  'ROW SECURITY': ['enabled', 'forced'],
  FUNCTION: ['owner', 'acl', 'definition', 'configuration', 'securityDefiner', 'leakproof'],
  PROCEDURE: ['owner', 'acl', 'definition', 'configuration', 'securityDefiner', 'leakproof'],
  SEQUENCE: ['owner', 'acl', 'type', 'start', 'increment', 'minimum', 'maximum', 'cache', 'cycle', 'lastValue', 'isCalled'],
  TYPE: ['owner', 'acl', 'type', 'definition'],
  ROLE: ['superuser', 'inherit', 'createRole', 'createDb', 'canLogin', 'replication', 'bypassRls', 'connectionLimit', 'validUntil', 'configuration'],
  'ROLE MEMBERSHIP': ['role', 'member', 'grantor', 'admin', 'inherit', 'set'],
  'DEFAULT ACL': ['owner', 'objectType', 'acl'],
  EXTENSION: ['owner', 'schema', 'version', 'relocatable', 'configuration', 'conditions', 'members'],
  'EXTERNAL DEPENDENCY': ['source', 'target', 'dependencyType'],
});

function fail(reason) { return new Error(`Recovery evidence rejected: ${reason}.`); }
function exact(object, fields) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).sort().join('\0') === [...fields].sort().join('\0');
}
function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384 &&
    value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}
function canonical(value, depth = 0) {
  if (depth > 16) throw fail('metadata depth exceeds the supported bound');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value) <= MAX_BYTES) return value;
  if (Array.isArray(value) && value.length <= MAX_ENTRIES) return value.map((item) => canonical(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (!text(key)) throw fail('metadata field is malformed');
      return [key, canonical(value[key], depth + 1)];
    }));
  }
  throw fail('metadata field is malformed');
}
const NULLABLE_TEXT = new Set(['default', 'using', 'check', 'validUntil', 'tablespace', 'accessMethod', 'collation']);
const ARRAYS = new Set(['acl', 'options', 'roles', 'configuration', 'conditions', 'members']);
const BOOLEANS = new Set(['notNull', 'validated', 'deferrable', 'deferred', 'valid', 'ready', 'clustered',
  'populated', 'enabled', 'forced', 'permissive', 'securityDefiner', 'leakproof', 'cycle', 'isCalled',
  'superuser', 'inherit', 'createRole', 'createDb', 'canLogin', 'replication', 'bypassRls', 'admin', 'set', 'relocatable']);
const INTEGERS = new Set(['start', 'increment', 'minimum', 'maximum', 'cache', 'lastValue']);

function validateDefinition(kind, definition) {
  if (!exact(definition, FIELDS[kind])) throw fail('object metadata fields are incomplete or unsupported');
  for (const [key, value] of Object.entries(definition)) {
    if (key === 'replicaIdentity' && kind !== 'INDEX') {
      if (!['d', 'n', 'f', 'i'].includes(value)) throw fail('replica identity is malformed');
    } else if (key === 'enabled' && kind === 'TRIGGER') {
      if (!['O', 'D', 'R', 'A'].includes(value)) throw fail('trigger enablement is malformed');
    } else if (BOOLEANS.has(key) || (key === 'replicaIdentity' && kind === 'INDEX')) {
      if (typeof value !== 'boolean') throw fail('boolean metadata is malformed');
    } else if (ARRAYS.has(key)) {
      if (key === 'acl' && value === null) continue; // NULL ACL has PostgreSQL default semantics; {} does not.
      if (!Array.isArray(value) || value.length > MAX_ENTRIES) throw fail('array metadata is malformed');
      // Extension membership is object identities; extconfig is a list of table identities.
      if (value.some((item) => typeof item !== 'string' || !text(item))) throw fail('array metadata entry is malformed');
    } else if (INTEGERS.has(key)) {
      if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(value) || BigInt(value) < -(2n ** 63n) ||
          BigInt(value) > 2n ** 63n - 1n) throw fail('sequence integer metadata is malformed');
    } else if (key === 'connectionLimit') {
      if (!Number.isInteger(value) || value < -1 || value > 2_147_483_647) throw fail('role connection limit is malformed');
    } else if (key === 'source' || key === 'target') {
      if (!exact(value, ['type', 'schema', 'name', 'identity']) || !text(value.type) || !text(value.identity) ||
          !(value.schema === null || text(value.schema)) || !(value.name === null || text(value.name))) {
        throw fail('dependency address is malformed');
      }
    } else if (kind === 'TYPE' && key === 'definition') {
      if (!Array.isArray(value) || !value.length) throw fail('type definition is malformed');
      canonical(value);
    } else if (NULLABLE_TEXT.has(key) && value === null) {
      continue;
    } else if (['identity', 'generated', 'compression'].includes(key) && value === '') {
      continue;
    } else if (typeof value !== 'string' || !value.length || value.includes('\0')) {
      throw fail('text metadata is malformed');
    }
  }
  canonical(definition);
}

/** Hash independently authored definitions or observed envelopes identically.
 * SQL arrays are ordered semantically (columns/enum order) or by stable identity.
 * Raw entries contain protected definitions/security metadata and must not be logged.
 */
export function canonicalCatalogRecords(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_ENTRIES) throw fail('inventory is empty or oversized');
  const seen = new Set();
  const records = entries.map((entry) => {
    if (!exact(entry, ['kind', 'schema', 'identity', 'definition']) || !Object.hasOwn(FIELDS, entry.kind) ||
        !(entry.schema === null || text(entry.schema)) || !text(entry.identity)) throw fail('inventory entry is malformed or unsupported');
    const global = ['ROLE', 'ROLE MEMBERSHIP', 'EXTENSION', 'EXTERNAL DEPENDENCY'].includes(entry.kind);
    if ((global && entry.schema !== null) || (!global && entry.kind !== 'DEFAULT ACL' && !SIMPLE.test(entry.schema ?? '')) ||
        (entry.kind === 'SCHEMA' && entry.identity !== entry.schema)) throw fail('object namespace is malformed');
    if (['SCHEMA', 'TABLE', 'VIEW', 'MATERIALIZED VIEW', 'INDEX', 'SEQUENCE', 'TYPE', 'ROLE', 'EXTENSION'].includes(entry.kind) &&
        !SIMPLE.test(entry.identity)) throw fail('object identifier is outside the supported scope');
    if (['COLUMN', 'CONSTRAINT', 'TRIGGER', 'POLICY'].includes(entry.kind) &&
        !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(entry.identity)) throw fail('child object identity is malformed');
    validateDefinition(entry.kind, entry.definition);
    const key = JSON.stringify([entry.kind, entry.schema, entry.identity]);
    if (seen.has(key)) throw fail('inventory contains duplicate identities');
    seen.add(key);
    const encoded = JSON.stringify(canonical(entry.definition));
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw fail('definition exceeds the supported bound');
    return Object.freeze({ kind: entry.kind, schema: entry.schema, identity: entry.identity,
      definitionSha256: createHash('sha256').update(encoded).digest('hex') });
  });
  return Object.freeze(records.sort((a, b) => JSON.stringify([a.kind, a.schema, a.identity]).localeCompare(
    JSON.stringify([b.kind, b.schema, b.identity]), 'en')));
}

/** Independent membership gate. A matching identity set does not establish that
 * definitions are correct; separately compare reviewed definitions or source/restore
 * digests with reconcileCatalogInventory. Never create this allowlist from observations.
 */
export function assertReviewedCatalogScope({ records, expectedIdentities } = {}) {
  if (!Array.isArray(records) || !Array.isArray(expectedIdentities) || !expectedIdentities.length) throw fail('reviewed scope is absent');
  for (const record of records) {
    if (!exact(record, ['kind', 'schema', 'identity', 'definitionSha256']) || !/^[a-f0-9]{64}$/.test(record.definitionSha256)) {
      throw fail('observed canonical record is malformed');
    }
  }
  const expected = expectedIdentities.map((entry) => {
    if (!exact(entry, ['kind', 'schema', 'identity'])) throw fail('reviewed identity is malformed');
    return { ...entry, definitionSha256: '0'.repeat(64) };
  });
  return reconcileCatalogInventory({ expected, actual: records.map((record) => ({ ...record, definitionSha256: '0'.repeat(64) })) });
}

/** Independently specified authored objects from synthetic-drill's FIXTURE_SQL.
 * This is deliberately NOT a complete expected dependency/extension inventory.
 * Compiler-created dependency edges must receive a separate reviewed checkpoint.
 */
export function syntheticCatalogExpectedIdentities({ includeLedger = true, includeReader = true } = {}) {
  if (typeof includeLedger !== 'boolean' || typeof includeReader !== 'boolean') throw fail('synthetic fixture options are invalid');
  const schema = 'synthetic_recovery';
  const result = [];
  const add = (kind, identity, namespace = schema) => result.push(Object.freeze({ kind, schema: namespace, identity }));
  add('SCHEMA', schema);
  const tables = {
    workouts: ['id', 'athlete_id', 'load_kg', 'revision', 'logged_at', 'deleted_at'],
    tombstones: ['entity_id', 'entity_kind', 'deleted_at'],
    revisions: ['entity_id', 'revision', 'payload_hash'],
    idempotency_keys: ['key_hash', 'response_code', 'created_at'],
    chunk_probe: ['amount', 'payload', 'missing'],
    ...(includeLedger ? { schema_migrations: ['version', 'statements'] } : {}),
  };
  for (const [table, columns] of Object.entries(tables)) {
    add('TABLE', table); add('ROW SECURITY', table);
    for (const column of columns) add('COLUMN', `${table}.${column}`);
  }
  const constraints = {
    workouts: ['workouts_pkey', 'workouts_athlete_id_key', 'workouts_load_kg_check', 'workouts_revision_check'],
    tombstones: ['tombstones_pkey', 'tombstones_entity_kind_check'],
    revisions: ['revisions_pkey', 'revisions_revision_check', 'revisions_payload_hash_check'],
    idempotency_keys: ['idempotency_keys_pkey', 'idempotency_keys_key_hash_check', 'idempotency_keys_response_code_check'],
    ...(includeLedger ? { schema_migrations: ['schema_migrations_pkey'] } : {}),
  };
  for (const [table, names] of Object.entries(constraints)) for (const name of names) add('CONSTRAINT', `${table}.${name}`);
  for (const index of ['workouts_pkey', 'workouts_athlete_id_key', 'workouts_active_logged_at_idx', 'tombstones_pkey',
    'revisions_pkey', 'idempotency_keys_pkey', ...(includeLedger ? ['schema_migrations_pkey'] : [])]) add('INDEX', index);
  add('SEQUENCE', 'workout_id_seq'); add('FUNCTION', 'touch_workout()');
  add('TRIGGER', 'workouts.workouts_touch'); add('POLICY', 'workouts.workouts_owner');
  add('ROLE', 'postgres', null);
  if (includeReader) { add('ROLE', 'al_recovery_reader', null); add('DEFAULT ACL', 'postgres:r'); }
  return Object.freeze(result);
}

/** Checks authored-object identity/owner and critical independently specified
 * security/state invariants. Other global metadata is counted explicitly and
 * must be compared in full source/restore reconciliation; it is not reviewed here.
 */
export function assertSyntheticCatalogFixture({ entries, includeLedger = true, includeReader = true } = {}) {
  const records = canonicalCatalogRecords(entries);
  const unreviewedKinds = ['EXTERNAL DEPENDENCY', 'EXTENSION', 'ROLE MEMBERSHIP'];
  const reviewed = records.filter((record) => !unreviewedKinds.includes(record.kind));
  const expectedIdentities = syntheticCatalogExpectedIdentities({ includeLedger, includeReader });
  assertReviewedCatalogScope({ records: reviewed, expectedIdentities });
  for (const item of entries) {
    const d = item.definition;
    if (Object.hasOwn(d, 'owner') && item.kind !== 'EXTENSION' && d.owner !== 'postgres') throw fail('synthetic fixture owner differs');
    if (item.kind === 'ROW SECURITY' && (d.enabled !== (item.identity === 'workouts') || d.forced !== false)) throw fail('synthetic RLS state differs');
    if (item.kind === 'SEQUENCE' && (d.lastValue !== '25' || d.isCalled !== true || d.increment !== '1' || d.cycle !== false)) throw fail('synthetic sequence state differs');
    if (item.kind === 'POLICY' && (d.command !== '*' || d.permissive !== true || JSON.stringify(d.roles) !== '["PUBLIC"]' ||
        d.check !== null || !d.using.includes("current_setting('app.user_id'::text, true)"))) throw fail('synthetic policy differs');
    if (item.kind === 'FUNCTION' && (d.securityDefiner !== false || d.leakproof !== false || d.configuration.length)) throw fail('synthetic function security differs');
    if (includeReader && item.kind === 'ROLE' && item.identity === 'al_recovery_reader' &&
        (d.canLogin || d.superuser || d.createRole || d.createDb || d.replication || d.bypassRls)) throw fail('synthetic reader privileges differ');
  }
  if (includeReader) {
    const find = (kind, identity) => entries.find((item) => item.kind === kind && item.identity === identity)?.definition;
    if (!find('SCHEMA', 'synthetic_recovery').acl?.includes('al_recovery_reader=U/postgres') ||
        !find('TABLE', 'workouts').acl?.includes('al_recovery_reader=r/postgres') ||
        !find('DEFAULT ACL', 'postgres:r').acl?.includes('al_recovery_reader=r/postgres')) throw fail('synthetic reader ACL differs');
  }
  return Object.freeze({ status: 'synthetic-authored-objects-matched', reviewedObjectCount: reviewed.length,
    unreviewedMetadataCount: records.length - reviewed.length, unreviewedKinds: Object.freeze(unreviewedKinds) });
}

const acl = (expression) => `CASE WHEN ${expression} IS NULL THEN NULL ELSE coalesce((SELECT jsonb_agg(v::text ORDER BY v::text COLLATE "C") FROM unnest(${expression}) v),'[]'::jsonb) END`;
const array = (expression) => `coalesce(to_jsonb(${expression}),'[]'::jsonb)`;
const owner = (expression) => `pg_catalog.pg_get_userbyid(${expression})`;
const address = (alias) => `jsonb_build_object('type',${alias}.type,'schema',${alias}.schema,'name',${alias}.name,'identity',${alias}.identity)`;
const dependencyAddress = (object, toastNamespace, parent, namespace, identified) => `CASE WHEN ${object}.relkind='t'
  AND ${toastNamespace}.nspname='pg_toast' AND ${parent}.oid IS NOT NULL AND d.deptype='i'
  THEN jsonb_build_object('type',${identified}.type,'schema',${namespace}.nspname,'name',${parent}.relname,
    'identity',${namespace}.nspname||'.'||${parent}.relname) ELSE ${address(identified)} END`;
const entry = (kind, schema, identity, fields, from) => `SELECT ${kind}::text AS kind,${schema}::text AS schema,${identity}::text AS identity,
  jsonb_build_object(${Object.entries(fields).flatMap(([key, value]) => [`'${key}'`, value]).join(',')}) AS definition FROM ${from}`;

/** One bounded, parameterized PG17 catalog census. Run in an exclusively owned,
 * read-only REPEATABLE READ transaction, SET LOCAL search_path=pg_catalog. The
 * caller must quiesce writers before reading sequences (sequence state is not MVCC).
 * No supported-scope result is a production completeness/recoverability claim.
 */
export function catalogEvidenceSql() {
  const unions = [
    entry("'SCHEMA'", 'n.nspname', 'n.nspname', { owner: owner('n.nspowner'), acl: acl('n.nspacl') }, 'ns n'),
    entry("'TABLE'", 'n.nspname', 'c.relname', { owner: owner('c.relowner'), acl: acl('c.relacl'), persistence: 'c.relpersistence',
      options: array('c.reloptions'), replicaIdentity: 'c.relreplident', tablespace: 'ts.spcname', accessMethod: 'am.amname' },
    "rels c JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid=c.reltablespace LEFT JOIN pg_catalog.pg_am am ON am.oid=c.relam WHERE c.relkind='r'"),
    entry("CASE c.relkind WHEN 'v' THEN 'VIEW' ELSE 'MATERIALIZED VIEW' END", 'n.nspname', 'c.relname',
      { owner: owner('c.relowner'), acl: acl('c.relacl'), definition: 'pg_catalog.pg_get_viewdef(c.oid,true)', options: array('c.reloptions') },
      "rels c JOIN ns n ON n.oid=c.relnamespace WHERE c.relkind='v'"),
    entry("'MATERIALIZED VIEW'", 'n.nspname', 'c.relname', { owner: owner('c.relowner'), acl: acl('c.relacl'),
      definition: 'pg_catalog.pg_get_viewdef(c.oid,true)', options: array('c.reloptions'), populated: 'c.relispopulated',
      tablespace: 'ts.spcname', accessMethod: 'am.amname' },
      "rels c JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid=c.reltablespace LEFT JOIN pg_catalog.pg_am am ON am.oid=c.relam WHERE c.relkind='m'"),
    entry("'COLUMN'", 'n.nspname', "c.relname || '.' || a.attname", { type: 'pg_catalog.format_type(a.atttypid,a.atttypmod)',
      notNull: 'a.attnotnull', identity: 'a.attidentity', generated: 'a.attgenerated', default: 'pg_catalog.pg_get_expr(d.adbin,d.adrelid)',
      collation: "CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END", acl: acl('a.attacl'), storage: 'a.attstorage', compression: 'a.attcompression' },
      "rels c JOIN ns n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE c.relkind IN ('r','v','m') AND a.attnum>0 AND NOT a.attisdropped"),
    entry("'CONSTRAINT'", 'n.nspname', "c.relname || '.' || con.conname", { definition: 'pg_catalog.pg_get_constraintdef(con.oid,true)',
      validated: 'con.convalidated', deferrable: 'con.condeferrable', deferred: 'con.condeferred' },
      'rels c JOIN ns n ON n.oid=c.relnamespace JOIN pg_catalog.pg_constraint con ON con.conrelid=c.oid'),
    entry("'INDEX'", 'n.nspname', 'c.relname', { owner: owner('c.relowner'), definition: 'pg_catalog.pg_get_indexdef(c.oid)',
      valid: 'i.indisvalid', ready: 'i.indisready', clustered: 'i.indisclustered', replicaIdentity: 'i.indisreplident',
      options: array('c.reloptions'), tablespace: 'ts.spcname' },
      'rels c JOIN ns n ON n.oid=c.relnamespace JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid=c.reltablespace'),
    entry("'TRIGGER'", 'n.nspname', "c.relname || '.' || t.tgname", { definition: 'pg_catalog.pg_get_triggerdef(t.oid,true)', enabled: 't.tgenabled' },
      'rels c JOIN ns n ON n.oid=c.relnamespace JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal'),
    entry("'POLICY'", 'n.nspname', "c.relname || '.' || p.polname", { command: 'p.polcmd', permissive: 'p.polpermissive',
      roles: "(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END COLLATE \"C\") FROM unnest(p.polroles) r)",
      using: 'pg_catalog.pg_get_expr(p.polqual,p.polrelid)', check: 'pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)' },
      'rels c JOIN ns n ON n.oid=c.relnamespace JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid'),
    entry("'ROW SECURITY'", 'n.nspname', 'c.relname', { enabled: 'c.relrowsecurity', forced: 'c.relforcerowsecurity' },
      "rels c JOIN ns n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','m')"),
    entry("CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END", 'n.nspname', "p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'", {
      owner: owner('p.proowner'), acl: acl('p.proacl'), definition: 'pg_catalog.pg_get_functiondef(p.oid)', configuration: array('p.proconfig'),
      securityDefiner: 'p.prosecdef', leakproof: 'p.proleakproof' }, "procs p JOIN ns n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')"),
    entry("'SEQUENCE'", 'n.nspname', 'c.relname', { owner: owner('c.relowner'), acl: acl('c.relacl'), type: 'pg_catalog.format_type(s.seqtypid,NULL)',
      start: 's.seqstart::text', increment: 's.seqincrement::text', minimum: 's.seqmin::text', maximum: 's.seqmax::text', cache: 's.seqcache::text',
      cycle: 's.seqcycle', lastValue: "'0'", isCalled: 'false' }, 'rels c JOIN ns n ON n.oid=c.relnamespace JOIN pg_catalog.pg_sequence s ON s.seqrelid=c.oid'),
    entry("'TYPE'", 'n.nspname', 't.typname', { owner: owner('t.typowner'), acl: acl('t.typacl'), type: 't.typtype',
      definition: "CASE WHEN t.typtype='e' THEN (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid) ELSE jsonb_build_array(jsonb_build_object('base',pg_catalog.format_type(t.typbasetype,t.typtypmod),'notNull',t.typnotnull,'default',t.typdefault,'collation',CASE WHEN t.typcollation=0 THEN NULL ELSE t.typcollation::regcollation::text END,'constraints',(SELECT coalesce(jsonb_agg(pg_catalog.pg_get_constraintdef(co.oid,true) ORDER BY co.conname COLLATE \"C\"),'[]'::jsonb) FROM pg_catalog.pg_constraint co WHERE co.contypid=t.oid))) END" },
      "types t JOIN ns n ON n.oid=t.typnamespace WHERE t.typtype IN ('e','d') AND t.typelem=0"),
    entry("'ROLE'", 'NULL', 'r.rolname', { superuser: 'r.rolsuper', inherit: 'r.rolinherit', createRole: 'r.rolcreaterole', createDb: 'r.rolcreatedb',
      canLogin: 'r.rolcanlogin', replication: 'r.rolreplication', bypassRls: 'r.rolbypassrls', connectionLimit: 'r.rolconnlimit',
      validUntil: 'r.rolvaliduntil::text', configuration: array('r.rolconfig') }, 'pg_catalog.pg_roles r JOIN relevant_roles rr ON rr.oid=r.oid'),
    entry("'ROLE MEMBERSHIP'", 'NULL', "pg_catalog.pg_get_userbyid(m.roleid)||'>'||pg_catalog.pg_get_userbyid(m.member)||'@'||pg_catalog.pg_get_userbyid(m.grantor)", {
      role: owner('m.roleid'), member: owner('m.member'), grantor: owner('m.grantor'), admin: 'm.admin_option', inherit: 'm.inherit_option', set: 'm.set_option' },
      'pg_catalog.pg_auth_members m WHERE m.roleid IN (SELECT oid FROM relevant_roles) OR m.member IN (SELECT oid FROM relevant_roles)'),
    entry("'DEFAULT ACL'", 'n.nspname', "pg_catalog.pg_get_userbyid(d.defaclrole)||':'||d.defaclobjtype", {
      owner: owner('d.defaclrole'), objectType: 'd.defaclobjtype', acl: acl('d.defaclacl') },
      'defaults d LEFT JOIN ns n ON n.oid=d.defaclnamespace'),
    entry("'EXTENSION'", 'NULL', 'e.extname', { owner: owner('e.extowner'), schema: 'n.nspname', version: 'e.extversion', relocatable: 'e.extrelocatable',
      configuration: "coalesce((SELECT jsonb_agg(c::regclass::text ORDER BY ord) FROM unnest(e.extconfig) WITH ORDINALITY AS cfg(c,ord)),'[]'::jsonb)",
      conditions: array('e.extcondition'), members: "(SELECT coalesce(jsonb_agg(pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) ORDER BY pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) COLLATE \"C\"),'[]'::jsonb) FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e')" },
      'extensions e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace'),
    entry("'EXTERNAL DEPENDENCY'", 'NULL', "s.type||':'||(stable.source_address->>'identity')||'>'||t.type||':'||(stable.target_address->>'identity')||':'||d.deptype", {
      source: 'stable.source_address', target: 'stable.target_address', dependencyType: 'd.deptype' },
      `dependencies d CROSS JOIN LATERAL pg_catalog.pg_identify_object(d.classid,d.objid,d.objsubid) s
       CROSS JOIN LATERAL pg_catalog.pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) t
       LEFT JOIN pg_catalog.pg_class source_object ON d.classid='pg_catalog.pg_class'::regclass AND source_object.oid=d.objid AND source_object.relkind='t'
       LEFT JOIN pg_catalog.pg_namespace source_toast_namespace ON source_toast_namespace.oid=source_object.relnamespace
       LEFT JOIN pg_catalog.pg_class source_parent ON source_parent.reltoastrelid=source_object.oid
       LEFT JOIN ns source_namespace ON source_namespace.oid=source_parent.relnamespace
       LEFT JOIN pg_catalog.pg_class target_object ON d.refclassid='pg_catalog.pg_class'::regclass AND target_object.oid=d.refobjid AND target_object.relkind='t'
       LEFT JOIN pg_catalog.pg_namespace target_toast_namespace ON target_toast_namespace.oid=target_object.relnamespace
       LEFT JOIN pg_catalog.pg_class target_parent ON target_parent.reltoastrelid=target_object.oid
       LEFT JOIN ns target_namespace ON target_namespace.oid=target_parent.relnamespace
       CROSS JOIN LATERAL (SELECT ${dependencyAddress('source_object', 'source_toast_namespace', 'source_parent', 'source_namespace', 's')} AS source_address,
         ${dependencyAddress('target_object', 'target_toast_namespace', 'target_parent', 'target_namespace', 't')} AS target_address) stable`),
  ];
  return `WITH RECURSIVE
  ns AS (SELECT * FROM pg_catalog.pg_namespace WHERE nspname=ANY($1::text[]) LIMIT 100001),
  rels AS (SELECT c.* FROM pg_catalog.pg_class c JOIN ns ON ns.oid=c.relnamespace LIMIT 100001),
  procs AS (SELECT p.* FROM pg_catalog.pg_proc p JOIN ns ON ns.oid=p.pronamespace LIMIT 100001),
  types AS (SELECT t.* FROM pg_catalog.pg_type t JOIN ns ON ns.oid=t.typnamespace LIMIT 100001),
  defaults AS (SELECT d.* FROM pg_catalog.pg_default_acl d WHERE d.defaclnamespace IN (SELECT oid FROM ns) OR
    (d.defaclnamespace=0 AND d.defaclrole IN (SELECT nspowner FROM ns UNION SELECT relowner FROM rels UNION SELECT proowner FROM procs)) LIMIT 100001),
  roots(classid,objid) AS (
    SELECT 'pg_catalog.pg_namespace'::regclass,oid FROM ns UNION SELECT 'pg_catalog.pg_class'::regclass,oid FROM rels
    UNION SELECT 'pg_catalog.pg_proc'::regclass,oid FROM procs UNION SELECT 'pg_catalog.pg_type'::regclass,oid FROM types
    UNION SELECT 'pg_catalog.pg_constraint'::regclass,oid FROM pg_catalog.pg_constraint WHERE connamespace IN (SELECT oid FROM ns)
    UNION SELECT 'pg_catalog.pg_trigger'::regclass,oid FROM pg_catalog.pg_trigger WHERE tgrelid IN (SELECT oid FROM rels)
    UNION SELECT 'pg_catalog.pg_policy'::regclass,oid FROM pg_catalog.pg_policy WHERE polrelid IN (SELECT oid FROM rels)
    UNION SELECT 'pg_catalog.pg_attrdef'::regclass,oid FROM pg_catalog.pg_attrdef WHERE adrelid IN (SELECT oid FROM rels)
    UNION SELECT 'pg_catalog.pg_rewrite'::regclass,oid FROM pg_catalog.pg_rewrite WHERE ev_class IN (SELECT oid FROM rels)
    UNION SELECT 'pg_catalog.pg_default_acl'::regclass,oid FROM defaults),
  dependencies AS (SELECT d.* FROM pg_catalog.pg_depend d WHERE EXISTS (SELECT 1 FROM roots r WHERE
    (d.classid=r.classid AND d.objid=r.objid) OR (d.refclassid=r.classid AND d.refobjid=r.objid)) LIMIT 100001),
  extensions AS (SELECT e.* FROM pg_catalog.pg_extension e WHERE e.extnamespace IN (SELECT oid FROM ns) OR e.oid IN (
    SELECT refobjid FROM dependencies WHERE refclassid='pg_catalog.pg_extension'::regclass
    UNION SELECT x.refobjid FROM pg_catalog.pg_depend x JOIN dependencies d ON x.classid=d.refclassid AND x.objid=d.refobjid
    WHERE x.refclassid='pg_catalog.pg_extension'::regclass AND x.deptype='e') LIMIT 100001),
  acl_roles AS (SELECT a.grantor AS oid FROM rels c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    UNION SELECT a.grantee FROM rels c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    UNION SELECT a.grantor FROM ns n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
    UNION SELECT a.grantee FROM ns n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
    UNION SELECT a.grantor FROM procs p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    UNION SELECT a.grantee FROM procs p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    UNION SELECT a.grantee FROM defaults d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    UNION SELECT a.grantor FROM defaults d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    UNION SELECT a.grantee FROM types t CROSS JOIN LATERAL pg_catalog.aclexplode(t.typacl) a
    UNION SELECT a.grantor FROM types t CROSS JOIN LATERAL pg_catalog.aclexplode(t.typacl) a
    UNION SELECT a.grantee FROM pg_catalog.pg_attribute at JOIN rels c ON c.oid=at.attrelid CROSS JOIN LATERAL pg_catalog.aclexplode(at.attacl) a
    UNION SELECT a.grantor FROM pg_catalog.pg_attribute at JOIN rels c ON c.oid=at.attrelid CROSS JOIN LATERAL pg_catalog.aclexplode(at.attacl) a),
  role_roots(oid) AS (SELECT nspowner FROM ns UNION SELECT relowner FROM rels UNION SELECT proowner FROM procs
    UNION SELECT typowner FROM types UNION SELECT extowner FROM extensions UNION SELECT defaclrole FROM defaults
    UNION SELECT oid FROM acl_roles WHERE oid<>0 UNION SELECT unnest(polroles) FROM pg_catalog.pg_policy WHERE polrelid IN (SELECT oid FROM rels)),
  relevant_roles(oid) AS (SELECT oid FROM role_roots WHERE oid<>0 UNION SELECT x.oid FROM relevant_roles r
    JOIN pg_catalog.pg_auth_members m ON r.oid=m.roleid OR r.oid=m.member CROSS JOIN LATERAL (VALUES(m.roleid),(m.member),(m.grantor)) x(oid)),
  unsupported AS (
    SELECT 'relation' AS kind FROM rels WHERE relkind NOT IN ('r','i','S','v','m') OR relpersistence<>'p' OR relispartition
    UNION ALL SELECT 'inheritance' FROM pg_catalog.pg_inherits WHERE inhrelid IN (SELECT oid FROM rels) OR inhparent IN (SELECT oid FROM rels)
    UNION ALL SELECT 'routine' FROM procs WHERE prokind NOT IN ('f','p')
    UNION ALL SELECT 'type' FROM types t WHERE NOT (t.typtype IN ('e','d') OR (t.typtype='c' AND t.typrelid IN (SELECT oid FROM rels WHERE relkind IN ('r','v','m'))) OR (t.typelem<>0 AND t.typlen=-1))
    UNION ALL SELECT 'namespace object' FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_namespace'::regclass AND d.refobjid IN (SELECT oid FROM ns)
      AND d.classid NOT IN ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_type'::regclass,'pg_catalog.pg_constraint'::regclass,'pg_catalog.pg_default_acl'::regclass,'pg_catalog.pg_extension'::regclass)
    UNION ALL SELECT 'rewrite rule' FROM pg_catalog.pg_rewrite WHERE ev_class IN (SELECT oid FROM rels) AND rulename<>'_RETURN'
    UNION ALL SELECT 'publication' FROM pg_catalog.pg_publication WHERE puballtables OR oid IN (SELECT prpubid FROM pg_catalog.pg_publication_rel WHERE prrelid IN (SELECT oid FROM rels)) OR oid IN (SELECT pnpubid FROM pg_catalog.pg_publication_namespace WHERE pnnspid IN (SELECT oid FROM ns))
    UNION ALL SELECT 'event trigger' FROM pg_catalog.pg_event_trigger
    UNION ALL SELECT 'subscription' FROM pg_catalog.pg_subscription
    UNION ALL SELECT 'role database settings' FROM pg_catalog.pg_db_role_setting WHERE setrole=0 OR setrole IN (SELECT oid FROM relevant_roles)
    UNION ALL SELECT 'comment' FROM pg_catalog.pg_description d JOIN roots r ON r.classid=d.classoid AND r.objid=d.objoid
    UNION ALL SELECT 'security label' FROM pg_catalog.pg_seclabel d JOIN roots r ON r.classid=d.classoid AND r.objid=d.objoid
    UNION ALL SELECT 'dependency class' FROM dependencies WHERE classid NOT IN (
      'pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_type'::regclass,'pg_catalog.pg_constraint'::regclass,
      'pg_catalog.pg_namespace'::regclass,'pg_catalog.pg_trigger'::regclass,'pg_catalog.pg_policy'::regclass,'pg_catalog.pg_attrdef'::regclass,
      'pg_catalog.pg_rewrite'::regclass,'pg_catalog.pg_default_acl'::regclass,'pg_catalog.pg_extension'::regclass)
      OR refclassid NOT IN ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_type'::regclass,
      'pg_catalog.pg_constraint'::regclass,'pg_catalog.pg_namespace'::regclass,'pg_catalog.pg_trigger'::regclass,
      'pg_catalog.pg_policy'::regclass,'pg_catalog.pg_attrdef'::regclass,'pg_catalog.pg_rewrite'::regclass,
      'pg_catalog.pg_default_acl'::regclass,'pg_catalog.pg_extension'::regclass,'pg_catalog.pg_language'::regclass,'pg_catalog.pg_collation'::regclass)
    UNION ALL SELECT 'bound' WHERE (SELECT count(*) FROM dependencies)>=100001 OR (SELECT count(*) FROM roots)>=100001 OR (SELECT count(*) FROM relevant_roles)>=100001),
  entries AS (${unions.join('\n UNION ALL\n')}),
  bounded_entries AS MATERIALIZED (SELECT * FROM entries LIMIT 100001),
  entry_bound AS (SELECT count(*) AS count,coalesce(sum(octet_length(to_jsonb(e)::text)),0) AS bytes FROM bounded_entries e)
 SELECT jsonb_build_object('version',current_setting('server_version_num')::integer/10000,
  'isolation',current_setting('transaction_isolation'),'readOnly',current_setting('transaction_read_only'),
  'searchPath',current_setting('search_path'),'schemas',(SELECT jsonb_agg(nspname ORDER BY nspname COLLATE "C") FROM ns),
  'complete',(SELECT count<=100000 AND bytes<=33554432 FROM entry_bound),
  'unsupported',(SELECT coalesce(jsonb_agg(kind),'[]'::jsonb) FROM unsupported),
  'entries',CASE WHEN (SELECT count<=100000 AND bytes<=33554432 FROM entry_bound) THEN
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY kind COLLATE "C",schema COLLATE "C",identity COLLATE "C") FROM bounded_entries e)
    ELSE '[]'::jsonb END) AS evidence`;
}

/** The injected client must remain on one caller-owned transaction/connection.
 * Query errors and malformed results never expose native diagnostics or contents.
 * Sequence values are read directly, never nextval/setval; quiescence is external.
 */
export async function collectCatalogEvidence({ client, schemas, expectedInventory } = {}) {
  if (!client || typeof client.query !== 'function' || !Array.isArray(schemas) || !schemas.length || schemas.length > 32 ||
      schemas.some((name) => typeof name !== 'string' || !SIMPLE.test(name)) || new Set(schemas).size !== schemas.length) throw fail('client or schema scope is invalid');
  let result;
  try { result = await client.query(catalogEvidenceSql(), [schemas]); }
  catch { throw fail('catalog query failed'); }
  const value = result?.rows?.[0]?.evidence;
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || !exact(result.rows[0], ['evidence']) ||
      (result.rowCount !== undefined && result.rowCount !== 1) ||
      !exact(value, ['version', 'isolation', 'readOnly', 'searchPath', 'schemas', 'complete', 'unsupported', 'entries']) ||
      value.version !== 17 || value.isolation !== 'repeatable read' || value.readOnly !== 'on' || value.searchPath !== 'pg_catalog' || value.complete !== true ||
      !Array.isArray(value.schemas) || JSON.stringify([...value.schemas].sort()) !== JSON.stringify([...schemas].sort()) ||
      !Array.isArray(value.unsupported) || value.unsupported.length || !Array.isArray(value.entries)) throw fail('catalog census is partial or outside the supported scope');
  // Validate before issuing any identifier-based sequence query.
  canonicalCatalogRecords(value.entries);
  if (value.entries.filter((entry) => entry.kind === 'SCHEMA').length !== schemas.length ||
      schemas.some((schema) => !value.entries.some((entry) => entry.kind === 'SCHEMA' && entry.schema === schema && entry.identity === schema))) {
    throw fail('catalog schema objects are incomplete');
  }
  const entries = structuredClone(value.entries);
  for (const item of entries) {
    if (item.schema !== null && !schemas.includes(item.schema)) throw fail('catalog entry escapes the reviewed scope');
    if (item.kind !== 'SEQUENCE') continue;
    let state;
    try { state = await client.query(`SELECT last_value::text AS last_value,is_called FROM ${quoteIdentifier(item.schema)}.${quoteIdentifier(item.identity)}`); }
    catch { throw fail('sequence state query failed'); }
    if (!Array.isArray(state?.rows) || state.rows.length !== 1 || (state.rowCount !== undefined && state.rowCount !== 1) ||
        !exact(state.rows[0], ['last_value', 'is_called'])) throw fail('sequence state is partial');
    item.definition.lastValue = state.rows[0].last_value;
    item.definition.isCalled = state.rows[0].is_called;
  }
  const records = canonicalCatalogRecords(entries);
  const reconciliation = expectedInventory === undefined ? null : reconcileCatalogInventory({
    expected: canonicalCatalogRecords(expectedInventory), actual: records });
  return Object.freeze({ records, entries: Object.freeze(entries), reconciliation });
}

/** An injected bounded runner may execute inside the digest-pinned, isolated
 * synthetic container. `-` denotes synthetic stdin supplied by that runner.
 * Runner contract: no shell, no network, no inherited libpq credentials, bounded
 * stdout/stderr/deadline, wait for exit, reject nonzero exit. Extraction does not
 * assert completeness; independently reconcile expectedEntries with tocText.
 */
export async function collectSyntheticArchiveToc({ run, archivePath } = {}) {
  if (typeof run !== 'function' || typeof archivePath !== 'string' || !archivePath.length || archivePath.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(archivePath) || (archivePath.startsWith('-') && archivePath !== '-')) throw fail('synthetic archive runner input is invalid');
  const invoke = async (args) => {
    let result;
    try { result = await run('pg_restore', Object.freeze(args)); } catch { throw fail('synthetic pg_restore failed'); }
    if (!result || !(typeof result.stdout === 'string' || Buffer.isBuffer(result.stdout)) || result.code !== 0 ||
        result.signal !== null || !(typeof result.stderr === 'string' || Buffer.isBuffer(result.stderr)) ||
        Buffer.byteLength(result.stderr) !== 0 || Buffer.byteLength(result.stdout) > MAX_BYTES) throw fail('synthetic pg_restore output is malformed');
    return result.stdout.toString('utf8');
  };
  const version = await invoke(['--version']);
  if (!/^pg_restore \(PostgreSQL\) 17(?:\.\d+)?\s*$/.test(version)) throw fail('pg_restore must be PostgreSQL 17');
  const tocText = await invoke(['--list', archivePath]);
  const entries = parseArchiveToc(tocText);
  return Object.freeze({ tocText, entries, toolMajor: 17 });
}

#!/usr/bin/env node
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Writable, Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { runCommand, startCommand } from './process-runner.mjs';
import { collectCatalogEvidence, assertSyntheticCatalogFixture, collectSyntheticArchiveToc } from './catalog-evidence.mjs';
import { evaluateBackupState } from './backup-state.mjs';
import { reconcileArchiveToc, reconcileCatalogInventory } from './production-source.mjs';
import { encryptArchiveStream } from './encrypt-stream.mjs';
import { manifestCursorSql, RELATION_CATALOG_SQL } from './snapshot-capture.mjs';

export const IMAGE = 'supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const LABEL = 'adaptive-lifting.synthetic-recovery=true';
const SOCKET = '/tmp';
const DB_NAME = 'postgres';
const commandContext = new AsyncLocalStorage();
const WORK_MS = 8 * 60_000;
const CLEANUP_MS = 60_000;

export function assertHostedRunnerEnvironment(env = process.env, platform = process.platform) {
  if (env.GITHUB_ACTIONS !== 'true' || platform !== 'linux' || env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Synthetic recovery drill is restricted to a GitHub hosted Linux runner.');
  }
}

export function containerNames(id) {
  const safe = String(id).toLowerCase();
  if (!/^[a-z0-9-]{1,48}$/.test(safe)) throw new Error('Invalid synthetic drill run identifier.');
  return { source: `al-synthetic-recovery-${safe}-source`, restore: `al-synthetic-recovery-${safe}-restore` };
}

export function dockerRunArgs(name, image) {
  const identity = name.match(/^al-synthetic-recovery-([a-z0-9-]+)-(source|restore)$/);
  if (!identity) throw new Error('Unsafe container name.');
  if (!/^supabase\/postgres@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('PostgreSQL image must be pinned by digest.');
  const startup = [
    'set -euo pipefail',
    'umask 077',
    "head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \\n' >/tmp/synthetic-vault.key",
    "printf '#!/bin/sh\\ncat /tmp/synthetic-vault.key\\n' >/tmp/synthetic-vault-getkey.sh",
    'chmod 700 /tmp/synthetic-vault-getkey.sh',
    'initdb -D /tmp/synthetic-db --encoding=UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=reject >/tmp/init.log',
    'exec postgres -D /tmp/synthetic-db -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/tmp/synthetic-vault-getkey.sh -c cron.database_name=postgres -c cron.launch_active_jobs=off',
  ].join(' && ');
  return [
    'run', '-d', '--name', name, '--label', LABEL, '--label', `adaptive-lifting.synthetic-recovery-run=${identity[1]}`,
    '--network', 'none', '--user', 'postgres',
    '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=1g,mode=1777',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=16m,mode=1777',
    '--entrypoint', 'bash', image, '-c', startup,
  ];
}

export function assertCleanupOwnedInspect(inspect, name) {
  const item = Array.isArray(inspect) ? inspect[0] : inspect;
  const identity = name.match(/^al-synthetic-recovery-([a-z0-9-]+)-(source|restore)$/);
  if (!item || !identity || item.Name !== `/${name}` ||
      item.Config?.Labels?.['adaptive-lifting.synthetic-recovery'] !== 'true' ||
      item.Config?.Labels?.['adaptive-lifting.synthetic-recovery-run'] !== identity[1]) {
    throw new Error('Container cleanup ownership invariant failed.');
  }
  return true;
}

export function safeContainerSummary(inspect) {
  const item = Array.isArray(inspect) ? inspect[0] : inspect;
  if (!item) return { available: false };
  const host = item.HostConfig ?? {};
  const mounts = Array.isArray(item.Mounts) ? item.Mounts.map((mount) => ({
    type: typeof mount.Type === 'string' ? mount.Type : 'unknown',
    destination: typeof mount.Destination === 'string' ? mount.Destination : 'unknown',
  })) : [];
  return {
    name: typeof item.Name === 'string' ? item.Name : null,
    user: typeof item.Config?.User === 'string' ? item.Config.User : null,
    networkMode: typeof host.NetworkMode === 'string' ? host.NetworkMode : null,
    readonlyRootfs: host.ReadonlyRootfs === true,
    portBindingCount: Object.keys(host.PortBindings ?? {}).length,
    publishedPortCount: Object.values(item.NetworkSettings?.Ports ?? {}).filter(Boolean).length,
    mounts,
    tmpfsDestinations: Object.keys(host.Tmpfs ?? {}).sort(),
  };
}

export function assertIsolatedInspect(inspect, name) {
  const item = Array.isArray(inspect) ? inspect[0] : inspect;
  assertCleanupOwnedInspect(item, name);
  if (item.Config?.User !== 'postgres') throw new Error('Container non-root user invariant failed.');
  if (item.HostConfig?.NetworkMode !== 'none') throw new Error('Container network isolation invariant failed.');
  if (Object.keys(item.HostConfig?.PortBindings ?? {}).length || Object.values(item.NetworkSettings?.Ports ?? {}).some((value) => value)) {
    throw new Error('Container port publishing invariant failed.');
  }
  const expectedTmpfs = ['/tmp', '/var/lib/postgresql/data'];
  const tmpfs = item.HostConfig?.Tmpfs;
  if (!tmpfs || JSON.stringify(Object.keys(tmpfs).sort()) !== JSON.stringify(expectedTmpfs)) {
    throw new Error('Container PostgreSQL tmpfs invariant failed.');
  }
  const mounts = item.Mounts ?? [];
  if (!Array.isArray(mounts) || mounts.some((mount) => mount.Type !== 'tmpfs' || !expectedTmpfs.includes(mount.Destination)) ||
      new Set(mounts.map((mount) => mount.Destination)).size !== mounts.length) {
    throw new Error('Container mount invariant failed.');
  }
  if ((item.HostConfig?.Binds ?? []).length || (item.HostConfig?.Mounts ?? []).length ||
      (item.HostConfig?.VolumesFrom ?? []).length) {
    throw new Error('Container host mount invariant failed.');
  }
  if (!item.HostConfig?.ReadonlyRootfs) throw new Error('Container read-only root filesystem invariant failed.');
  return true;
}

export async function attemptAllCleanups(names, cleanupOne) {
  const failures = [];
  for (const name of names) {
    try { await cleanupOne(name); } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown cleanup failure';
      failures.push(new Error(`${name}: ${detail}`, { cause: error }));
    }
  }
  if (failures.length) throw new AggregateError(failures, `Container cleanup failed for ${failures.map((error) => error.message).join('; ')}.`);
}

export function combineRunErrors(stage, originalError, cleanupErrors) {
  const cleanupMessages = cleanupErrors.map((error) => error.message);
  if (originalError && cleanupErrors.length) {
    const primary = new Error(`${stage}: ${originalError.message}`, { cause: originalError });
    return new AggregateError([primary, ...cleanupErrors], `${primary.message}; cleanup failed: ${cleanupMessages.join('; ')}.`);
  }
  if (originalError) return new Error(`${stage}: ${originalError.message}`, { cause: originalError });
  if (cleanupErrors.length) return new AggregateError(cleanupErrors, `Drill passed but cleanup failed: ${cleanupMessages.join('; ')}.`);
  return null;
}

export function cleanupArgs(names) {
  return ['rm', '-f', ...names];
}

export function commandPlan(image, names, artifact, recipient) {
  return {
    source: dockerRunArgs(names.source, image),
    restore: dockerRunArgs(names.restore, image),
    dump: ['docker', 'exec', '-i', names.source, 'pg_dump', '-h', SOCKET, '-U', 'postgres', '-d', DB_NAME,
      '--strict-names', '--no-password', '--format=custom', '--schema=synthetic_recovery'],
    encrypt: ['age', '-r', recipient, '-o', artifact],
    decrypt: ['age', '-d', '-i', '<private-key>', artifact],
    restoreCommand: ['docker', 'exec', '-i', names.restore, 'pg_restore', '-h', SOCKET, '-U', 'postgres', '-d', DB_NAME,
      '--exit-on-error', '--single-transaction'],
    cleanup: cleanupArgs([names.source, names.restore]),
  };
}

async function runCapture(binary, args, { input, cwd } = {}) {
  const result = await runCommand(binary, args, { ...commandContext.getStore(), input, cwd });
  return { ...result, stdout: Buffer.from(result.stdout), stderrBytes: Buffer.byteLength(result.stderr) };
}

export function classifyPgDumpDiagnostic(diagnostic) {
  const value = String(diagnostic).toLowerCase();
  if (/snapshot.{0,40}(not found|does not exist|cannot be imported)|could not import.{0,40}snapshot/.test(value)) return 'SNAPSHOT';
  if (/permission denied|must be owner|insufficient privilege/.test(value)) return 'PERMISSION';
  if (/could not connect|connection refused|no such file or directory/.test(value)) return 'CONNECTION';
  if (/unrecognized option|unknown option|invalid option/.test(value)) return 'OPTION';
  if (/server version mismatch|unsupported version/.test(value)) return 'VERSION';
  return 'UNKNOWN';
}

function start(binary, args, { drainStdout = false, timeoutMs, classifyStderr = false } = {}) {
  const handle = startCommand(binary, args, { ...commandContext.getStore(), ...(timeoutMs ? { timeoutMs } : {}) });
  let stderrBytes = 0;
  let diagnostic = '';
  handle.child?.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (classifyStderr && diagnostic.length < 8192) diagnostic += Buffer.from(chunk).toString('utf8').slice(0, 8192 - diagnostic.length);
  });
  if (drainStdout) handle.child?.stdout.on('data', () => {});
  return { ...handle, get stderrBytes() { return stderrBytes; }, get diagnosticClass() { return classifyPgDumpDiagnostic(diagnostic); } };
}

export function classifyPgDumpExit(error, diagnosticClass) {
  if (error?.name !== 'ProcessCommandError' || !['EXIT', 'SIGNAL'].includes(error.code)) return error;
  const classified = new Error('Recovery command failed (PG_DUMP_' + diagnosticClass + ').');
  classified.name = 'ProcessCommandError';
  classified.code = `PG_DUMP_${diagnosticClass}`;
  return classified;
}

export function archiveTocResult({ stdout, stderrBytes, code, signal }) {
  if (code !== 0 || signal !== null || stderrBytes !== 0) throw new Error('Synthetic archive listing command failed or produced diagnostics.');
  return { stdout, stderr: '', code, signal };
}

export async function pipeAndCheck(from, to) {
  try {
    await Promise.all([pipeline(from.child.stdout, to.child.stdin), from.closed, to.closed]);
  } catch (error) {
    if (from.abort) void from.abort().catch(() => {}); else from.child.kill();
    if (to.abort) void to.abort().catch(() => {}); else to.child.kill();
    await Promise.allSettled([from.closed, to.closed]);
    throw error;
  }
}

async function docker(args, opts) {
  return runCapture('docker', args, opts);
}

async function readInspectContainer(name) {
  const { stdout } = await docker(['inspect', name]);
  let parsed;
  try { parsed = JSON.parse(stdout.toString('utf8')); } catch { throw new Error('Docker inspect returned invalid data.'); }
  return parsed;
}

async function inspectContainer(name) {
  const parsed = await readInspectContainer(name);
  try { assertIsolatedInspect(parsed, name); } catch (error) {
    throw new Error(`${error.message}; safe inspect summary: ${JSON.stringify(safeContainerSummary(parsed))}`, { cause: error });
  }
  return parsed[0];
}

async function cleanupOwnedContainers(names) {
  await attemptAllCleanups(names, async (name) => {
    const { stdout } = await docker(['ps', '-aq', '--filter', `name=^/${name}$`]);
    if (!stdout.toString('utf8').trim()) return;
    const parsed = await readInspectContainer(name);
    assertCleanupOwnedInspect(parsed, name);
    await docker(['rm', '-f', name]);
  });
}

async function psql(name, sql) {
  const { stdout } = await docker(['exec', '-i', name, 'psql', '-X', '-h', SOCKET, '-U', 'postgres', '-d', DB_NAME,
    '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], { input: sql, safeDiagnostic: true });
  return stdout.toString('utf8').trim();
}

const FIXTURE_SQL = `
CREATE SCHEMA synthetic_recovery;
CREATE ROLE al_recovery_reader NOLOGIN;
GRANT USAGE ON SCHEMA synthetic_recovery TO al_recovery_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA synthetic_recovery GRANT SELECT ON TABLES TO al_recovery_reader;
CREATE TABLE synthetic_recovery.schema_migrations (version text PRIMARY KEY, statements text[] NOT NULL);
INSERT INTO synthetic_recovery.schema_migrations VALUES ('20260102030405', ARRAY['synthetic fixture v1']);
CREATE SEQUENCE synthetic_recovery.workout_id_seq;
CREATE TABLE synthetic_recovery.workouts (
  id bigint PRIMARY KEY DEFAULT nextval('synthetic_recovery.workout_id_seq'),
  athlete_id uuid NOT NULL UNIQUE,
  load_kg numeric(7,2) NOT NULL CHECK (load_kg > 0),
  revision integer NOT NULL CHECK (revision > 0),
  logged_at timestamptz NOT NULL,
  deleted_at timestamptz
);
ALTER SEQUENCE synthetic_recovery.workout_id_seq OWNED BY synthetic_recovery.workouts.id;
CREATE INDEX workouts_active_logged_at_idx ON synthetic_recovery.workouts (logged_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE synthetic_recovery.workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workouts_owner ON synthetic_recovery.workouts USING (athlete_id = current_setting('app.user_id', true)::uuid);
CREATE FUNCTION synthetic_recovery.touch_workout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision := NEW.revision; RETURN NEW; END $$;
CREATE TRIGGER workouts_touch BEFORE UPDATE ON synthetic_recovery.workouts
  FOR EACH ROW EXECUTE FUNCTION synthetic_recovery.touch_workout();
CREATE TABLE synthetic_recovery.tombstones (
  entity_id uuid PRIMARY KEY,
  entity_kind text NOT NULL CHECK (entity_kind IN ('workout', 'lift')),
  deleted_at timestamptz NOT NULL
);
CREATE TABLE synthetic_recovery.revisions (
  entity_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (entity_id, revision)
);
CREATE TABLE synthetic_recovery.idempotency_keys (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  response_code integer NOT NULL CHECK (response_code BETWEEN 200 AND 299),
  created_at timestamptz NOT NULL
);
INSERT INTO synthetic_recovery.workouts (id, athlete_id, load_kg, revision, logged_at, deleted_at) VALUES
  (11, '10000000-0000-4000-8000-000000000001', 82.50, 3, '2026-01-02T03:04:05Z', NULL),
  (12, '10000000-0000-4000-8000-000000000002', 60.00, 1, '2026-01-03T03:04:05Z', '2026-01-04T03:04:05Z');
DO $$ BEGIN PERFORM setval('synthetic_recovery.workout_id_seq', 25, true); END $$;
INSERT INTO synthetic_recovery.tombstones VALUES ('20000000-0000-4000-8000-000000000002', 'workout', '2026-01-04T03:04:05Z');
INSERT INTO synthetic_recovery.revisions VALUES
  ('10000000-0000-4000-8000-000000000001', 2, repeat('a', 64)),
  ('10000000-0000-4000-8000-000000000001', 3, repeat('b', 64));
INSERT INTO synthetic_recovery.idempotency_keys VALUES (repeat('c', 64), 201, '2026-01-02T03:04:05Z');
CREATE TABLE synthetic_recovery.chunk_probe (amount numeric(30,10), payload text, missing text);
INSERT INTO synthetic_recovery.chunk_probe VALUES (12345678901234567890.1234567890, repeat(chr(54620), 20000), NULL);
INSERT INTO synthetic_recovery.chunk_probe SELECT * FROM synthetic_recovery.chunk_probe;
INSERT INTO synthetic_recovery.chunk_probe VALUES (1.5, E'line one\\nline two|colon:', NULL);
`;

export const EXPECTED_RELATIONS = Object.freeze([
  'chunk_probe', 'idempotency_keys', 'revisions', 'schema_migrations', 'tombstones', 'workouts',
]);

export function expectedSyntheticToc() {
  const entries = [];
  const add = (description, tag, schema = 'synthetic_recovery', owner = 'postgres') => entries.push({ description, schema, tag, owner });
  add('SCHEMA', 'synthetic_recovery', '-');
  add('ACL', 'SCHEMA synthetic_recovery', '-');
  add('FUNCTION', 'touch_workout()');
  add('SEQUENCE', 'workout_id_seq');
  add('SEQUENCE OWNED BY', 'workout_id_seq');
  add('SEQUENCE SET', 'workout_id_seq');
  add('DEFAULT', 'workouts id');
  for (const table of EXPECTED_RELATIONS) {
    add('TABLE', table); add('TABLE DATA', table); add('ACL', `TABLE ${table}`);
  }
  for (const [table, constraint] of [
    ['workouts', 'workouts_pkey'], ['workouts', 'workouts_athlete_id_key'],
    ['tombstones', 'tombstones_pkey'], ['revisions', 'revisions_pkey'],
    ['schema_migrations', 'schema_migrations_pkey'], ['idempotency_keys', 'idempotency_keys_pkey'],
  ]) add('CONSTRAINT', `${table} ${constraint}`);
  add('INDEX', 'workouts_active_logged_at_idx');
  add('TRIGGER', 'workouts workouts_touch');
  add('POLICY', 'workouts workouts_owner');
  add('ROW SECURITY', 'workouts');
  add('DEFAULT ACL', 'DEFAULT PRIVILEGES FOR TABLES');
  return entries;
}

async function collectFixtureCatalog(name, snapshot) {
  const client = { query: async (sql, values) => {
    if (values !== undefined && (values.length !== 1 || JSON.stringify(values[0]) !== '["synthetic_recovery"]')) throw new Error('Unexpected synthetic catalog parameters.');
    const statement = values === undefined ? sql : sql.replaceAll('$1', "ARRAY['synthetic_recovery']::text[]");
    const output = await snapshotQuery(name, `SELECT row_to_json(result)::text FROM (${statement}) result`, snapshot);
    return { rows: output.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
  } };
  const evidence = await collectCatalogEvidence({ client, schemas: ['synthetic_recovery'] });
  assertSyntheticCatalogFixture({ entries: evidence.entries, includeLedger: true, includeReader: true });
  return evidence;
}

async function holdSnapshot(name) {
  const holder = start('docker', ['exec', '-i', name, 'psql', '-X', '-h', SOCKET, '-U', 'postgres', '-d', DB_NAME,
    '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], { timeoutMs: 600_000 });
  const lines = createInterface({ input: holder.child.stdout });
  const snapshot = await new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      if (/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(line)) resolve(line);
    });
    holder.closed.then(() => reject(new Error('Snapshot holder ended before export.')), reject);
    holder.child.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');
  });
  return { snapshot, async close() { holder.child.stdin.end('ROLLBACK;\n'); await holder.closed; lines.close(); } };
}

async function snapshotQuery(name, sql, snapshot) {
  if (snapshot && !/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshot)) throw new Error('Invalid synthetic snapshot.');
  return psql(name, `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    ${snapshot ? `SET TRANSACTION SNAPSHOT '${snapshot}';` : ''}
    SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO,YMD'; SET LOCAL extra_float_digits=3;
    SET LOCAL bytea_output='hex'; SET LOCAL client_encoding='UTF8';
    SET LOCAL search_path=pg_catalog;
    ${sql}; ROLLBACK;`);
}

async function rowManifest(name, snapshot) {
  const inventory = JSON.parse(await snapshotQuery(name, `SELECT coalesce(json_agg(c.relname ORDER BY c.relname),'[]')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='synthetic_recovery' AND c.relkind IN ('r','p','f','m')`, snapshot));
  if (JSON.stringify(inventory) !== JSON.stringify(EXPECTED_RELATIONS)) throw new Error('Reviewed synthetic relation inventory mismatch.');
  const tables = [];
  for (const table of EXPECTED_RELATIONS) {
    const query = manifestCursorSql('synthetic_recovery', table).split(' CURSOR FOR')[1];
    const jsonOutput = await snapshotQuery(name, `SELECT row_to_json(x)::text FROM (${query}) x`, snapshot);
    const hash = createHash('sha256'); let count = 0; let remaining = 0;
    for (const line of jsonOutput ? jsonOutput.split('\n') : []) {
      const row = JSON.parse(line); const bytes = Buffer.from(row.chunk);
      if (bytes.length > 65536 || !/^\d+$/.test(row.row_bytes)) throw new Error('Invalid manifest chunk.');
      if (row.offset === '1') { if (remaining !== 0) throw new Error('Incomplete manifest row.'); remaining = Number(row.row_bytes); hash.update(`${remaining}:`); count++; }
      remaining -= bytes.length; if (remaining < 0) throw new Error('Manifest framing mismatch.'); hash.update(bytes);
    }
    if (remaining !== 0) throw new Error('Incomplete manifest row.');
    tables.push({ table, count, sha256: hash.digest('hex') });
  }
  const migrations = JSON.parse(await snapshotQuery(name, `SELECT json_agg(version ORDER BY version) FROM synthetic_recovery.schema_migrations`, snapshot));
  if (JSON.stringify(migrations) !== '["20260102030405"]') throw new Error('Reviewed migration inventory mismatch.');
  return { format: 'synthetic-manifest-v1', migrations, tables };
}

export const REQUIRED_CHECKS = Object.freeze([
  'isolation', 'snapshot', 'manifest', 'manifestAuthenticated', 'archiveAuthenticated', 'corruptionRejected',
  'syntheticReadback', 'toc', 'catalog', 'rows', 'migrations', 'sequences', 'cleanup',
]);

export function reconcileRestoredEvidence({ sourceManifest, restoredManifest, sourceRecords, restoredRecords, sourceSnapshot, restoredSnapshot } = {}) {
  if (!sourceManifest || !restoredManifest || !sourceSnapshot || !restoredSnapshot ||
      !Array.isArray(sourceManifest.tables) || !Array.isArray(restoredManifest.tables) ||
      JSON.stringify(sourceManifest.tables.map((item) => item.table)) !== JSON.stringify(EXPECTED_RELATIONS) ||
      JSON.stringify(sourceManifest.migrations) !== '["20260102030405"]' ||
      JSON.stringify(sourceManifest) !== JSON.stringify(restoredManifest)) throw new Error('Restored row/migration manifest mismatch.');
  reconcileCatalogInventory({ expected: sourceRecords, actual: restoredRecords });
  if (JSON.stringify(sourceSnapshot) !== JSON.stringify(restoredSnapshot) ||
      restoredSnapshot.sequence?.last_value !== 25 || restoredSnapshot.sequence?.is_called !== true ||
      !Array.isArray(restoredSnapshot.workouts) ||
      restoredSnapshot.workouts.some((row) => row.id >= restoredSnapshot.sequence.last_value)) {
    throw new Error('Restored snapshot or sequence safety mismatch.');
  }
  return { rows: true, migrations: true, catalog: true, sequences: true };
}

export function finalizeEvidence({ id, startedAt, checks, failed = false, now = new Date().toISOString() }) {
  const complete = !failed && REQUIRED_CHECKS.every((check) => checks[check] === true);
  const attempt = { id, startedAt, completedAt: now, state: complete ? 'succeeded' : 'failed' };
  // This is a local synthetic restore lifecycle, never an off-site upload claim.
  const state = evaluateBackupState({ now, expectedBy: now, maxRunMs: WORK_MS,
    attempt, point: complete ? { artifactId: id, attemptId: id, verifiedAt: now,
      uploaded: true, readbackHashVerified: true, decryptionAuthenticated: true,
      restoreVerified: true, reconciliationVerified: true, cleanupVerified: true } : null });
  return { format: 'synthetic-recovery-result-v1', scope: 'isolated-synthetic-only', status: complete ? 'PASS' : 'FAIL',
    lifecycle: state.status, productionRecovery: 'NOT TESTED', offsiteRetrieval: 'NOT TESTED',
    pointStorage: 'synthetic-local-copy',
    catalogCoverage: 'reviewed fixture objects and source-restored dependency equality; independent dependency inventory NOT TESTED',
    startedAt, completedAt: now, checks: Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, checks[key] === true ? 'PASS' : 'FAIL'])) };
}

// Publish only bounded error classes: command text, stderr, paths, recipients,
// and any source-derived values must never enter workflow output.
export function safeFailureClass(error) {
  if (error?.name === 'ProcessCommandError' && typeof error.code === 'string' && /^[A-Z_]{2,32}$/.test(error.code)) {
    return `PROCESS_${error.code}`;
  }
  if (error?.message === 'age encryption failed; source and command details were suppressed.') return 'AGE_FAILED';
  if (error?.message === 'age encryption timed out; partial ciphertext was removed.') return 'AGE_TIMEOUT';
  if (error?.message === 'Encryption was aborted; partial ciphertext was removed.') return 'INTERRUPTED';
  return 'UNCLASSIFIED';
}

export function chunkProbeSql(snapshot) {
  if (snapshot && !/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshot)) throw new Error('Invalid synthetic snapshot.');
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    ${snapshot ? `SET TRANSACTION SNAPSHOT '${snapshot}';` : ''}
    SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, YMD'; SET LOCAL extra_float_digits=3;
    SET LOCAL bytea_output='hex'; SET LOCAL client_encoding='UTF8';
    ${manifestCursorSql('synthetic_recovery', 'chunk_probe')};
    FETCH ALL FROM recovery_rows; CLOSE recovery_rows; ROLLBACK;`;
}

export function catalogProbeSql(schema = 'synthetic_recovery', table = 'workouts') {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || !/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new Error('Unsafe synthetic catalog target.');
  }
  return `PREPARE recovery_catalog(text,text) AS
      SELECT row_to_json(catalog)::text FROM (${RELATION_CATALOG_SQL}) AS catalog;
    EXECUTE recovery_catalog('${schema}','${table}');`;
}

async function verifyOriginalArchiveHash(artifact, keyPath, expectedHash, expectedBytes) {
  const decrypt = start('age', ['-d', '-i', keyPath, artifact]);
  const hash = createHash('sha256');
  let size = 0;
  const sink = new Writable({ write(chunk, _encoding, callback) { hash.update(chunk); size += chunk.length; callback(); } });
  try {
    await Promise.all([pipeline(decrypt.child.stdout, sink), decrypt.closed]);
  } catch {
    void decrypt.abort().catch(() => {});
    await Promise.allSettled([decrypt.closed]);
    throw new Error('Synthetic archive authenticated hash verification failed.');
  }
  if (hash.digest('hex') !== expectedHash || size !== expectedBytes) throw new Error('Synthetic original archive hash mismatch.');
}

const SNAPSHOT_SQL = `
SET TIME ZONE 'UTC';
SELECT json_build_object(
  'workouts', (SELECT json_agg(to_jsonb(t) ORDER BY id) FROM synthetic_recovery.workouts t),
  'tombstones', (SELECT json_agg(to_jsonb(t) ORDER BY entity_id) FROM synthetic_recovery.tombstones t),
  'revisions', (SELECT json_agg(to_jsonb(t) ORDER BY entity_id, revision) FROM synthetic_recovery.revisions t),
  'idempotency', (SELECT json_agg(to_jsonb(t) ORDER BY key_hash) FROM synthetic_recovery.idempotency_keys t),
  'sequence', (SELECT json_build_object('last_value', last_value, 'is_called', is_called) FROM synthetic_recovery.workout_id_seq),
  'constraints', (SELECT json_agg(json_build_object('table', rel.relname, 'name', con.conname, 'definition', pg_get_constraintdef(con.oid)) ORDER BY rel.relname, con.conname)
                 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = 'synthetic_recovery'),
  'indexes', (SELECT json_agg(json_build_object('table', tablename, 'name', indexname, 'definition', indexdef) ORDER BY tablename, indexname)
              FROM pg_indexes WHERE schemaname = 'synthetic_recovery')
)::text;
`;

async function waitReady(name) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await docker(['exec', name, 'pg_isready', '-h', SOCKET, '-U', 'postgres', '-d', DB_NAME]).then(() => true, () => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Synthetic PostgreSQL startup timed out.');
}

async function assertCronDisabled(name) {
  if (await psql(name, "SELECT current_setting('cron.launch_active_jobs') = 'off';") !== 't') {
    throw new Error('PostgreSQL cron active jobs must be disabled.');
  }
}

async function makeKeyPair(dir) {
  const keyPath = join(dir, 'age-identity.txt');
  await runCapture('age-keygen', ['-o', keyPath]);
  await chmod(keyPath, 0o600);
  const keyStat = await stat(keyPath);
  if ((keyStat.mode & 0o777) !== 0o600) throw new Error('Could not restrict ephemeral age key permissions.');
  const keyText = await readFile(keyPath, 'utf8');
  const recipient = keyText.match(/^# public key: (age1[0-9a-z]+)$/m)?.[1];
  if (!recipient) throw new Error('Could not read the ephemeral age public key.');
  return { keyPath, recipient };
}

async function verifyCorruptionRejected(artifact, keyPath, dir) {
  if (await runDiscard('age', ['-d', '-i', keyPath, artifact]) !== 0) {
    throw new Error('Encrypted backup failed its decryption check.');
  }
  const bytes = await readFile(artifact);
  if (bytes.length < 32) throw new Error('Encrypted backup artifact is unexpectedly small.');
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  const corrupt = join(dir, 'corrupt.age');
  await writeFile(corrupt, bytes, { mode: 0o600 });
  const code = await runDiscard('age', ['-d', '-i', keyPath, corrupt]);
  if (code === 0) throw new Error('Corrupted backup ciphertext was accepted.');
}

async function runDiscard(binary, args) {
  try { await runCapture(binary, args); return 0; }
  catch (error) { if (error.code === 'EXIT') return 1; throw error; }
}

export async function runDrill({ env = process.env, platform = process.platform, workMs = WORK_MS } = {}) {
  assertHostedRunnerEnvironment(env, platform);
  if (!Number.isSafeInteger(workMs) || workMs < 10 || workMs > WORK_MS) throw new Error('Invalid work deadline.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), workMs);
  const interrupt = () => controller.abort();
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  try {
    return await commandContext.run({ signal: controller.signal, timeoutMs: 120_000 }, () => executeDrill({ env, platform }));
  } finally {
    clearTimeout(timer); process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
  }
}

async function executeDrill({ env, platform }) {
  let stage = 'hosted runner guard';
  let originalError;
  let result;
  let tempDir;
  let names;
  let encrypted;
  let protectedManifest;
  let holder;
  const checks = {};
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const started = [];
  try {
    assertHostedRunnerEnvironment(env, platform);
    stage = 'check Docker and age tools';
    await Promise.all([
      runCapture('docker', ['version']),
      runCapture('age', ['--version']),
    ]);
    const image = IMAGE;
    stage = 'inspect pinned PostgreSQL image';
    await docker(['image', 'inspect', image]);

    names = containerNames(randomUUID().replaceAll('-', ''));
    stage = 'create private runner temp directory';
    tempDir = await mkdtemp(join(tmpdir(), 'al-synthetic-recovery-'));
    await chmod(tempDir, 0o700);
    stage = 'generate ephemeral age identity';
    const { keyPath, recipient } = await makeKeyPair(tempDir);
    for (const role of ['source', 'restore']) {
      const name = names[role];
      started.push(name);
      stage = `start ${role} PostgreSQL container`;
      await docker(dockerRunArgs(name, image));
      stage = `inspect ${role} container isolation`;
      await inspectContainer(name);
      stage = `wait for ${role} PostgreSQL`;
      await waitReady(name);
      stage = `verify ${role} cron disabled before SQL`;
      await assertCronDisabled(name);
    }

    stage = 'verify source cron disabled before fixture SQL';
    await assertCronDisabled(names.source);
    stage = 'create synthetic source fixture';
    await psql(names.source, FIXTURE_SQL);
    stage = 'verify source isolation and cron after fixture SQL';
    await Promise.all([inspectContainer(names.source), assertCronDisabled(names.source)]);
    checks.isolation = true;
    stage = 'hold exported source snapshot';
    holder = await holdSnapshot(names.source);
    checks.snapshot = true;
    stage = 'capture complete same-snapshot source manifest';
    const sourceManifest = await rowManifest(names.source, holder.snapshot);
    checks.manifest = true;
    const sourceSnapshot = JSON.parse(await snapshotQuery(names.source, SNAPSHOT_SQL, holder.snapshot));
    const sourceEvidence = await collectFixtureCatalog(names.source, holder.snapshot);
    stage = 'encrypt protected manifest';
    const manifestText = JSON.stringify({ rows: sourceManifest, catalog: sourceEvidence.entries, snapshot: sourceSnapshot });
    protectedManifest = await encryptArchiveStream(Readable.from([manifestText]), recipient, commandContext.getStore());
    await verifyOriginalArchiveHash(protectedManifest.outputPath, keyPath, protectedManifest.archiveSha256, protectedManifest.archiveBytes);
    const manifestReadback = await runCapture('age', ['-d', '-i', keyPath, protectedManifest.outputPath]);
    if (manifestReadback.stdout.toString('utf8') !== manifestText) throw new Error('Protected manifest readback mismatch.');
    checks.manifestAuthenticated = true;
    stage = 'exercise bounded manifest SQL on large UTF-8 duplicate fixture rows';
    const sourceChunks = await psql(names.source, chunkProbeSql(holder.snapshot));
    if (!sourceChunks.includes('16385|') || !sourceChunks.includes('12345678901234567890.1234567890')) {
      throw new Error('Synthetic chunked manifest fixture was not fully exercised.');
    }
    stage = 'execute relation catalog query against synthetic PostgreSQL';
    const sourceCatalog = JSON.parse(await snapshotQuery(names.source, catalogProbeSql(), holder.snapshot));
    if (sourceCatalog.kind !== 'r' || !sourceCatalog.row_security ||
        !sourceCatalog.policies.some((policy) => policy.name === 'workouts_owner') ||
        !sourceCatalog.triggers.some((trigger) => trigger.name === 'workouts_touch')) {
      throw new Error('Synthetic relation catalog probe did not capture its security metadata.');
    }

    stage = 'dump and encrypt synthetic fixture';
    const dump = start('docker', [...commandPlan(image, names, '<ciphertext>', recipient).dump.slice(1), `--snapshot=${holder.snapshot}`], { classifyStderr: true });
    const abort = new AbortController();
    const encryption = encryptArchiveStream(dump.child.stdout, recipient, { ...commandContext.getStore(), signal: AbortSignal.any([abort.signal, commandContext.getStore().signal]) })
      .then((value) => { encrypted = value; return value; });
    const dumpComplete = dump.closed.catch((error) => { abort.abort(); throw classifyPgDumpExit(error, dump.diagnosticClass); });
    try { await Promise.all([encryption, dumpComplete]); }
    catch (error) {
      void dump.abort().catch(() => {}); abort.abort();
      await Promise.allSettled([encryption, dumpComplete]);
      throw error;
    }
    await holder.close(); holder = undefined;
    stage = 'synthetic ciphertext store and independent readback';
    const originalBytes = await readFile(encrypted.outputPath);
    const originalCipherHash = createHash('sha256').update(originalBytes).digest('hex');
    const artifact = join(tempDir, 'synthetic-readback.age');
    await copyFile(encrypted.outputPath, artifact);
    await chmod(artifact, 0o600);
    const readback = await readFile(artifact);
    if (readback.length !== originalBytes.length || createHash('sha256').update(readback).digest('hex') !== originalCipherHash) {
      throw new Error('Synthetic ciphertext store readback mismatch.');
    }
    checks.syntheticReadback = true;
    stage = 'verify encrypted fixture and corruption rejection';
    await verifyCorruptionRejected(artifact, keyPath, tempDir);
    checks.corruptionRejected = true;
    await verifyOriginalArchiveHash(artifact, keyPath, encrypted.archiveSha256, encrypted.archiveBytes);
    checks.archiveAuthenticated = true;
    stage = 'reconcile real authenticated custom archive TOC';
    const toc = await collectSyntheticArchiveToc({ archivePath: '-', run: async (_binary, args) => {
      if (args[0] === '--version') {
        return archiveTocResult(await runCapture('docker', ['exec', names.source, 'pg_restore', '--version']));
      }
      const decrypt = start('age', ['-d', '-i', keyPath, artifact]);
      // The collector's '-' is its stdin sentinel; omit the native filename so
      // pg_restore reads the authenticated custom archive from the pipe.
      const list = start('docker', ['exec', '-i', names.source, 'pg_restore', '--list']);
      const chunks = []; let bytes = 0;
      list.child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes > 1024 * 1024) void list.abort().catch(() => {}); else chunks.push(chunk); });
      await pipeAndCheck(decrypt, list);
      return archiveTocResult({ ...await list.closed, stdout: Buffer.concat(chunks), stderrBytes: list.stderrBytes });
    } });
    reconcileArchiveToc({ expectedEntries: expectedSyntheticToc(), tocText: toc.tocText });
    checks.toc = true;
    stage = 'prepare reviewed restore role prerequisite';
    await psql(names.restore, 'CREATE ROLE al_recovery_reader NOLOGIN;');

    stage = 'verify restore target isolation and cron before restore';
    await Promise.all([inspectContainer(names.restore), assertCronDisabled(names.restore)]);
    stage = 'decrypt and restore synthetic fixture';
    const restore = start('docker', commandPlan(image, names, artifact, recipient).restoreCommand.slice(1), { drainStdout: true });
    const decrypt = start('age', ['-d', '-i', keyPath, artifact]);
    await pipeAndCheck(decrypt, restore);
    stage = 'verify restore isolation and cron after restore';
    await Promise.all([inspectContainer(names.restore), assertCronDisabled(names.restore)]);
    stage = 'compare restored fixture snapshot';
    const restoredSnapshot = JSON.parse(await psql(names.restore, SNAPSHOT_SQL));
    const restoredManifest = await rowManifest(names.restore);
    const restoredEvidence = await collectFixtureCatalog(names.restore);
    Object.assign(checks, reconcileRestoredEvidence({ sourceManifest, restoredManifest, sourceRecords: sourceEvidence.records,
      restoredRecords: restoredEvidence.records, sourceSnapshot, restoredSnapshot }));
    stage = 'compare restored bounded manifest fixture chunks';
    if (await psql(names.restore, chunkProbeSql()) !== sourceChunks) throw new Error('Restored chunked manifest differs from source.');
    stage = 'compare restored relation catalog metadata';
    const restoredCatalog = JSON.parse(await psql(names.restore, catalogProbeSql()));
    if (JSON.stringify(sourceCatalog) !== JSON.stringify(restoredCatalog)) throw new Error('Restored relation catalog differs from source.');
    result = {
      status: 'PASS',
      image,
      checks: ['hosted-runner guard', 'pinned local image', 'isolated non-root containers', 'cron disabled before SQL',
        'encrypted custom-format dump', 'corrupted ciphertext rejected', 'single-transaction restore',
        'original archive authenticated hash matches', 'bounded manifest SQL matches large UTF-8 and duplicate rows',
        'rows, revisions, tombstones, idempotency, sequence, constraints, and indexes match',
        'relation catalog SQL and restored ownership/RLS/columns/constraints/indexes/triggers/policies match'],
      artifact_bytes: (await stat(artifact)).size,
      artifact_sha256: createHash('sha256').update(await readFile(artifact)).digest('hex'),
      source: names.source,
      restore: names.restore,
    };
  } catch (error) {
    originalError = error instanceof Error ? error : new Error('Unknown synthetic drill failure.');
  }

  const cleanupErrors = [];
  const cleanupController = new AbortController();
  const cleanupTimer = setTimeout(() => cleanupController.abort(), CLEANUP_MS);
  await commandContext.run({ signal: cleanupController.signal, timeoutMs: 15_000 }, async () => {
    if (holder) { try { await holder.close(); } catch { cleanupErrors.push(new Error('Snapshot holder cleanup failed.')); } }
    if (started.length) {
      try { await cleanupOwnedContainers(started); } catch (error) {
        cleanupErrors.push(...(error instanceof AggregateError ? error.errors : [error]));
      }
    }
    if (tempDir) {
      try { await rm(tempDir, { recursive: true, force: true }); } catch { cleanupErrors.push(new Error('Private fixture directory cleanup failed.')); }
    }
    for (const item of [encrypted, protectedManifest]) {
      if (item) { try { await item.cleanup(); } catch { cleanupErrors.push(new Error('Encrypted fixture cleanup failed.')); } }
    }
  });
  clearTimeout(cleanupTimer);
  if (cleanupController.signal.aborted) cleanupErrors.push(new Error('Cleanup deadline exceeded.'));
  if (!originalError && commandContext.getStore().signal.aborted) originalError = new Error('Synthetic work interrupted or deadline exceeded.');
  checks.cleanup = cleanupErrors.length === 0;
  const finalError = combineRunErrors(stage, originalError, cleanupErrors);
  const envelope = finalizeEvidence({ id, startedAt, checks, failed: Boolean(finalError) });
  if (finalError) { finalError.evidence = { ...envelope, failedStage: stage, failureClass: safeFailureClass(originalError) }; throw finalError; }
  if (envelope.status !== 'PASS') { const error = new Error('Synthetic recovery evidence is incomplete.'); error.evidence = envelope; throw error; }
  return { ...envelope, image: result.image, artifact_bytes: result.artifact_bytes, artifact_sha256: result.artifact_sha256 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDrill().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify(error.evidence ?? { status: 'FAIL', lifecycle: 'failed', error: 'Synthetic recovery failed before capture.' }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

// Observation only. This module has no setting writer, lock acquisition, dump,
// provider request, storage adapter, or path that can authorize a capture.
import { PRODUCTION_SOURCE, assertHostedLinux, connectPinnedProductionSource } from './production-source.mjs';

const fail = () => new Error('Maintenance inspection failed; protected diagnostics suppressed.');
const exact = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
const COUNTS = ['appliedMigrations', 'scopedTables', 'scopedSequences', 'cronJobs', 'activeCronJobs',
  'loginRoles', 'privilegedLoginRoles', 'preparedTransactions'];
const BOOLEANS = ['runtimeCanLogin', 'pgNetInstalled', 'vaultInstalled'];
const FIELDS = ['database', 'role', 'sessionRole', 'serverVersionNum', 'readOnly', 'isolation', ...COUNTS, ...BOOLEANS];

// Fixed metadata-only query: no application rows, sequence values, Vault rows,
// role passwords, query text, cron commands, HTTP payloads, or provider secrets.
// Counts describe observations; they are not a complete writer inventory.
export const MAINTENANCE_READINESS_SQL = `SELECT jsonb_build_object(
  'database', current_database(), 'role', current_user, 'sessionRole', session_user,
  'serverVersionNum', current_setting('server_version_num'),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'isolation', current_setting('transaction_isolation'),
  'appliedMigrations', (SELECT count(*) FROM supabase_migrations.schema_migrations),
  'scopedTables', (SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','al_private','supabase_migrations')),
  'scopedSequences', (SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='S' AND n.nspname IN ('public','al_private','supabase_migrations')),
  'cronJobs', (SELECT count(*) FROM cron.job),
  'activeCronJobs', (SELECT count(*) FROM cron.job WHERE active),
  'runtimeCanLogin', (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname='al_edge_catalog_runtime'),
  'loginRoles', (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolcanlogin),
  'privilegedLoginRoles', (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolcanlogin AND (rolsuper OR rolbypassrls)),
  'preparedTransactions', (SELECT count(*) FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()),
  'pgNetInstalled', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net'),
  'vaultInstalled', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='supabase_vault')
) AS metadata`;

export function validateMaintenanceMetadata(value) {
  if (!exact(value, FIELDS) || value.database !== PRODUCTION_SOURCE.database ||
      value.role !== 'postgres' || value.sessionRole !== 'postgres' ||
      typeof value.serverVersionNum !== 'string' || !/^17\d{4}$/.test(value.serverVersionNum) || value.readOnly !== true ||
      value.isolation !== 'repeatable read' ||
      COUNTS.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0) ||
      BOOLEANS.some((field) => typeof value[field] !== 'boolean') ||
      value.activeCronJobs > value.cronJobs || value.privilegedLoginRoles > value.loginRoles) throw fail();
  return Object.freeze(structuredClone(value));
}

export function assessMaintenanceReadiness(metadata, observedAt = new Date()) {
  const value = validateMaintenanceMetadata(metadata);
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) throw fail();
  const blockers = ['CLOSED_WRITER_INVENTORY_NOT_REVIEWED', 'WRITER_FREEZE_NOT_VERIFIED',
    'INDEPENDENT_FENCED_CLEANUP_NOT_VERIFIED'];
  if (value.runtimeCanLogin) blockers.push('RUNTIME_CONNECTION_ADMISSION_NOT_PAUSED');
  if (value.activeCronJobs) blockers.push('ACTIVE_CRON_JOBS');
  // Even zero active jobs/visible sessions cannot exclude previously dispatched work.
  if (value.pgNetInstalled) blockers.push('DISPATCHED_WORKER_DRAIN_NOT_VERIFIED');
  if (value.scopedSequences) blockers.push('SEQUENCE_FENCE_AND_RECOVERY_NOT_VERIFIED');
  if (value.privilegedLoginRoles) blockers.push('PRIVILEGED_WRITER_COVERAGE_NOT_VERIFIED');
  if (value.preparedTransactions) blockers.push('PREPARED_TRANSACTIONS_PRESENT');
  return Object.freeze({ format: 'adaptive-maintenance-inspection-v1', sourceProject: PRODUCTION_SOURCE.project,
    observedAt: observedAt.toISOString(), status: 'BLOCKED', captureAllowed: false,
    scope: 'read-only-metadata-observation', observations: value, blockers: Object.freeze(blockers),
    writerFreeze: 'NOT TESTED', interruptionRecovery: 'NOT TESTED',
    sequenceRecovery: value.scopedSequences ? 'BLOCKED' : 'NOT TESTED', productionRecovery: 'NOT TESTED' });
}

/** Caller must supply an exclusively owned connection; never share its transaction.
 * Always rolls back, including a lost BEGIN response. Failure to confirm rollback
 * invalidates all observations. The caller remains responsible for closing it.
 */
export async function collectMaintenanceReadiness({ client, observedAt = new Date() } = {}) {
  if (!client || typeof client.query !== 'function' || client.identity?.database !== PRODUCTION_SOURCE.database ||
      client.identity.tls !== true || !/^17\d{4}$/.test(client.identity.version ?? '')) throw fail();
  let begun = false; let failed = false; let cleanupFailed = false; let metadata;
  try {
    begun = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path = pg_catalog');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const result = await client.query(MAINTENANCE_READINESS_SQL);
    if (!Array.isArray(result?.rows) || result.rows.length !== 1 ||
        (result.rowCount !== undefined && result.rowCount !== 1) || !exact(result.rows[0], ['metadata'])) throw fail();
    metadata = validateMaintenanceMetadata(result.rows[0].metadata);
  } catch { failed = true; }
  finally {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch { failed = true; cleanupFailed = true; }
    }
  }
  if (failed) throw Object.assign(fail(), { evidence: { status: 'failed', cleanup: cleanupFailed ? 'FAIL' : 'PASS' } });
  return assessMaintenanceReadiness(metadata, observedAt);
}

/** Hosted manual/default-branch inspection only. No capture flags are changed,
 * and no storage or management credential is consumed. No raw errors escape.
 */
export async function runProductionMaintenanceInspection({ env = process.env, platform = process.platform,
  eventGate, connectSource = connectPinnedProductionSource, observedAt = new Date() } = {}) {
  assertHostedLinux(env, platform);
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || eventGate?.allowed !== true ||
      eventGate.event !== 'workflow_dispatch' || eventGate.ref !== env.GITHUB_REF ||
      !exact(eventGate, ['allowed', 'event', 'ref']) ||
      !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(eventGate.ref ?? '') ||
      eventGate.ref.includes('..') || eventGate.ref.includes('//') || eventGate.ref.endsWith('/') ||
      typeof connectSource !== 'function') throw fail();
  let client; let report; let failed = false; let cleanupFailed = false;
  try {
    client = await connectSource({ env, platform, expectedSource: PRODUCTION_SOURCE });
    if (typeof client?.close !== 'function') throw fail();
    report = await collectMaintenanceReadiness({ client, observedAt });
  } catch (error) { failed = true; cleanupFailed = error?.evidence?.cleanup === 'FAIL'; }
  finally {
    if (client && typeof client.close === 'function') {
      try { await client.close(); } catch { failed = true; cleanupFailed = true; }
    }
  }
  if (failed) throw Object.assign(fail(), { evidence: { status: 'failed', cleanup: cleanupFailed ? 'FAIL' : 'PASS' } });
  return Object.freeze({ ...report, cleanup: 'PASS' });
}


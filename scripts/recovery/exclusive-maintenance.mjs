import protocol from '../../supabase/functions/_shared/recovery/maintenance-protocol.json' with { type: 'json' };

export const MAINTENANCE_KEY = Object.freeze([protocol.namespace, protocol.key]);
const fail = () => new Error('Exclusive maintenance failed; protected diagnostics suppressed.');
const OWNERSHIP_SQL = `SELECT pg_backend_pid() AS pid, EXISTS(
  SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
    AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND mode='ExclusiveLock' AND granted
) AS held`;

/** Scoped application-writer exclusion, provided every writer participates in
 * the reviewed request protocol. Does not pause cron/roles or mutate schema.
 * The exclusively owned client is always closed and must never auto-reconnect.
 * Administrative writers and provider ambiguity require separate reviewed proof.
 */
export async function withExclusiveMaintenance({ client, capture, signal,
  acquireTimeoutMs = 15_000, workTimeoutMs = 10 * 60_000, heartbeatMs = 10_000,
  queryTimeoutMs = 10_000, closeTimeoutMs = 15_000, now = Date.now } = {}) {
  if (typeof client?.query !== 'function' || typeof client?.close !== 'function' ||
      client.identity?.database !== 'postgres' || client.identity.tls !== true ||
      !/^17\d{4}$/.test(client.identity.version ?? '') || typeof capture !== 'function' || typeof now !== 'function' ||
      [acquireTimeoutMs, workTimeoutMs, heartbeatMs, queryTimeoutMs, closeTimeoutMs].some(v => !Number.isSafeInteger(v) || v < 1) ||
      heartbeatMs > 20_000 || acquireTimeoutMs > 60_000 || workTimeoutMs > 30 * 60_000 ||
      queryTimeoutMs > 15_000 || closeTimeoutMs > 20_000) throw fail();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  signal?.addEventListener('abort', interrupt, { once: true });
  if (signal?.aborted) interrupt();
  let interval; let heartbeat; let pid; let acquired = false; let failed = false;
  let cleanupFailed = false; let value; let stage = 'acquire';
  const timer = setTimeout(interrupt, workTimeoutMs);
  const bounded = async (operation, timeoutMs) => {
    let deadline;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        deadline = setTimeout(() => { controller.abort(); reject(fail()); }, timeoutMs);
      })]);
    } finally { clearTimeout(deadline); }
  };
  const query = async (sql, params) => {
    try { return await bounded(Promise.resolve().then(() => client.query(sql, params)), queryTimeoutMs); }
    catch { controller.abort(); throw fail(); }
  };
  const check = () => { if (controller.signal.aborted) throw fail(); };
  const cancellable = async operation => {
    check();
    let abort;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        abort = () => reject(fail());
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
      })]);
    } finally { controller.signal.removeEventListener('abort', abort); }
  };
  const assertOwnership = async () => {
    check();
    const result = await query(OWNERSHIP_SQL, [...MAINTENANCE_KEY]);
    if (result.rows?.length !== 1 || result.rows[0].pid !== pid || result.rows[0].held !== true) {
      controller.abort(); throw fail();
    }
    check();
  };
  try {
    check();
    await query("SET statement_timeout='10s'; SET idle_session_timeout='60s'");
    const started = now();
    while (true) {
      check();
      const result = await query('SELECT pg_backend_pid() AS pid, pg_catalog.pg_try_advisory_lock($1::integer,$2::integer) AS acquired', [...MAINTENANCE_KEY]);
      const row = result.rows?.[0];
      if (result.rows?.length !== 1 || !Number.isSafeInteger(row.pid) || row.pid < 1 || typeof row.acquired !== 'boolean' ||
          (pid !== undefined && pid !== row.pid)) throw fail();
      pid = row.pid;
      if (row.acquired) { acquired = true; break; }
      if (now() - started >= acquireTimeoutMs) throw fail();
      await new Promise(resolve => setTimeout(resolve, Math.min(50, acquireTimeoutMs)));
    }
    stage = 'capture'; await assertOwnership();
    interval = setInterval(() => {
      if (!heartbeat) {
        heartbeat = assertOwnership().catch(() => { controller.abort(); }).finally(() => { heartbeat = undefined; });
      }
    }, heartbeatMs);
    value = await cancellable(Promise.resolve().then(() => capture({ signal: controller.signal, assertOwnership })));
    check();
    clearInterval(interval); if (heartbeat) await heartbeat;
    await assertOwnership();
  } catch { failed = true; }
  finally {
    clearTimeout(timer); clearInterval(interval);
    signal?.removeEventListener('abort', interrupt);
    if (heartbeat) await heartbeat;
    if (acquired) {
      try {
        const result = await query('SELECT pg_backend_pid() AS pid, pg_catalog.pg_advisory_unlock($1::integer,$2::integer) AS released', [...MAINTENANCE_KEY]);
        if (result.rows?.length !== 1 || result.rows[0].pid !== pid || result.rows[0].released !== true) throw fail();
      } catch { failed = true; cleanupFailed = true; }
    }
    try { await bounded(Promise.resolve().then(() => client.close()), closeTimeoutMs); }
    catch { failed = true; cleanupFailed = true; }
  }
  if (failed || controller.signal.aborted) throw Object.assign(fail(), {
    evidence: { status: 'failed', stage, cleanup: cleanupFailed ? 'FAIL' : 'PASS' } });
  return { result: value, evidence: { format: 'adaptive-exclusive-maintenance-v1',
    status: 'completed', cleanup: 'PASS', protocol: protocol.version, scope: 'participating-application-writers' } };
}

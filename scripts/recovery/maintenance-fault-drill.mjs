// Isolated protocol and negative-control drill, not production freeze evidence.
// Uses only an isolated, digest-pinned PostgreSQL 17 container and synthetic data.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runCommand, startCommand } from './process-runner.mjs';
import { MAINTENANCE_KEY, withExclusiveMaintenance } from './exclusive-maintenance.mjs';
import { IMAGE, assertHostedRunnerEnvironment, dockerRunArgs, assertIsolatedInspect,
  assertCleanupOwnedInspect } from './synthetic-drill.mjs';

const fail = () => new Error('Synthetic maintenance fault drill failed; diagnostics suppressed.');
const FIXTURE = `
CREATE SCHEMA maintenance_fixture;
CREATE TABLE maintenance_fixture.rows (id integer PRIMARY KEY);
INSERT INTO maintenance_fixture.rows VALUES (1);
CREATE SEQUENCE maintenance_fixture.ids AS integer CACHE 5;
CREATE ROLE maintenance_fixture_writer LOGIN;
CREATE ROLE maintenance_fixture_disabled NOLOGIN;
GRANT USAGE ON SCHEMA maintenance_fixture TO maintenance_fixture_writer;
GRANT SELECT,INSERT ON maintenance_fixture.rows TO maintenance_fixture_writer;
GRANT USAGE,SELECT ON SEQUENCE maintenance_fixture.ids TO maintenance_fixture_writer;
CREATE FUNCTION maintenance_fixture.write_is_blocked() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO maintenance_fixture.rows VALUES (2);
  RETURN false;
EXCEPTION WHEN lock_not_available THEN RETURN true;
END $$;`;

// An interactive psql backend lets the drill exercise an already-authenticated
// writer and an independent lock owner. No shell, host port or mount is used.
export function openMaintenanceFaultSession({ name, role, env, signal, start }) {
  if (!/^al-synthetic-recovery-[a-f0-9-]{36}-source$/.test(name ?? '') ||
      !['postgres', 'maintenance_fixture_writer'].includes(role)) throw fail();
  const handle = start('docker', ['exec', '-i', name, 'psql', '-XqAt', '--no-password',
    '-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-U', role, '-d', 'postgres'],
  { env, signal, timeoutMs: 60_000 });
  if (!handle.child?.stdin || !handle.child?.stdout || !handle.child?.stderr) throw fail();
  let stderrBytes = 0; let sequence = 0;
  handle.child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  const lines = createInterface({ input: handle.child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  return {
    async query(sql) {
      const marker = `maintenance-end-${++sequence}`;
      handle.child.stdin.write(`${sql}\nSELECT '${marker}';\n`);
      const output = []; let bytes = 0;
      while (true) {
        const line = await iterator.next();
        if (line.done) throw fail();
        if (line.value === marker) break;
        bytes += Buffer.byteLength(line.value);
        if (bytes > 16_384) throw fail();
        output.push(line.value);
      }
      if (stderrBytes) throw fail();
      return output.join('\n');
    },
    async close({ terminated = false } = {}) {
      handle.child.stdin.end();
      let exitError;
      try { await handle.closed; }
      catch (error) { exitError = error; }
      finally { lines.close(); }
      // Only a confirmed nonzero exit can represent intentional backend death.
      // Timeout, stream failure or unconfirmed pipe/process closure never pass.
      if (terminated ? exitError?.code !== 'EXIT' : exitError || stderrBytes) throw fail();
    },
    async abort() { try { await handle.abort(); } catch { /* Container cleanup is checked separately. */ } finally { lines.close(); } },
  };
}

async function assertNewLoginRefused({ name, env, signal, start }) {
  const handle = start('docker', ['exec', '-i', name, 'psql', '-XqAt', '--no-password',
    '-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-U', 'maintenance_fixture_writer', '-d', 'postgres'],
  { env, signal, timeoutMs: 10_000 });
  let stderr = ''; let stdoutBytes = 0; let overflow = false;
  handle.child?.stdout?.on('data', chunk => { stdoutBytes += chunk.length; });
  handle.child?.stderr?.on('data', chunk => {
    if (Buffer.byteLength(stderr) + chunk.length > 4096) {
      overflow = true; void handle.abort().catch(() => {});
    } else stderr += chunk.toString('utf8');
  });
  handle.child?.stdin?.end('SELECT 1;');
  let rejectedByProcess = false;
  try { await handle.closed; }
  catch (error) { rejectedByProcess = error?.code === 'EXIT'; }
  if (!rejectedByProcess || overflow || stdoutBytes ||
      !stderr.includes('role "maintenance_fixture_writer" is not permitted to log in')) throw fail();
}

export async function runMaintenanceFaultDrill({ env = process.env, platform = process.platform,
  run = runCommand, start = startCommand, id = randomUUID() } = {}) {
  assertHostedRunnerEnvironment(env, platform);
  // This path must never inherit source/storage/root credentials, even though
  // subprocess environments are separately allowlisted below.
  if (Object.keys(env).some(key => /^(PG|SUPABASE_|AWS_|RECOVERY_)/i.test(key)) ||
      typeof run !== 'function' || typeof start !== 'function' || !/^[a-f0-9-]{36}$/.test(id)) throw fail();
  const name = `al-synthetic-recovery-${id}-source`;
  const cleanEnv = { PATH: env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const timer = setTimeout(interrupt, 3 * 60_000);
  const sessions = new Set();
  const cleanupController = new AbortController();
  let creationAttempted = false; let failed = false; let cleanupFailed = false; let result;
  let stage = 'container-create';
  const invoke = async (args, input, cleanup = false) => {
    const value = await run('docker', args, { env: cleanEnv, input, timeoutMs: 20_000,
      maxBufferBytes: 32_768, signal: cleanup ? cleanupController.signal : controller.signal });
    if (value.code !== 0 || value.signal !== null || value.stderr) throw fail();
    return value.stdout.trim();
  };
  const sql = (query, role = 'postgres') => invoke(['exec', '-i', name, 'psql', '-XqAt', '--no-password',
    '-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-U', role, '-d', 'postgres'], query);
  const session = role => {
    const value = openMaintenanceFaultSession({ name, role, env: cleanEnv, signal: controller.signal, start });
    sessions.add(value); return value;
  };
  try {
    const args = dockerRunArgs(name, IMAGE);
    args.splice(2, 0, '--label', 'adaptive-lifting.maintenance-fault=true');
    creationAttempted = true; // Include create-success/response-loss in cleanup.
    await invoke(args);
    stage = 'container-isolation';
    const inspect = JSON.parse(await invoke(['inspect', name]));
    assertIsolatedInspect(inspect, name);
    stage = 'database-readiness';
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await invoke(['exec', name, 'pg_isready', '-h', '/tmp']); ready = true; break; }
      catch { if (controller.signal.aborted) throw fail(); await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!ready) throw fail();
    stage = 'database-version';
    if (!/^17\d{4}$/.test(await sql("SELECT current_setting('server_version_num');"))) throw fail();
    stage = 'fixture-setup'; await sql(FIXTURE);

    stage = 'table-lock-session';
    const holder = session('postgres');
    const holderPid = await holder.query('BEGIN; LOCK TABLE maintenance_fixture.rows IN SHARE MODE; SELECT pg_backend_pid();');
    if (!/^\d+$/.test(holderPid)) throw fail();
    stage = 'table-write-blocking';
    if (await sql("SET lock_timeout='300ms'; SELECT maintenance_fixture.write_is_blocked();") !== 't') throw fail();
    stage = 'table-read';
    if (await sql('SELECT count(*) FROM maintenance_fixture.rows;') !== '1') throw fail();
    stage = 'sequence-nextval-under-lock';
    if (await sql("SELECT nextval('maintenance_fixture.ids');") !== '1') throw fail();
    stage = 'sequence-cache';
    if (await sql('SELECT last_value FROM maintenance_fixture.ids;') !== '5') throw fail();
    stage = 'sequence-setval-under-lock';
    if (await sql("SELECT setval('maintenance_fixture.ids',10,true);") !== '10') throw fail();

    stage = 'existing-writer-connect';
    const writer = session('maintenance_fixture_writer');
    if (await writer.query('SELECT current_user;') !== 'maintenance_fixture_writer') throw fail();
    stage = 'pause-login'; await sql('ALTER ROLE maintenance_fixture_writer NOLOGIN;');
    stage = 'existing-writer-nextval-after-nologin';
    if (await writer.query("SELECT nextval('maintenance_fixture.ids');") !== '11') throw fail();
    stage = 'new-login-refusal';
    await assertNewLoginRefused({ name, env: cleanEnv, signal: controller.signal, start });
    stage = 'existing-writer-still-live';
    if (await writer.query('SELECT 1;') !== '1') throw fail();

    // Kill the lock-owning backend without its ROLLBACK/finally. Table locks
    // disappear, but a separately committed NOLOGIN survives that connection.
    stage = 'terminate-lock-backend';
    if (await sql(`SELECT pg_terminate_backend(${holderPid});`) !== 't') throw fail();
    // Force noninteractive psql to observe the dead backend rather than ending
    // stdin at idle, which can exit zero without consuming the server's FATAL.
    stage = 'observe-lock-backend-loss';
    let deadBackendRejected = false;
    try { await holder.query('SELECT 1;'); } catch { deadBackendRejected = true; }
    if (!deadBackendRejected) throw fail();
    stage = 'confirm-lock-owner-process-exit';
    await holder.close({ terminated: true }); sessions.delete(holder);
    stage = 'table-write-after-owner-loss';
    if (await sql("SET lock_timeout='300ms'; SELECT NOT maintenance_fixture.write_is_blocked();") !== 't') throw fail();
    stage = 'committed-pause-retained';
    if (await sql("SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='maintenance_fixture_writer';") !== 't') throw fail();
    // Synthetic independent cleanup, executed by a different backend. This is
    // deliberately not evidence for an encrypted durable production journal.
    stage = 'synthetic-independent-setting-restore';
    await sql('ALTER ROLE maintenance_fixture_writer LOGIN;');
    if (await sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='maintenance_fixture_writer';") !== 't' ||
        await sql("SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='maintenance_fixture_disabled';") !== 't') throw fail();
    if (await sql('SELECT 1;', 'maintenance_fixture_writer') !== '1') throw fail();
    stage = 'writer-process-exit'; await writer.close(); sessions.delete(writer);

    const key = MAINTENANCE_KEY.join(',');
    stage = 'shared-request-acquire';
    const request = session('maintenance_fixture_writer');
    if (await request.query(`SELECT pg_try_advisory_lock_shared(${key});`) !== 't') throw fail();
    const control = session('postgres');
    stage = 'shared-request-delays-exclusive';
    if (await control.query(`SELECT pg_try_advisory_lock(${key});`) !== 'f') throw fail();
    // Provider work occurs between SQL helpers while the request session stays
    // alive. This proves that gap only, not provider drain after session loss.
    if (await request.query('SELECT 1;') !== '1' ||
        await control.query(`SELECT pg_try_advisory_lock(${key});`) !== 'f') throw fail();
    if (await request.query(`SELECT pg_advisory_unlock_shared(${key});`) !== 't') throw fail();
    stage = 'exclusive-protocol';
    // Unix-socket fixture adapter only. identity.tls=true satisfies the helper's
    // injected-client contract; it is explicitly NOT source TLS evidence.
    const fixtureClient = {
      identity: { database: 'postgres', version: '170011', tls: true },
      async query(statement, parameters = []) {
        const text = statement.replace(/\$(\d+)/g, (_match, index) => {
          const value = parameters[Number(index) - 1];
          if (!Number.isSafeInteger(value)) throw fail();
          return String(value);
        });
        if (text.startsWith('SET ')) { await control.query(`${text};`); return { rows: [] }; }
        return { rows: [JSON.parse(await control.query(`SELECT row_to_json(q) FROM (${text}) q;`))] };
      },
      async close() { await control.close(); sessions.delete(control); },
    };
    await withExclusiveMaintenance({ client: fixtureClient, capture: async ({ assertOwnership }) => {
      if (await request.query(`SELECT pg_try_advisory_lock_shared(${key});`) !== 'f') throw fail();
      await assertOwnership();
    } });
    if (await request.query(`SELECT pg_try_advisory_lock_shared(${key});`) !== 't' ||
        await request.query(`SELECT pg_advisory_unlock_shared(${key});`) !== 't') throw fail();
    stage = 'exclusive-owner-loss';
    const owner = session('postgres');
    const ownerPid = await owner.query(`SELECT pg_backend_pid() WHERE pg_try_advisory_lock(${key});`);
    if (!/^\d+$/.test(ownerPid) ||
        await request.query(`SELECT pg_try_advisory_lock_shared(${key});`) !== 'f' ||
        await sql(`SELECT pg_terminate_backend(${ownerPid});`) !== 't') throw fail();
    let ownerLost = false;
    try { await owner.query('SELECT 1;'); } catch { ownerLost = true; }
    if (!ownerLost) throw fail();
    await owner.close({ terminated: true }); sessions.delete(owner);
    if (await request.query(`SELECT pg_try_advisory_lock_shared(${key});`) !== 't' ||
        await request.query(`SELECT pg_advisory_unlock_shared(${key});`) !== 't') throw fail();
    await request.close(); sessions.delete(request);
    stage = 'final-isolation';
    assertIsolatedInspect(JSON.parse(await invoke(['inspect', name])), name);
    result = { format: 'adaptive-maintenance-fault-drill-v1', status: 'synthetic-negative-controls-verified',
      checks: { tableWritesBlocked: true, readersProceed: true, sequenceAdvancesUnderTableLock: true,
        sequenceSetvalUnderTableLock: true, sequenceCacheObserved: true, existingLoginSurvivesNoLogin: true,
        newLoginRefused: true, connectionLossReleasesTableLock: true, committedPauseSurvivesConnectionLoss: true,
        syntheticIndependentSettingRestore: true, sharedRequestDelaysExclusive: true,
        sharedLeaseSurvivesProviderGap: true, exclusiveRejectsNewAdmission: true,
        exclusiveGuardRunsAgainstPostgres: true, ownerLossResumesAdmission: true }, productionWriterFreeze: 'NOT TESTED',
      fixtureTransport: 'unix-socket', productionTls: 'NOT TESTED',
      durableEncryptedCleanup: 'NOT TESTED', hostedPoolerAdmission: 'NOT TESTED', captureAllowed: false };
  } catch { failed = true; }
  finally {
    clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    const cleanupTimer = setTimeout(() => cleanupController.abort(), 60_000);
    for (const value of sessions) await value.abort().catch(() => {});
    if (creationAttempted) {
      try {
        const found = await invoke(['ps', '-aq', '--filter', `name=^/${name}$`], undefined, true);
        if (found) {
          const inspect = JSON.parse(await invoke(['inspect', name], undefined, true));
          assertCleanupOwnedInspect(inspect, name);
          await invoke(['rm', '-f', name], undefined, true);
        }
        if (await invoke(['ps', '-aq', '--filter', `name=^/${name}$`], undefined, true)) throw fail();
      } catch { failed = true; cleanupFailed = true; }
    }
    clearTimeout(cleanupTimer);
    if (cleanupController.signal.aborted) { failed = true; cleanupFailed = true; }
  }
  if (failed || !result || controller.signal.aborted) throw Object.assign(fail(), {
    evidence: { status: 'failed', failedStage: stage, cleanup: cleanupFailed ? 'FAIL' : 'PASS', captureAllowed: false } });
  return { ...result, cleanup: 'PASS' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await runMaintenanceFaultDrill()) + '\n'); }
  catch (error) {
    if (error?.evidence) process.stdout.write(JSON.stringify(error.evidence) + '\n');
    process.stderr.write('Synthetic maintenance fault drill failed; diagnostics suppressed.\n'); process.exitCode = 1;
  }
}

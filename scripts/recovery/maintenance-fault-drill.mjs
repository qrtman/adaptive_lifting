// Isolated protocol and negative-control drill, not production freeze evidence.
// Uses only an isolated, digest-pinned PostgreSQL 17 container and synthetic data.
import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { posix } from 'node:path';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { runCommand, startCommand } from './process-runner.mjs';
import { MAINTENANCE_KEY, withExclusiveMaintenance } from './exclusive-maintenance.mjs';
import { IMAGE, assertHostedRunnerEnvironment, dockerRunArgs, assertIsolatedInspect,
  assertCleanupOwnedInspect } from './synthetic-drill.mjs';

const fail = () => new Error('Synthetic maintenance fault drill failed; diagnostics suppressed.');
export function nativeFixtureFailureCategory(stderr) {
  if (/GLIBC(?:XX)?_|CXXABI_|error while loading shared libraries|cannot execute|no such file or directory/i.test(stderr)) return 'runtime-dependency';
  if (/NotCapable|Requires .+ access|PermissionDenied|permission denied/i.test(stderr)) return 'runtime-permission';
  if (/warning|notice/i.test(stderr)) return 'runtime-warning';
  return 'runtime-failure';
}
export function nativeFixtureRuntime(paths, { activeLoader, profileGcc, profileCpp } = {}) {
  const storeLibrary = /^\/nix\/store\/[a-z0-9]{32}-[A-Za-z0-9.+_-]+\/lib\/[^/]+$/;
  if (!Array.isArray(paths) || paths.length > 16 || paths.some(path => typeof path !== 'string' || !storeLibrary.test(path))) throw fail();
  const unique = [...new Set(paths)];
  const loaders = unique.filter(path => /\/(?:ld-linux-x86-64\.so\.2|ld-[0-9.]+\.so)$/.test(path));
  // Nix retains bootstrap xgcc outputs alongside the final GCC runtime.
  const bootstrap = unique.filter(path => /-xgcc-\d+\.\d+\.\d+-libgcc\/lib\/libgcc_s\.so\.1$/.test(path));
  const gcc = unique.filter(path => /\/libgcc_s\.so\.1$/.test(path) && !bootstrap.includes(path));
  const cpp = unique.filter(path => /\/libstdc\+\+\.so\.6(?:\.[0-9]+)*$/.test(path));
  if (!loaders.length || !gcc.length || unique.length !== loaders.length + gcc.length + cpp.length + bootstrap.length) throw fail();
  const orderedLoaders = loaders.map(path => {
    const version = /-glibc-(\d+)\.(\d+)(?:-(\d+))?\/lib\//.exec(path);
    if (!version || version.slice(1).some(value => value !== undefined && Number(value) > 9999)) throw fail();
    return { path, major: Number(version[1]), minor: Number(version[2]), revision: Number(version[3] ?? 0) };
  }).sort((a, b) => b.major - a.major || b.minor - a.minor || b.revision - a.revision);
  const newest = orderedLoaders.filter(item => item.major === orderedLoaders[0]?.major && item.minor === orderedLoaders[0]?.minor && item.revision === orderedLoaders[0]?.revision);
  const loader = activeLoader ?? (newest.length === 1 ? newest[0].path : undefined);
  if (!loader || !loaders.includes(loader) || (profileGcc && !gcc.includes(profileGcc)) ||
      (profileCpp && !cpp.includes(profileCpp))) throw fail();
  const family = path => {
    const parts = /\/nix\/store\/[a-z0-9]{32}-gcc-(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.+_-]+)?\/lib\//.exec(path);
    if (!parts || parts.slice(1).some(value => Number(value) > 9999)) throw fail();
    return parts.slice(1).map(Number);
  };
  const sameFamily = (a, b) => family(a).join('.') === family(b).join('.');
  for (const path of [...gcc, ...cpp]) family(path);
  let selectedGcc; let selectedCpp;
  if (profileGcc || profileCpp) {
    if (profileGcc && profileCpp && !sameFamily(profileGcc, profileCpp)) throw fail();
    const anchor = profileGcc ?? profileCpp;
    const matchingGcc = gcc.filter(path => sameFamily(path, anchor));
    const matchingCpp = cpp.filter(path => sameFamily(path, anchor));
    selectedGcc = profileGcc ?? matchingGcc.find(path => posix.dirname(path) === posix.dirname(anchor)) ??
      (matchingGcc.length === 1 ? matchingGcc[0] : undefined);
    selectedCpp = profileCpp ?? matchingCpp.find(path => selectedGcc && posix.dirname(path) === posix.dirname(selectedGcc)) ??
      (matchingCpp.length === 1 ? matchingCpp[0] : undefined);
  } else {
    const versions = [...new Set(gcc.map(path => family(path).join('.')))];
    versions.sort((a, b) => {
      const av = a.split('.').map(Number); const bv = b.split('.').map(Number);
      return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
    });
    const highest = versions[0];
    const matchingGcc = gcc.filter(path => family(path).join('.') === highest);
    const matchingCpp = cpp.filter(path => family(path).join('.') === highest);
    const pairs = matchingCpp.flatMap(c => matchingGcc.filter(g => posix.dirname(g) === posix.dirname(c)).map(g => [g, c]));
    if (pairs.length === 1) [selectedGcc, selectedCpp] = pairs[0];
    else if (matchingGcc.length === 1 && matchingCpp.length <= 1) {
      selectedGcc = matchingGcc[0]; selectedCpp = matchingCpp[0];
    }
  }
  if (!selectedGcc || (cpp.length && !selectedCpp)) throw fail();
  const directories = [...new Set([loader, selectedGcc, ...(selectedCpp ? [selectedCpp] : [])].map(path => posix.dirname(path)))].sort();
  return [loader, '--library-path', directories.join(':'), '/tmp/recovery-maintenance-runtime',
    'run', '--no-prompt', '--no-config', '--no-remote', '--no-npm',
    '--allow-read=/tmp', '--allow-write=/tmp', '/tmp/recovery-maintenance-fixture.js'];
}
async function executeNativeFixture({ name, runtime, env, signal, start }) {
  const handle = start('docker', ['exec', '-e', 'DENO_DIR=/tmp/maintenance-deno-cache',
    '-e', 'DENO_NO_UPDATE_CHECK=1', name, ...runtime],
    { env, signal, timeoutMs: 30_000 });
  const output = []; const diagnostics = []; let bytes = 0; let overflow = false;
  for (const [stream, chunks] of [[handle.child?.stdout, output], [handle.child?.stderr, diagnostics]]) {
    stream?.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 32_768) { overflow = true; void handle.abort().catch(() => {}); }
      else chunks.push(Buffer.from(chunk));
    });
  }
  handle.child?.stdin?.end();
  let failed = false;
  try { await handle.closed; } catch { failed = true; }
  const stderr = Buffer.concat(diagnostics).toString('utf8');
  if (failed || stderr || overflow) throw Object.assign(fail(), {
    nativeCategory: overflow ? 'runtime-output-limit' : nativeFixtureFailureCategory(stderr),
  });
  return Buffer.concat(output).toString('utf8').trim();
}
export async function validateNativeFixtureFiles({ env, stat = lstat, canonicalPath = realpath,
  uid = process.getuid?.() } = {}) {
  const base = env?.RUNNER_TEMP;
  const directory = env?.MAINTENANCE_NATIVE_FIXTURE_DIR;
  if (typeof base !== 'string' || !posix.isAbsolute(base) || posix.normalize(base) !== base ||
      typeof directory !== 'string' || posix.dirname(directory) !== base ||
      !/^al-native-fixture-[A-Za-z0-9]{8}$/.test(posix.basename(directory)) ||
      !Number.isSafeInteger(uid) || uid < 1 || await canonicalPath(directory) !== directory) throw fail();
  const folder = await stat(directory);
  const path = posix.join(directory, 'gate-fixture');
  const binary = await stat(path);
  const scriptPath = posix.join(directory, 'gate-fixture.js');
  const script = await stat(scriptPath);
  if (!folder.isDirectory() || folder.isSymbolicLink() || folder.uid !== uid || (folder.mode & 0o777) !== 0o700 ||
      !binary.isFile() || binary.isSymbolicLink() || binary.uid !== uid || (binary.mode & 0o777) !== 0o755 ||
      !Number.isSafeInteger(binary.size) || binary.size < 1 || binary.size > 300 * 1024 * 1024) throw fail();
  if (!script.isFile() || script.isSymbolicLink() || script.uid !== uid || (script.mode & 0o777) !== 0o600 ||
      !Number.isSafeInteger(script.size) || script.size < 1 || script.size > 8 * 1024 * 1024) throw fail();
  return { binaryPath: path, scriptPath };
}
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
  let nativeRuntimeCounts;
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
    stage = 'native-driver-file-validation';
    assertIsolatedInspect(JSON.parse(await invoke(['inspect', name])), name);
    const nativeFiles = await validateNativeFixtureFiles({ env });
    // Docker's archive-copy path cannot reliably target this read-only-rootfs
    // fixture's tmpfs. Write through the existing unprivileged container user.
    for (const item of [
      { path: nativeFiles.binaryPath, target: '/tmp/recovery-maintenance-runtime', limit: 300 * 1024 * 1024, mode: '755' },
      { path: nativeFiles.scriptPath, target: '/tmp/recovery-maintenance-fixture.js', limit: 8 * 1024 * 1024, mode: '600' },
    ]) {
      const nativeBytes = await readFile(item.path);
      if (!nativeBytes.length || nativeBytes.length > item.limit) throw fail();
      stage = 'native-driver-transfer';
      await invoke(['exec', '-i', name, 'dd', `of=${item.target}`, 'bs=1M', 'iflag=fullblock', 'status=none'], nativeBytes);
      stage = 'native-driver-transfer-verification';
      const nativeHash = createHash('sha256').update(nativeBytes).digest('hex');
      if (await invoke(['exec', name, 'sha256sum', item.target]) !== `${nativeHash}  ${item.target}`) throw fail();
      await invoke(['exec', name, 'chmod', item.mode, item.target]);
    }
    // The pinned image uses Nix. Reuse its
    // immutable installed runtime; never install libraries or change isolation.
    stage = 'native-driver-runtime-discovery';
    const libraries = (await invoke(['exec', name, 'bash', '-c',
      'shopt -s nullglob; for candidate in /nix/store/*/lib/ld-linux-x86-64.so.2 /nix/store/*/lib/libgcc_s.so.1 /nix/store/*/lib/libstdc++.so.6; do if [[ -e "$candidate" ]]; then printf "%s\\n" "$candidate"; fi; done'])).split('\n');
    nativeRuntimeCounts = { candidates: Math.min(libraries.length, 17) };
    if (libraries.length < 2 || libraries.length > 16 || libraries.some(path =>
      !/^\/nix\/store\/[a-z0-9]{32}-[A-Za-z0-9.+_-]+\/lib\/(?:ld-linux-x86-64\.so\.2|libgcc_s\.so\.1|libstdc\+\+\.so\.6)$/.test(path))) throw fail();
    stage = 'native-driver-runtime-canonicalization';
    // One operand and -f work with both BusyBox and GNU readlink. Broken image
    // symlinks were excluded by the existence check above.
    const resolved = [];
    for (const path of libraries) resolved.push(await invoke(['exec', name, 'readlink', '-f', path]));
    const canonical = [...new Set(resolved)];
    nativeRuntimeCounts = { ...nativeRuntimeCounts, unique: Math.min(canonical.length, 17),
      loaders: canonical.filter(path => /\/(?:ld-linux-x86-64\.so\.2|ld-[0-9.]+\.so)$/.test(path)).length,
      gcc: canonical.filter(path => /\/libgcc_s\.so\.1$/.test(path)).length,
      cpp: canonical.filter(path => /\/libstdc\+\+\.so\.6(?:\.[0-9]+)*$/.test(path)).length };
    // Public package metadata only, never process diagnostics or data paths.
    if (canonical.every(path => /^\/nix\/store\/[a-z0-9]{32}-[A-Za-z0-9.+_-]{1,100}\/lib\/[A-Za-z0-9.+_-]{1,64}$/.test(path))) {
      nativeRuntimeCounts.packages = canonical.map(path => path.split('/')[3].slice(33) + '/' + posix.basename(path));
    }
    // Bash may be static or use another loader. The fixture needs an installed
    // glibc candidate, not Bash's ABI. Actual Deno execution must prove it works.
    stage = 'native-driver-profile-runtime';
    const profile = (await invoke(['exec', name, 'bash', '-c',
      'for candidate in /nix/var/nix/profiles/default/lib/libgcc_s.so.1 /nix/var/nix/profiles/default/lib/libstdc++.so.6; do if [[ -e "$candidate" ]]; then printf "%s\\n" "$candidate"; fi; done'])).split('\n').filter(Boolean);
    let profileGcc; let profileCpp;
    for (const path of profile) {
      if (!['/nix/var/nix/profiles/default/lib/libgcc_s.so.1', '/nix/var/nix/profiles/default/lib/libstdc++.so.6'].includes(path)) throw fail();
      const target = await invoke(['exec', name, 'readlink', '-f', path]);
      if (path.endsWith('libgcc_s.so.1')) profileGcc = target; else profileCpp = target;
    }
    stage = 'native-driver-runtime-selection';
    const runtime = nativeFixtureRuntime(canonical, { profileGcc, profileCpp });
    stage = 'native-driver-gate';
    let native;
    try { native = JSON.parse(await executeNativeFixture({ name, runtime, env: cleanEnv, signal: controller.signal, start })); }
    catch (error) {
      stage = `native-driver-${error.nativeCategory ?? 'invalid-output'}`;
      throw fail();
    }
    const nativeChecks = ['sharedSessionAcrossHelpers', 'sharedSessionAcrossProviderGap',
      'exclusiveRejectsBeforeCallback', 'terminatedSessionRejectsWrites', 'driverReconnectDisabled',
      'freshRequestReadmitted', 'cleanup'];
    if (native.format !== 'adaptive-native-maintenance-fixture-v1' || native.status !== 'verified' ||
        Object.keys(native).sort().join(',') !== ['format', 'status', 'checks', 'fixtureTransport', 'productionTls', 'captureAllowed'].sort().join(',') ||
        native.fixtureTransport !== 'unix-socket' || native.productionTls !== 'NOT TESTED' || native.captureAllowed !== false ||
        Object.keys(native.checks ?? {}).sort().join(',') !== [...nativeChecks].sort().join(',') ||
        nativeChecks.some(key => native.checks[key] !== true)) {
      if (['connect', 'request-shared', 'exclusive-denial', 'terminated-backend', 'fresh-request'].includes(native.failedStage)) {
        stage = `native-driver-${native.failedStage}`;
      }
      throw fail();
    }
    stage = 'final-isolation';
    assertIsolatedInspect(JSON.parse(await invoke(['inspect', name])), name);
    result = { format: 'adaptive-maintenance-fault-drill-v1', status: 'synthetic-negative-controls-verified',
      checks: { tableWritesBlocked: true, readersProceed: true, sequenceAdvancesUnderTableLock: true,
        sequenceSetvalUnderTableLock: true, sequenceCacheObserved: true, existingLoginSurvivesNoLogin: true,
        newLoginRefused: true, connectionLossReleasesTableLock: true, committedPauseSurvivesConnectionLoss: true,
        syntheticIndependentSettingRestore: true, sharedRequestDelaysExclusive: true,
        sharedLeaseSurvivesProviderGap: true, exclusiveRejectsNewAdmission: true,
        exclusiveGuardRunsAgainstPostgres: true, ownerLossResumesAdmission: true,
        nativeDenoRequestGate: true, nativeDriverReconnectDisabled: true }, productionWriterFreeze: 'NOT TESTED',
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
    evidence: { status: 'failed', failedStage: stage, cleanup: cleanupFailed ? 'FAIL' : 'PASS', captureAllowed: false,
      ...(nativeRuntimeCounts ? { nativeRuntimeCounts } : {}) } });
  return { ...result, cleanup: 'PASS' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await runMaintenanceFaultDrill()) + '\n'); }
  catch (error) {
    if (error?.evidence) process.stdout.write(JSON.stringify(error.evidence) + '\n');
    process.stderr.write('Synthetic maintenance fault drill failed; diagnostics suppressed.\n'); process.exitCode = 1;
  }
}


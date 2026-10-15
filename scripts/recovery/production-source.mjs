import { spawn as nodeSpawn } from 'node:child_process';
import { chmod, lstat, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const PRODUCTION_SOURCE = Object.freeze({
  project: 'gadusaizqnshxqcckibq',
  host: 'aws-0-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.gadusaizqnshxqcckibq',
  database: 'postgres',
  majorVersion: 17,
});

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function assertHostedLinux(env = process.env, platform = process.platform) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || platform !== 'linux') {
    throw new Error('Production source access is restricted to a GitHub hosted Linux runner.');
  }
}

function requiredSecret(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Required protected input ${name} is missing.`);
  return value;
}

export function validateCaBundle(pem) {
  if (typeof pem !== 'string' || !pem.trim()) throw new Error('A Supabase database CA bundle is required.');
  const certs = pem.match(PEM_CERT) ?? [];
  const remainder = pem.replace(PEM_CERT, '').trim();
  if (certs.length < 1 || remainder.length !== 0) throw new Error('The database CA bundle is malformed.');
  return certs.join('\n') + '\n';
}

export function productionClientConfig(env) {
  const password = requiredSecret(env, 'RECOVERY_DB_PASSWORD');
  const ca = validateCaBundle(requiredSecret(env, 'RECOVERY_DB_CA_PEM'));
  return Object.freeze({
    host: PRODUCTION_SOURCE.host,
    port: PRODUCTION_SOURCE.port,
    user: PRODUCTION_SOURCE.user,
    database: PRODUCTION_SOURCE.database,
    password,
    ssl: Object.freeze({ ca, rejectUnauthorized: true, servername: PRODUCTION_SOURCE.host }),
    connectionTimeoutMillis: 15_000,
    query_timeout: 120_000,
    application_name: 'adaptive-production-recovery-capture',
    keepAlive: true,
  });
}

/** Connects only to the immutable production target with certificate and host
 * verification enabled. `Client` is injected so local tests never load secrets
 * or instantiate a network client. Returned query failures contain no driver
 * diagnostics or row content.
 */
export async function connectProductionSource({ Client, env = process.env, platform = process.platform }) {
  assertHostedLinux(env, platform);
  if (typeof Client !== 'function') throw new Error('The pinned PostgreSQL client is required.');
  const config = productionClientConfig(env);
  let native;
  let disconnected = false;
  try {
    native = new Client(config);
    native.on?.('error', () => { disconnected = true; });
    await native.connect();
    const identity = (await native.query(`SELECT current_database() AS database,
      current_setting('server_version_num') AS version,
      ssl.ssl AS tls
      FROM pg_catalog.pg_stat_ssl AS ssl WHERE ssl.pid=pg_backend_pid()`)).rows[0];
    if (identity?.database !== PRODUCTION_SOURCE.database ||
        !new RegExp(`^${PRODUCTION_SOURCE.majorVersion}\\d{4}$`).test(identity.version) || identity.tls !== true) {
      throw new Error('Source identity verification failed.');
    }
    return Object.freeze({
      query: async (...args) => {
        if (disconnected) throw new Error('Protected source connection is unavailable.');
        try { return await native.query(...args); }
        catch { throw new Error('Protected source query failed.'); }
      },
      close: async () => {
        try { await native.end(); }
        catch { throw new Error('Protected source connection cleanup failed.'); }
      },
      identity: Object.freeze({ database: identity.database, version: identity.version, tls: identity.tls }),
    });
  } catch {
    try { await native?.end(); } catch { /* Suppress driver diagnostics and preserve fail-closed status. */ }
    throw new Error('Protected production source connection or identity check failed.');
  }
}

/** Production entrypoint for the pinned scripts/recovery pg dependency. The
 * runner guard runs before importing the package or reading protected inputs.
 */
export async function connectPinnedProductionSource({ env = process.env, platform = process.platform } = {}) {
  assertHostedLinux(env, platform);
  let Client;
  try { ({ Client } = await import('pg')); }
  catch { throw new Error('The pinned PostgreSQL client could not be loaded.'); }
  return connectProductionSource({ Client, env, platform });
}

export async function writePgDumpCaFile({ env = process.env, platform = process.platform, tempRoot = env.RUNNER_TEMP }) {
  assertHostedLinux(env, platform);
  const ca = validateCaBundle(requiredSecret(env, 'RECOVERY_DB_CA_PEM'));
  if (typeof tempRoot !== 'string' || !isAbsolute(tempRoot) || typeof env.RUNNER_TEMP !== 'string' ||
      resolve(tempRoot) !== resolve(env.RUNNER_TEMP)) {
    throw new Error('A hosted-runner temporary directory is required.');
  }
  let directory;
  try {
    directory = await mkdtemp(join(tempRoot, 'adaptive-pg-ca-'));
    await chmod(directory, 0o700);
    const path = join(directory, 'root.crt');
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(ca, { encoding: 'utf8' }); }
    finally { await handle.close(); }
    return Object.freeze({ path, cleanup: async () => {
      try { await rm(directory, { recursive: true, force: true }); }
      catch { throw new Error('Database CA temporary-file cleanup failed.'); }
    } });
  } catch {
    if (directory) { try { await rm(directory, { recursive: true, force: true }); } catch { /* Preserve sanitized failure. */ } }
    throw new Error('Database CA temporary-file preparation failed.');
  }
}

async function validatePgDumpCaFile({ env, platform, caFile }) {
  assertHostedLinux(env, platform);
  if (!caFile || typeof caFile.path !== 'string' || typeof caFile.cleanup !== 'function' ||
      typeof env.RUNNER_TEMP !== 'string') throw new Error('A prepared runner CA file is required.');
  const path = resolve(caFile.path);
  const root = resolve(env.RUNNER_TEMP);
  const relativePath = relative(root, path);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath)) {
    throw new Error('Database CA file must remain under the hosted runner temporary directory.');
  }
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink() || (process.platform === 'linux' && (file.mode & 0o777) !== 0o600)) {
      throw new Error('Unsafe CA file.');
    }
    const actual = validateCaBundle(await readFile(path, 'utf8'));
    const expected = validateCaBundle(requiredSecret(env, 'RECOVERY_DB_CA_PEM'));
    if (actual !== expected) throw new Error('CA mismatch.');
  } catch {
    throw new Error('Database CA file validation failed.');
  }
  return path;
}

export function pgDumpEnvironment({ env = process.env, platform = process.platform, caPath }) {
  assertHostedLinux(env, platform);
  const password = requiredSecret(env, 'RECOVERY_DB_PASSWORD');
  if (typeof caPath !== 'string' || !isAbsolute(caPath)) throw new Error('A hosted-runner CA file is required.');
  return Object.freeze({
    PATH: env.PATH ?? '/usr/bin:/bin',
    LANG: 'C',
    LC_ALL: 'C',
    PGPASSWORD: password,
    PGPASSFILE: '/dev/null',
    PGSERVICEFILE: '/dev/null',
    PGHOST: PRODUCTION_SOURCE.host,
    PGPORT: String(PRODUCTION_SOURCE.port),
    PGUSER: PRODUCTION_SOURCE.user,
    PGDATABASE: PRODUCTION_SOURCE.database,
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: caPath,
  });
}

function pgDumpArgs(snapshot, schemas) {
  if (typeof snapshot !== 'string' || !/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshot)) {
    throw new Error('Invalid exported snapshot.');
  }
  if (!Array.isArray(schemas) || schemas.length === 0 || new Set(schemas).size !== schemas.length ||
      schemas.some((schema) => !/^[a-z_][a-z0-9_]*$/.test(schema))) throw new Error('Invalid reviewed schema allowlist.');
  return ['--no-password', '--format=custom', '--strict-names', '--file=-', `--snapshot=${snapshot}`,
    ...schemas.map((schema) => `--schema=${schema}`)];
}

/** Starts pg_dump as a binary stdout stream. The caller must await completion
 * before accepting/encrypting the result; stderr and native errors are discarded.
 */
export function startProductionPgDump({ snapshot, schemas, env = process.env, platform = process.platform,
  caPath, spawn = nodeSpawn, timeoutMs = 60 * 60_000, killGraceMs = 1_000 }) {
  assertHostedLinux(env, platform);
  if (typeof spawn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      !Number.isSafeInteger(killGraceMs) || killGraceMs < 1) throw new Error('Invalid pg_dump process configuration.');
  const args = pgDumpArgs(snapshot, schemas);
  const childEnv = pgDumpEnvironment({ env, platform, caPath });
  let child;
  let settled = false;
  let closed = false;
  let timedOut = false;
  let killTimer;
  let timeout;
  let closeWaitTimer;
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  // Prevent a very fast native failure from becoming an unhandled rejection
  // while the caller is still draining/aborting the encryption stream.
  void completion.catch(() => {});
  const settle = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    clearTimeout(closeWaitTimer);
    if (error) rejectCompletion(error);
    else resolveCompletion();
  };
  const terminate = () => {
    if (!child || closed) return;
    try { child.kill('SIGTERM'); } catch { /* Bounded SIGKILL below. */ }
    killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
      closeWaitTimer = setTimeout(() => settle(new Error('pg_dump termination was not confirmed.')), killGraceMs);
    }, killGraceMs);
  };
  try {
    child = spawn('pg_dump', args, { env: childEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!child?.stdout || !child?.stderr || typeof child.once !== 'function' || typeof child.kill !== 'function') {
      throw new Error('Invalid pg_dump process.');
    }
    child.stderr.on('data', () => {});
    child.once('error', () => settle(new Error('pg_dump process failed.')));
    child.once('close', (code) => {
      closed = true;
      if (timedOut) settle(new Error('pg_dump timed out.'));
      else if (code !== 0) settle(new Error('pg_dump failed.'));
      else settle();
    });
    timeout = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    return Object.freeze({ archive: child.stdout, completion, cancel: terminate, args: Object.freeze([...args]) });
  } catch {
    try { child?.kill('SIGKILL'); } catch { /* Spawn may not have returned a process. */ }
    settle(new Error('pg_dump could not be started.'));
    throw new Error('pg_dump could not be started.');
  }
}

export async function verifyPgDumpVersion({ env = process.env, platform = process.platform, caPath,
  spawn = nodeSpawn, timeoutMs = 10_000, killGraceMs = 1_000 }) {
  assertHostedLinux(env, platform);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(killGraceMs) || killGraceMs < 1) {
    throw new Error('Invalid pg_dump version-check configuration.');
  }
  // Reuse the isolated production libpq environment, but remove the password:
  // `--version` is offline and must not receive database credentials.
  const versionEnv = { ...pgDumpEnvironment({ env, platform, caPath }) };
  delete versionEnv.PGPASSWORD;
  return await new Promise((resolve, reject) => {
    let child;
    let output = '';
    let settled = false;
    let killTimer;
    let closeWaitTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(closeWaitTimer);
      if (error) reject(error);
      else resolve('17');
    };
    const timeout = setTimeout(() => {
      try { child?.kill('SIGTERM'); } catch { /* Bounded SIGKILL handles process failure. */ }
      killTimer = setTimeout(() => {
        try { child?.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
        closeWaitTimer = setTimeout(() => finish(new Error('pg_dump version check did not terminate.')), killGraceMs);
      }, killGraceMs);
    }, timeoutMs);
    try {
      child = spawn('pg_dump', ['--version'], { env: versionEnv, shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'] });
      if (!child?.stdout || typeof child.once !== 'function' || typeof child.kill !== 'function') {
        finish(new Error('pg_dump version check failed.'));
        return;
      }
      child.stdout.on('data', (chunk) => {
        output += chunk.toString('ascii');
        if (output.length > 256) {
          try { child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
          finish(new Error('pg_dump version response is invalid.'));
        }
      });
      child.once('error', () => finish(new Error('pg_dump version check failed.')));
      child.once('close', (code) => {
        if (code !== 0 || !/^pg_dump \(PostgreSQL\) 17(?:\.\d+)?\s*$/.test(output.trim())) {
          finish(new Error('pg_dump must match the PostgreSQL 17 source major version.'));
        } else finish();
      });
    } catch {
      finish(new Error('pg_dump version check failed.'));
    }
  });
}

/** Snapshot adapter for captureSnapshot. `encrypt` must consume the entire
 * binary stream and return only after authenticated encryption completes.
 */
export function productionArchiveCapture({ env = process.env, platform = process.platform, caFile,
  spawn = nodeSpawn, encrypt, timeoutMs, schemas = ['public', 'al_private', 'supabase_migrations'] }) {
  if (typeof encrypt !== 'function') throw new Error('An authenticated archive encryption adapter is required.');
  const fixedSchemas = ['public', 'al_private', 'supabase_migrations'];
  if (JSON.stringify(schemas) !== JSON.stringify(fixedSchemas)) throw new Error('Production archive schema scope is fixed and reviewed.');
  return async ({ snapshot, dumpArgs }) => {
    if (JSON.stringify(dumpArgs) !== JSON.stringify(['--format=custom', '--strict-names', '--no-password', '--file=-',
      `--snapshot=${snapshot}`, ...fixedSchemas.map((schema) => `--schema=${schema}`)])) {
      throw new Error('Snapshot archive options differ from the reviewed production scope.');
    }
    const caPath = await validatePgDumpCaFile({ env, platform, caFile });
    await verifyPgDumpVersion({ env, platform, caPath, spawn });
    const dump = startProductionPgDump({ snapshot, schemas: fixedSchemas,
      env, platform, caPath, spawn, timeoutMs });
    let encrypted;
    try {
      encrypted = await encrypt(dump.archive);
      await dump.completion;
      return encrypted;
    } catch {
      dump.cancel();
      dump.archive.destroy();
      try { await dump.completion; } catch { /* Preserve the sanitized capture error. */ }
      try { await encrypted?.cleanup?.(); } catch { /* Preserve fail-closed capture status. */ }
      throw new Error('Encrypted source archive capture failed.');
    }
  };
}

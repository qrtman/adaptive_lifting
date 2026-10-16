import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { lstat, mkdtemp, open, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SAFE_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SAFE_PREFIX_SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;
const AWS_CLI = 'aws';

export function assertHostedRunnerEnvironment(env = process.env, platform = process.platform) {
  if (env.GITHUB_ACTIONS !== 'true' || platform !== 'linux' || env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Ciphertext storage is restricted to a GitHub hosted Linux runner.');
  }
}

export function storageTarget({ accountId, bucket, prefix }) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new Error('Invalid R2 account identifier.');
  if (typeof bucket !== 'string' || !SAFE_BUCKET.test(bucket) || bucket.includes('..')) throw new Error('Invalid R2 bucket.');
  if (typeof prefix !== 'string' || prefix.length > 180 || prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new Error('Invalid R2 prefix.');
  }
  const segments = prefix.split('/');
  if (segments.length < 2 || segments.some((part) => !SAFE_PREFIX_SEGMENT.test(part)) || segments[0] !== 'production') {
    throw new Error('R2 prefix must be an exclusive production path with at least two safe segments.');
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  return Object.freeze({ endpoint, bucket, prefix: `${prefix}/` });
}

export function newObjectKey(prefix, now = new Date(), id = randomUUID()) {
  if (!prefix.endsWith('/') || !/^production\/(?:[a-z0-9-]+\/)+$/.test(prefix)) throw new Error('Invalid validated prefix.');
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
    throw new Error('Invalid object identity.');
  }
  return `${prefix}${now.toISOString().replaceAll(':', '').replaceAll('-', '')}/${id}.age`;
}

function safeFailure(stage) {
  return new Error(`Ciphertext ${stage} failed; provider details were suppressed.`);
}

function argsFor(operation, target, key, file) {
  const base = ['s3api', operation, '--endpoint-url', target.endpoint, '--region', 'auto', '--no-cli-pager'];
  if (operation === 'put-object') return [...base, '--bucket', target.bucket, '--key', key, '--body', file, '--if-none-match', '*'];
  return [...base, '--bucket', target.bucket, '--key', key, file];
}

function checkedInput(options) {
  const { env = process.env, platform = process.platform, accountId, bucket, prefix, key } = options;
  assertHostedRunnerEnvironment(env, platform);
  const target = storageTarget({ accountId, bucket, prefix });
  const keyTail = typeof key === 'string' ? key.slice(target.prefix.length) : '';
  if (typeof key !== 'string' || !key.startsWith(target.prefix) || /[\s\x00-\x1f\x7f\\]/.test(key) ||
      keyTail.includes('..') || !/^\d{8}T\d{6}\.\d{3}Z\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.age$/i.test(keyTail)) {
    throw new Error('Object key must match the generated immutable ciphertext key format.');
  }
  if (typeof env.AWS_ACCESS_KEY_ID !== 'string' || !env.AWS_ACCESS_KEY_ID.trim() ||
      typeof env.AWS_SECRET_ACCESS_KEY !== 'string' || !env.AWS_SECRET_ACCESS_KEY.trim()) {
    throw new Error('Inherited R2 static credentials are required.');
  }
  const executor = options.executor ?? createAwsCliExecutor();
  if (typeof executor !== 'function') throw new Error('An AWS CLI executor is required.');
  return { target, key, executor };
}

function safeEnvironment(env) {
  // Only inherited static job credentials and the executable search path cross this boundary.
  const safe = { PATH: env.PATH ?? '', HOME: env.HOME ?? '/tmp', AWS_REGION: 'auto', AWS_DEFAULT_REGION: 'auto',
    AWS_EC2_METADATA_DISABLED: 'true', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_CLI_AUTO_PROMPT: 'off' };
  for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) {
    if (typeof env[name] === 'string') safe[name] = env[name];
  }
  return safe;
}

/**
 * Spawn AWS CLI with argv only, discard all output, and bound process lifetime.
 * AWS CLI may follow service redirects internally; endpoint behavior must be reviewed
 * before production use. CLI config and endpoint overrides are isolated by safeEnvironment.
 */
export function createAwsCliExecutor({ spawnImpl = spawn, timeoutMs = 120_000, killGraceMs = 1_000 } = {}) {
  if (typeof spawnImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      !Number.isSafeInteger(killGraceMs) || killGraceMs < 1) throw new Error('Invalid AWS CLI executor configuration.');
  return ({ args, env }) => new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timedOut = false;
    let killTimer;
    let closeWaitTimer;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(closeWaitTimer);
      if (error) reject(error);
      else resolve(value);
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try { child?.kill('SIGTERM'); } catch { /* Close or bounded SIGKILL handles process exit. */ }
      killTimer = setTimeout(() => {
        try { child?.kill('SIGKILL'); } catch { /* Process may already have exited. */ }
        closeWaitTimer = setTimeout(() => finish(null, new Error('AWS CLI process termination was not confirmed.')), killGraceMs);
      }, killGraceMs);
    }, timeoutMs);
    try {
      child = spawnImpl(AWS_CLI, args, { env, shell: false, stdio: 'ignore', windowsHide: true });
      child.once('error', () => finish(null, new Error('AWS CLI process failed.')));
      child.once('close', (code) => finish(timedOut ? { code: null, timedOut: true } : { code }));
    } catch {
      finish(null, new Error('AWS CLI process failed.'));
    }
  });
}

async function run(executor, args, env) {
  try {
    return await executor({ executable: AWS_CLI, args, env: safeEnvironment(env) });
  } catch {
    throw safeFailure('transport');
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
  await pipeline(createReadStream(path), meter, new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
  return { size, sha256: hash.digest('hex') };
}

/**
 * The default executor uses AWS CLI argv with no shell and discards process output.
 * AWS CLI follows service redirects internally, so a production integration needs
 * reviewed endpoint behavior. Credentials never become command arguments/log output.
 */
/** Upload only an age ciphertext file, then fetch it to a separate temporary file and verify bytes. */
export async function uploadAndVerifyCiphertext(options) {
  const validated = checkedInput(options);
  const { sourcePath, tempRoot = tmpdir(), env = process.env, remove = rm } = options;
  if (typeof remove !== 'function') throw new Error('A cleanup function is required.');
  if (typeof sourcePath !== 'string' || !sourcePath.endsWith('.age')) throw new Error('Only .age ciphertext files may be uploaded.');
  const sourceInfo = await lstat(sourcePath).catch(() => null);
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) throw new Error('Ciphertext input must be a non-symlink regular file.');
  if (sourceInfo.size > MAX_SINGLE_PUT_BYTES) throw new Error('Ciphertext exceeds the bounded single-object upload limit.');
  // This checks only the documented age stream header; it does not authenticate payloads.
  const ageHeader = Buffer.from('age-encryption.org/v1\n', 'ascii');
  const header = Buffer.alloc(ageHeader.length);
  const handle = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== ageHeader.length || !header.equals(ageHeader)) throw new Error('Input is not an age ciphertext stream.');
  } finally {
    await handle.close();
  }
  const expected = await hashFile(sourcePath);
  const dir = await mkdtemp(join(tempRoot, 'al-r2-ciphertext-'));
  const retrievedPath = join(dir, 'readback.age');
  let result;
  try {
    const put = await run(validated.executor,
      argsFor('put-object', validated.target, validated.key, sourcePath), env);
    if (put?.code !== 0) throw safeFailure('upload');
    const get = await run(validated.executor,
      argsFor('get-object', validated.target, validated.key, retrievedPath), env);
    if (get?.code !== 0) throw safeFailure('readback');
    const actualInfo = await lstat(retrievedPath).catch(() => null);
    if (!actualInfo?.isFile()) throw safeFailure('readback');
    const actual = await hashFile(retrievedPath);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error('Ciphertext readback verification mismatch.');
    result = Object.freeze({ key: validated.key, size: expected.size, sha256: expected.sha256, byteVerified: true });
  } catch (primaryError) {
    try {
      await remove(dir, { recursive: true, force: true });
    } catch {
      throw new Error(`${primaryError.message} Temporary ciphertext cleanup failed at the private temp directory.`);
    }
    throw primaryError;
  }
  try {
    await remove(dir, { recursive: true, force: true });
  } catch {
    throw new Error('Ciphertext upload verified, but temporary readback cleanup failed.');
  }
  return result;
}

/** Download into a new private temp directory; caller must invoke cleanup after consuming outputPath. */
export async function downloadAndVerifyCiphertext(options) {
  const validated = checkedInput(options);
  const { tempRoot = tmpdir(), expectedSize, expectedSha256, env = process.env, remove = rm } = options;
  if (typeof remove !== 'function') throw new Error('A cleanup function is required.');
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) {
    throw new Error('Expected ciphertext size and SHA-256 are required.');
  }
  const directory = await mkdtemp(join(tempRoot, 'al-r2-download-'));
  const outputPath = join(directory, 'download.age');
  try {
    const result = await run(validated.executor,
      argsFor('get-object', validated.target, validated.key, outputPath), env);
    if (result?.code !== 0) throw safeFailure('download');
    const info = await lstat(outputPath).catch(() => null);
    if (!info?.isFile()) throw safeFailure('download');
    const actual = await hashFile(outputPath);
    if (actual.size !== expectedSize || actual.sha256 !== expectedSha256) throw new Error('Ciphertext download verification mismatch.');
    return Object.freeze({ key: validated.key, outputPath, ...actual, byteVerified: true,
      cleanup: async () => {
        try { await remove(directory, { recursive: true, force: true }); }
        catch { throw new Error('Ciphertext verified, but private download cleanup failed.'); }
      } });
  } catch (error) {
    try { await remove(directory, { recursive: true, force: true }); }
    catch { throw new Error(`${error.message} Private download cleanup failed.`); }
    throw error;
  }
}

export const __test = Object.freeze({ argsFor });

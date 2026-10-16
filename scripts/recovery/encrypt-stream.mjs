import { spawn as nodeSpawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function assertHostedLinuxRunner(env = process.env, platform = process.platform) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || platform !== 'linux') {
    throw new Error('Encryption is restricted to a GitHub hosted Linux runner.');
  }
}

function validateRecipient(recipient) {
  // age performs the authoritative bech32/checksum validation. This shape check
  // rejects accidental misuse and option injection before starting the process.
  if (typeof recipient !== 'string' || !/^age1[023456789acdefghjklmnpqrstuvwxyz]{20,100}$/.test(recipient)) {
    throw new Error('A valid age x25519 public recipient is required.');
  }
}

function safeFailure() {
  return new Error('age encryption failed; source and command details were suppressed.');
}

function childClosed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(safeFailure()));
    child.once('close', (code) => code === 0 ? resolve() : reject(safeFailure()));
  });
}

/** Stream an archive directly through age into a new private ciphertext file.
 * The successful caller owns cleanup() and must call it after consuming outputPath.
 */
export async function encryptArchiveStream(archive, recipient, {
  env = process.env,
  platform = process.platform,
  guard = assertHostedLinuxRunner,
  spawn = nodeSpawn,
  remove = rm,
  ageBinary = 'age',
  tempRoot = tmpdir(),
  timeoutMs = 5 * 60_000,
  signal,
} = {}) {
  // Guard is deliberately the first operation: local/self-hosted calls cannot
  // validate, touch the filesystem, or start a command.
  guard(env, platform);
  validateRecipient(recipient);
  if (!archive || typeof archive.pipe !== 'function') throw new Error('Archive must be a readable stream.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Encryption timeout must be a positive integer.');
  if (signal?.aborted) throw new Error('Encryption was aborted.');

  let dir;
  let outputPath;
  let output;
  let child;
  let closed;
  let processClosed;
  let timeout;
  let forceKill;
  let termination;
  let abortListener;
  let timedOut = false;
  let didClose = false;
  const archiveHash = createHash('sha256');
  let archiveBytes = 0;

  const terminate = () => {
    archive.destroy();
    child?.stdin?.destroy();
    child?.stdout?.destroy();
    output?.destroy();
    if (!child || didClose) return Promise.resolve();
    if (termination) return termination;
    child.kill('SIGTERM');
    termination = Promise.race([
      processClosed,
      new Promise((resolve) => {
        forceKill = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 1_000);
      }),
    ]);
    return termination;
  };
  try {
    dir = await mkdtemp(join(tempRoot, 'adaptive-age-'));
    await chmod(dir, 0o700);
    outputPath = join(dir, `${randomUUID()}.age`);
    const file = await open(outputPath, 'wx', 0o600);
    output = file.createWriteStream({ autoClose: true });

    const childEnv = { PATH: env.PATH ?? '', LANG: 'C', LC_ALL: 'C' };
    child = spawn(ageBinary, ['-r', recipient], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: childEnv,
    });
    processClosed = new Promise((resolve) => child.once('close', () => { didClose = true; resolve(); }));
    closed = childClosed(child);
    child.stderr.on('data', () => {}); // Drain without retaining/exposing diagnostics.
    timeout = setTimeout(() => { timedOut = true; void terminate(); }, timeoutMs);
    abortListener = () => { void terminate(); };
    signal?.addEventListener('abort', abortListener, { once: true });
    // Abort may occur between the initial preflight and listener registration.
    if (signal?.aborted) abortListener();

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        archiveBytes += chunk.length;
        archiveHash.update(chunk);
        callback(null, chunk);
      },
    });
    const inputPipe = pipeline(archive, meter, child.stdin);
    const outputPipe = pipeline(child.stdout, output);
    try {
      await Promise.all([inputPipe, outputPipe, closed]);
    } catch {
      await terminate();
      await Promise.allSettled([inputPipe, outputPipe]);
      if (timedOut) throw new Error('age encryption timed out; partial ciphertext was removed.');
      if (signal?.aborted) throw new Error('Encryption was aborted; partial ciphertext was removed.');
      throw safeFailure();
    }
    if (signal?.aborted) throw new Error('Encryption was aborted; partial ciphertext was removed.');
    clearTimeout(timeout);
    timeout = undefined;
    const cleanup = async () => {
      try { await remove(dir, { recursive: true, force: true }); }
      catch { throw new Error('Ciphertext temporary-file cleanup failed.'); }
    };
    return { outputPath, archiveSha256: archiveHash.digest('hex'), archiveBytes, cleanup };
  } catch (error) {
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
    if (child) await terminate();
    else archive.destroy();
    if (output && !output.closed) {
      output.destroy();
      await new Promise((resolve) => output.closed ? resolve() : output.once('close', resolve));
    }
    if (dir) {
      try { await remove(dir, { recursive: true, force: true }); }
      catch { throw new Error('Encryption failed and partial ciphertext cleanup failed.'); }
    }
    // Preserve our own deliberately sanitized operational errors only.
    if (error?.message === 'age encryption timed out; partial ciphertext was removed.' ||
        error?.message === 'Encryption was aborted; partial ciphertext was removed.') throw error;
    throw safeFailure();
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceKill);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }
}

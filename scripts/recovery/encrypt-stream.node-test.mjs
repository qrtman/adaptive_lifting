import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { assertHostedLinuxRunner, encryptArchiveStream } from './encrypt-stream.mjs';

const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', PATH: '/usr/bin', SECRET_SHOULD_NOT_PASS: 'hidden' };
const recipient = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

function fakeAge({ code = 0, late = false, failInput = false, ignoreTerm = false } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.signals = [];
  const chunks = [];
  child.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  child.stdin.on('end', () => {
    if (failInput) return;
    child.stdout.end(Buffer.concat(chunks));
    setTimeout(() => {
      child.exitCode = code;
      child.emit('close', code, null);
    }, late ? 15 : 0);
  });
  child.kill = (signal = 'SIGTERM') => {
    child.killed = true;
    child.signals.push(signal);
    if (signal === 'SIGTERM' && ignoreTerm) return true;
    child.stdin.destroy();
    child.stdout.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.signalCode = signal;
      setImmediate(() => child.emit('close', null, signal));
    }
    return true;
  };
  return child;
}

async function tempRoot() { return mkdtemp(join(tmpdir(), 'age-stream-test-')); }

test('hosted runner guard rejects before spawning or touching a temporary directory', async () => {
  assert.throws(() => assertHostedLinuxRunner({}, 'linux'), /GitHub hosted Linux/);
  let spawned = false;
  await assert.rejects(encryptArchiveStream(Readable.from([Buffer.from('synthetic')]), recipient, {
    env: {}, platform: 'linux', tempRoot: tmpdir(), spawn: () => { spawned = true; },
  }), /GitHub hosted Linux/);
  assert.equal(spawned, false);
});

test('streams arbitrary bytes into a private ciphertext file with sanitized age environment', async () => {
  const root = await tempRoot();
  let options;
  let args;
  try {
    const payload = Buffer.from([0, 255, 1, 128, 10, 0]);
    const encrypted = await encryptArchiveStream(Readable.from([payload.subarray(0, 2), payload.subarray(2)]), recipient, {
      env: hosted,
      platform: 'linux',
      tempRoot: root,
      spawn: (_binary, childArgs, childOptions) => {
        args = childArgs;
        options = childOptions;
        return fakeAge({ late: true });
      },
    });
    assert.deepEqual(args, ['-r', recipient]);
    assert.deepEqual(options.env, { PATH: '/usr/bin', LANG: 'C', LC_ALL: 'C' });
    assert.deepEqual(await readFile(encrypted.outputPath), payload);
    assert.equal(encrypted.archiveSha256, createHash('sha256').update(payload).digest('hex'));
    assert.equal(encrypted.archiveBytes, payload.length);
    assert.deepEqual(Object.keys(encrypted).sort(), ['archiveBytes', 'archiveSha256', 'cleanup', 'outputPath']);
    if (process.platform !== 'win32') {
      assert.equal((await stat(encrypted.outputPath)).mode & 0o777, 0o600);
      assert.equal((await stat(join(root, (await readdir(root))[0]))).mode & 0o777, 0o700);
    }
    await encrypted.cleanup();
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('late nonzero age exit rejects and removes partial ciphertext', async () => {
  const root = await tempRoot();
  try {
    await assert.rejects(encryptArchiveStream(Readable.from([Buffer.from('SYNTHETIC')]), recipient, {
      env: hosted, platform: 'linux', tempRoot: root,
      spawn: () => fakeAge({ code: 9, late: true }),
    }), /source and command details were suppressed/);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('broken archive stream kills age and removes partial ciphertext', async () => {
  const root = await tempRoot();
  const broken = new Readable({ read() { this.push(Buffer.from('SYNTHETIC')); this.destroy(new Error('synthetic source broke')); } });
  let child;
  try {
    await assert.rejects(encryptArchiveStream(broken, recipient, {
      env: hosted, platform: 'linux', tempRoot: root,
      spawn: () => (child = fakeAge({ failInput: true })),
    }));
    assert.equal(child.killed, true);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid recipient never starts age', async () => {
  let spawned = false;
  await assert.rejects(encryptArchiveStream(Readable.from([]), 'age1-invalid', {
    env: hosted, platform: 'linux', tempRoot: tmpdir(), spawn: () => { spawned = true; },
  }), /valid age x25519 public recipient/);
  assert.equal(spawned, false);
});

test('cleanup failure is reported without exposing filesystem diagnostics', async () => {
  const root = await tempRoot();
  try {
    const encrypted = await encryptArchiveStream(Readable.from([Buffer.from('SYNTHETIC')]), recipient, {
      env: hosted,
      platform: 'linux',
      tempRoot: root,
      spawn: () => fakeAge(),
      remove: async () => { throw new Error('sensitive path detail'); },
    });
    await assert.rejects(encrypted.cleanup(), (error) => {
      assert.match(error.message, /Ciphertext temporary-file cleanup failed/);
      assert.doesNotMatch(error.message, /sensitive path detail/);
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('timeout escalates from SIGTERM to SIGKILL and cleans stalled stream output', async () => {
  const root = await tempRoot();
  const stalled = new Readable({ read() {} });
  let child;
  try {
    await assert.rejects(encryptArchiveStream(stalled, recipient, {
      env: hosted, platform: 'linux', tempRoot: root, timeoutMs: 15,
      spawn: () => (child = fakeAge({ ignoreTerm: true })),
    }), /timed out/);
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('abort while source is stalled escalates and rejects promptly', async () => {
  const root = await tempRoot();
  const stalled = new Readable({ read() {} });
  const controller = new AbortController();
  let child;
  try {
    const result = encryptArchiveStream(stalled, recipient, {
      env: hosted, platform: 'linux', tempRoot: root, timeoutMs: 5_000, signal: controller.signal,
      spawn: () => (child = fakeAge({ ignoreTerm: true })),
    });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(result, /aborted/);
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('synchronous spawn failure closes source and removes temporary files', async () => {
  const root = await tempRoot();
  const stalled = new Readable({ read() {} });
  try {
    await assert.rejects(encryptArchiveStream(stalled, recipient, {
      env: hosted, platform: 'linux', tempRoot: root,
      spawn: () => { throw new Error('sensitive spawn detail'); },
    }), (error) => {
      assert.match(error.message, /source and command details were suppressed/);
      assert.doesNotMatch(error.message, /sensitive spawn detail/);
      return true;
    });
    assert.equal(stalled.destroyed, true);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

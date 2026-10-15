import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { copyFile, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAwsCliExecutor, downloadAndVerifyCiphertext, newObjectKey, storageTarget, uploadAndVerifyCiphertext } from './ciphertext-store.mjs';

const hostEnv = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', PATH: '/bin', AWS_ACCESS_KEY_ID: 'synthetic-id', AWS_SECRET_ACCESS_KEY: 'synthetic-secret' };
const config = { accountId: '0123456789abcdef0123456789abcdef', bucket: 'synthetic-backups', prefix: 'production/recovery-test' };
const ageBytes = Buffer.from('age-encryption.org/v1\n-> test synthetic\nsynthetic-ciphertext-only\n');

function fakeExecutor({ corruptReadback = false, failAt = null } = {}) {
  const objects = new Map();
  const calls = [];
  return {
    calls,
    async execute(call) {
      calls.push(call);
      const [service, operation] = call.args;
      assert.equal(service, 's3api');
      if (failAt === operation) return { code: 1, stderr: 'sensitive provider diagnostic must not escape' };
      const key = call.args[call.args.indexOf('--key') + 1];
      if (operation === 'put-object') {
        if (call.args.includes('--body')) assert.ok(call.args.includes('--if-none-match') && call.args.includes('*'));
        if (objects.has(key)) return { code: 1, stderr: 'precondition failed' };
        await copyFile(call.args[call.args.indexOf('--body') + 1], join(objectsDir, key.replaceAll('/', '_')));
        objects.set(key, join(objectsDir, key.replaceAll('/', '_')));
        return { code: 0 };
      }
      const destination = call.args.at(-1);
      const stored = objects.get(key);
      if (!stored) return { code: 1 };
      await copyFile(stored, destination);
      if (corruptReadback) await writeFile(destination, Buffer.from('corrupted age ciphertext'));
      return { code: 0 };
    },
  };
}

let objectsDir;
test.beforeEach(async () => { objectsDir = await mkdtemp(join(tmpdir(), 'al-r2-fake-')); });
test.afterEach(async () => { await rm(objectsDir, { recursive: true, force: true }); });

test('target pins the canonical HTTPS R2 endpoint and requires an exclusive production prefix', () => {
  assert.deepEqual(storageTarget(config), {
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    bucket: config.bucket,
    prefix: 'production/recovery-test/',
  });
  for (const bad of [
    { ...config, accountId: 'attacker.example' },
    { ...config, bucket: 'bucket/other' },
    { ...config, prefix: 'staging/recovery' },
    { ...config, prefix: 'production/../other' },
    { ...config, prefix: 'production' },
  ]) assert.throws(() => storageTarget(bad));
});

test('AWS CLI executor uses shell-free argv, suppresses output, and returns process status', async () => {
  const child = new EventEmitter();
  let observed;
  const executor = createAwsCliExecutor({ spawnImpl: (executable, args, options) => {
    observed = { executable, args, options };
    queueMicrotask(() => child.emit('close', 0));
    return child;
  }, timeoutMs: 500, killGraceMs: 20 });
  const result = await executor({ args: ['s3api', 'get-object'], env: hostEnv });
  assert.deepEqual(result, { code: 0 });
  assert.equal(observed.executable, 'aws');
  assert.deepEqual(observed.args, ['s3api', 'get-object']);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.stdio, 'ignore');
  assert.equal(observed.options.env, hostEnv);
});

test('AWS CLI executor terminates and returns failure when the process exceeds its timeout', async () => {
  const child = new EventEmitter();
  const signals = [];
  child.kill = (signal) => { signals.push(signal); return true; };
  const executor = createAwsCliExecutor({ spawnImpl: () => child, timeoutMs: 5, killGraceMs: 5 });
  await assert.rejects(executor({ args: ['s3api', 'get-object'], env: hostEnv }), /termination was not confirmed/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('AWS CLI exit zero after timeout SIGTERM remains a timeout failure', async () => {
  const child = new EventEmitter();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGTERM') queueMicrotask(() => child.emit('close', 0));
    return true;
  };
  const executor = createAwsCliExecutor({ spawnImpl: () => child, timeoutMs: 5, killGraceMs: 20 });
  const result = await executor({ args: ['s3api', 'get-object'], env: hostEnv });
  assert.deepEqual(result, { code: null, timedOut: true });
  assert.deepEqual(signals, ['SIGTERM']);
});

test('object keys are unique immutable candidates under the configured path', () => {
  const date = new Date('2026-10-15T00:00:00.000Z');
  const one = newObjectKey('production/recovery-test/', date, '00000000-0000-4000-8000-000000000001');
  const two = newObjectKey('production/recovery-test/', date, '00000000-0000-4000-8000-000000000002');
  assert.notEqual(one, two);
  assert.match(one, /^production\/recovery-test\/20261015T000000\.000Z\/[a-f0-9-]+\.age$/i);
});

test('upload performs a separate GET and verifies independent size and SHA-256', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const fake = fakeExecutor();
  const key = newObjectKey('production/recovery-test/');
  const result = await uploadAndVerifyCiphertext({ ...config, key, sourcePath, tempRoot: objectsDir,
    env: hostEnv, platform: 'linux', executor: (call) => fake.execute(call) });
  assert.equal(result.size, ageBytes.length);
  assert.equal(result.sha256, createHash('sha256').update(ageBytes).digest('hex'));
  assert.equal(result.byteVerified, true);
  assert.deepEqual(fake.calls.map((call) => call.args[1]), ['put-object', 'get-object']);
  assert.ok(fake.calls.every((call) => call.args.includes('--endpoint-url') && call.args.includes(storageTarget(config).endpoint)));
  assert.equal(fake.calls[0].env.AWS_SECRET_ACCESS_KEY, hostEnv.AWS_SECRET_ACCESS_KEY);
  assert.equal(fake.calls[0].env.AWS_CONFIG_FILE, '/dev/null');
  assert.equal(fake.calls[0].env.AWS_ENDPOINT_URL, undefined);
  assert.equal((await readFile(sourcePath)).toString(), ageBytes.toString());
});

test('local, self-hosted and non-Linux invocations reject before executor side effects', async () => {
  let calls = 0;
  const options = { ...config, key: newObjectKey('production/recovery-test/'), sourcePath: 'unused.age', executor: async () => { calls += 1; } };
  for (const [env, platform] of [
    [{}, 'linux'],
    [{ ...hostEnv, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux'],
    [hostEnv, 'win32'],
  ]) await assert.rejects(uploadAndVerifyCiphertext({ ...options, env, platform }));
  assert.equal(calls, 0);
});

test('missing inherited static credentials reject before executor side effects', async () => {
  let calls = 0;
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key: newObjectKey('production/recovery-test/'), sourcePath,
    env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', PATH: '/bin' }, platform: 'linux',
    executor: async () => { calls += 1; } }), /static credentials/);
  assert.equal(calls, 0);
});

test('upload rejects non-age, missing, and unsafe target inputs before transport', async () => {
  let calls = 0;
  const executor = async () => { calls += 1; return { code: 0 }; };
  const key = newObjectKey('production/recovery-test/');
  const path = join(objectsDir, 'plain.dump');
  await writeFile(path, 'synthetic plaintext');
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key, sourcePath: path, env: hostEnv, platform: 'linux', executor }), /\.age/);
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, prefix: 'production/other', key, sourcePath: path, env: hostEnv, platform: 'linux', executor }));
  assert.equal(calls, 0);
});

test('upload rejects symlink source and keys outside the generated grammar', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  const linkPath = join(objectsDir, 'linked.age');
  await writeFile(sourcePath, ageBytes);
  await symlink(sourcePath, linkPath);
  let calls = 0;
  const executor = async () => { calls += 1; return { code: 0 }; };
  const validKey = newObjectKey('production/recovery-test/');
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key: validKey, sourcePath: linkPath, env: hostEnv,
    platform: 'linux', executor }), /non-symlink/);
  for (const key of [
    `${validKey} `,
    validKey.replace('.age', '/nested.age'),
    validKey.replace('.age', '\n.age'),
    validKey.replace(/\/[a-f0-9-]+\.age$/i, '/00000000-0000-4000-0000-000000000000.age'),
  ]) await assert.rejects(uploadAndVerifyCiphertext({ ...config, key, sourcePath, env: hostEnv, platform: 'linux', executor }));
  assert.equal(calls, 0);
});

test('upload suppresses executor details and cleans its temporary readback after errors', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const key = newObjectKey('production/recovery-test/');
  const failing = fakeExecutor({ failAt: 'get-object' });
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key, sourcePath, tempRoot: objectsDir, env: hostEnv,
    platform: 'linux', executor: (call) => failing.execute(call) }), (error) => {
    assert.doesNotMatch(error.message, /sensitive provider diagnostic/);
    return /readback failed/.test(error.message);
  });
  const names = await import('node:fs/promises').then(({ readdir }) => readdir(objectsDir));
  assert.ok(names.includes('capture.age'));
  assert.deepEqual(names.filter((name) => name.startsWith('al-r2-ciphertext-')), []);
});

test('upload detects corrupted readback and cleans temporary ciphertext', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const fake = fakeExecutor({ corruptReadback: true });
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key: newObjectKey('production/recovery-test/'), sourcePath,
    tempRoot: objectsDir, env: hostEnv, platform: 'linux', executor: (call) => fake.execute(call) }), /verification mismatch/);
  const names = await import('node:fs/promises').then(({ readdir }) => readdir(objectsDir));
  assert.deepEqual(names.sort(), ['capture.age', `${fake.calls[0].args[fake.calls[0].args.indexOf('--key') + 1].replaceAll('/', '_')}`]);
});

test('duplicate immutable key fails conditional put without overwrite', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const fake = fakeExecutor();
  const key = newObjectKey('production/recovery-test/');
  const options = { ...config, key, sourcePath, tempRoot: objectsDir, env: hostEnv, platform: 'linux', executor: (call) => fake.execute(call) };
  await uploadAndVerifyCiphertext(options);
  await assert.rejects(uploadAndVerifyCiphertext(options), /upload failed/);
  assert.equal(fake.calls.filter((call) => call.args[1] === 'put-object').length, 2);
});

test('cleanup failure is reported and preserves the primary upload failure', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const failCleanup = async () => { throw new Error('cleanup fixture failure'); };
  const fake = fakeExecutor({ failAt: 'put-object' });
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key: newObjectKey('production/recovery-test/'), sourcePath,
    tempRoot: objectsDir, env: hostEnv, platform: 'linux', remove: failCleanup, executor: (call) => fake.execute(call) }),
  /upload failed.*Temporary ciphertext cleanup failed/);
});

test('verified upload still fails visibly when private temp cleanup fails', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const fake = fakeExecutor();
  await assert.rejects(uploadAndVerifyCiphertext({ ...config, key: newObjectKey('production/recovery-test/'), sourcePath,
    tempRoot: objectsDir, env: hostEnv, platform: 'linux', remove: async () => { throw new Error('cleanup fixture failure'); },
    executor: (call) => fake.execute(call) }), /upload verified, but temporary readback cleanup failed/);
});

test('download verifies caller-provided ciphertext digest and size', async () => {
  const sourcePath = join(objectsDir, 'capture.age');
  await writeFile(sourcePath, ageBytes);
  const fake = fakeExecutor();
  const key = newObjectKey('production/recovery-test/');
  await fake.execute({ args: ['s3api', 'put-object', '--bucket', config.bucket, '--key', key, '--body', sourcePath, '--if-none-match', '*'] });
  const result = await downloadAndVerifyCiphertext({ ...config, key, tempRoot: objectsDir, expectedSize: ageBytes.length,
    expectedSha256: createHash('sha256').update(ageBytes).digest('hex'), env: hostEnv, platform: 'linux',
    executor: (call) => fake.execute(call) });
  assert.equal(result.byteVerified, true);
  assert.deepEqual(await readFile(result.outputPath), ageBytes);
  await result.cleanup();
  assert.deepEqual((await readdir(objectsDir)).filter((name) => name.startsWith('al-r2-download-')), []);
  await assert.rejects(downloadAndVerifyCiphertext({ ...config, key, tempRoot: objectsDir, expectedSize: 1,
    expectedSha256: '0'.repeat(64), env: hostEnv, platform: 'linux', executor: (call) => fake.execute(call) }), /verification mismatch/);
  assert.deepEqual((await readdir(objectsDir)).filter((name) => name.startsWith('al-r2-download-')), []);
});

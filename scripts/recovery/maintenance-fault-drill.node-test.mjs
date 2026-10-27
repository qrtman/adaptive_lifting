import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { runMaintenanceFaultDrill, openMaintenanceFaultSession, validateNativeFixtureFiles, nativeFixtureFailureCategory, nativeFixtureRuntime } from './maintenance-fault-drill.mjs';

const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', PATH: '/usr/bin:/bin' };
const id = '11111111-1111-4111-8111-111111111111';
const name = `al-synthetic-recovery-${id}-source`;
const diagnostic = 'SYNTHETIC_PRIVATE_NATIVE_DIAGNOSTIC';
const result = stdout => ({ code: 0, signal: null, stderr: '', stdout });

test('native runtime selects only unambiguous immutable image loader and libraries', () => {
  const libc = `/nix/store/${'a'.repeat(32)}-glibc-2.42/lib/ld-linux-x86-64.so.2`;
  const gcc = `/nix/store/${'b'.repeat(32)}-gcc-15.2.0-lib/lib/libgcc_s.so.1`;
  const cpp = `/nix/store/${'b'.repeat(32)}-gcc-15.2.0-lib/lib/libstdc++.so.6.0.34`;
  const command = nativeFixtureRuntime([libc, gcc, cpp, gcc]);
  assert.equal(command[0], libc); assert.equal(command[1], '--library-path');
  assert.equal(command.at(-1), '/tmp/recovery-maintenance-fixture.js');
  assert.equal(command.includes('--allow-net'), false);
  for (const paths of [[gcc], [libc], [libc, gcc, '/tmp/libgcc_s.so.1'],
    [libc, gcc, `${gcc}/../../tmp`], [libc, gcc, `${gcc}/../../tmp/libgcc_s.so.1`],
    [libc, gcc, libc.replace('a'.repeat(32), 'c'.repeat(32))]]) {
    assert.throws(() => nativeFixtureRuntime(paths));
  }
});

test('native runtime uses the active loader and one numeric GCC family or default-profile pair', () => {
  const loader = `/nix/store/${'a'.repeat(32)}-glibc-2.42/lib/ld-linux-x86-64.so.2`;
  const other = loader.replace('glibc-2.42', 'glibc-2.40');
  const family = version => [`/nix/store/${'b'.repeat(32)}-gcc-${version}-lib/lib/libgcc_s.so.1`,
    `/nix/store/${'b'.repeat(32)}-gcc-${version}-lib/lib/libstdc++.so.6.0.34`];
  const old = family('9.5.0'); const current = family('15.2.0');
  const paths = [loader, other, ...old, ...current];
  const selected = nativeFixtureRuntime(paths, { activeLoader: loader });
  assert.equal(selected[0], loader); assert.match(selected[2], /gcc-15\.2\.0/); assert.doesNotMatch(selected[2], /gcc-9\.5\.0/);
  const profile = nativeFixtureRuntime(paths, { activeLoader: loader, profileGcc: old[0], profileCpp: old[1] });
  assert.match(profile[2], /gcc-9\.5\.0/); assert.doesNotMatch(profile[2], /gcc-15\.2\.0/);
  assert.throws(() => nativeFixtureRuntime(paths, { activeLoader: loader, profileGcc: old[0], profileCpp: current[1] }));
  const automatic = nativeFixtureRuntime(paths);
  assert.equal(automatic[0], loader);
  assert.equal(nativeFixtureRuntime([loader.replace('glibc-2.42', 'glibc-2.9'), loader, ...current])[0], loader);
  const revision = loader.replace('glibc-2.42', 'glibc-2.40-218');
  const bootstrap = current[0].replace('-gcc-', '-xgcc-').replace('-lib/lib/', '-libgcc/lib/');
  const installed = nativeFixtureRuntime([revision, revision.replace('-218/', '-66/'), ...current, bootstrap]);
  assert.equal(installed[0], revision);
  assert.doesNotMatch(installed[2], /xgcc/);
});

test('native fixture diagnostics expose only hardcoded classes, never native content', () => {
  for (const [stderr, expected] of [['GLIBC_2.38 not found', 'runtime-dependency'],
    ['NotCapable: Requires env access', 'runtime-permission'], ['WARNING: synthetic', 'runtime-warning'],
    [diagnostic, 'runtime-failure']]) assert.equal(nativeFixtureFailureCategory(stderr), expected);
});

test('native fixture execution accepts only its owned private regular executable in runner temp', async () => {
  const nativeEnv = { RUNNER_TEMP: '/runner/temp', MAINTENANCE_NATIVE_FIXTURE_DIR: '/runner/temp/al-native-fixture-Ab12Cd34' };
  const metadata = { uid: 1001, mode: 0o700, size: 123, isFile: () => true,
    isDirectory: () => true, isSymbolicLink: () => false };
  const settings = { env: nativeEnv, stat: async path => ({ ...metadata,
    mode: path.endsWith('/gate-fixture') ? 0o755 : path.endsWith('.js') ? 0o600 : 0o700 }), canonicalPath: async path => path, uid: 1001 };
  assert.deepEqual(await validateNativeFixtureFiles(settings), {
    binaryPath: '/runner/temp/al-native-fixture-Ab12Cd34/gate-fixture',
    scriptPath: '/runner/temp/al-native-fixture-Ab12Cd34/gate-fixture.js',
  });
  for (const changed of [
    { env: { ...nativeEnv, MAINTENANCE_NATIVE_FIXTURE_DIR: '/foreign/al-native-fixture-Ab12Cd34' } },
    { env: { ...nativeEnv, MAINTENANCE_NATIVE_FIXTURE_DIR: '/runner/temp/../temp/al-native-fixture-Ab12Cd34' } },
    { canonicalPath: async () => '/foreign' },
    { stat: async () => ({ ...metadata, isSymbolicLink: () => true }) },
    { stat: async () => ({ ...metadata, uid: 1002 }) },
    { stat: async () => ({ ...metadata, mode: 0o777 }) },
    { stat: async () => ({ ...metadata, size: 301 * 1024 * 1024 }) },
  ]) await assert.rejects(validateNativeFixtureFiles({ ...settings, ...changed }));
});

test('fault drill rejects local execution and inherited production credentials before invoking tools', async () => {
  for (const changed of [{ env: {} }, { platform: 'win32' },
    { env: { ...env, PGHOST: 'production' } }, { env: { ...env, AWS_ACCESS_KEY_ID: 'private' } },
    { env: { ...env, RECOVERY_DB_PASSWORD: 'private' } }, { id: '../foreign' }]) {
    let calls = 0;
    await assert.rejects(runMaintenanceFaultDrill({ env, platform: 'linux', id,
      run: async () => { calls += 1; }, ...changed }));
    assert.equal(calls, 0);
  }
});

test('lost create response still removes only the owned container and verifies absence', async () => {
  const calls = []; let present = true;
  await assert.rejects(runMaintenanceFaultDrill({ env, platform: 'linux', id,
    run: async (binary, args, options) => {
      calls.push(args);
      assert.equal(binary, 'docker');
      assert.deepEqual(options.env, { PATH: env.PATH, LANG: 'C', LC_ALL: 'C' });
      if (args[0] === 'run') throw new Error(diagnostic);
      if (args[0] === 'ps') return result(present ? 'synthetic-id\n' : '');
      if (args[0] === 'inspect') return result(JSON.stringify([{ Name: `/${name}`,
        Config: { Labels: { 'adaptive-lifting.synthetic-recovery': 'true',
          'adaptive-lifting.synthetic-recovery-run': id } } }]));
      if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '-f', name]); present = false; return result(''); }
      assert.fail('unexpected tool');
    } }), error => {
    assert.equal(error.evidence.cleanup, 'PASS'); assert.equal(error.evidence.captureAllowed, false);
    assert.doesNotMatch(error.message, new RegExp(diagnostic)); return true;
  });
  assert.deepEqual(calls.map(args => args[0]), ['run', 'ps', 'inspect', 'rm', 'ps']);
});

test('cleanup rejects a foreign run label without deleting its container', async () => {
  let deleted = false;
  await assert.rejects(runMaintenanceFaultDrill({ env, platform: 'linux', id,
    run: async (_binary, args) => {
      if (args[0] === 'run') throw new Error(diagnostic);
      if (args[0] === 'ps') return result('foreign-container');
      if (args[0] === 'inspect') return result(JSON.stringify([{ Name: `/${name}`,
        Config: { Labels: { 'adaptive-lifting.synthetic-recovery': 'true',
          'adaptive-lifting.synthetic-recovery-run': 'different-owner' } } }]));
      if (args[0] === 'rm') deleted = true;
      return result('');
    } }), error => error.evidence.cleanup === 'FAIL');
  assert.equal(deleted, false);
});

test('failed independent cleanup remains a failure with no production approval', async () => {
  await assert.rejects(runMaintenanceFaultDrill({ env, platform: 'linux', id,
    run: async () => { throw new Error(diagnostic); } }), error => {
    assert.deepEqual(error.evidence, { status: 'failed', failedStage: 'container-create', cleanup: 'FAIL', captureAllowed: false });
    assert.doesNotMatch(error.message, new RegExp(diagnostic)); return true;
  });
});

test('intentional backend death accepts only confirmed nonzero process exit', async () => {
  for (const code of ['EXIT', 'TIMEOUT', 'CLOSURE_UNCONFIRMED', 'STREAM', 'ABORTED', 'SIGNAL', null]) {
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
    const closed = code ? Promise.reject(Object.assign(new Error(diagnostic), { code })) : Promise.resolve({ code: 0, signal: null });
    void closed.catch(() => {});
    const session = openMaintenanceFaultSession({ name, role: 'postgres', env, start: () => ({
      child: { stdin, stdout, stderr }, closed, abort: async () => {} }) });
    try {
      if (code === 'EXIT') await session.close({ terminated: true });
      else await assert.rejects(session.close({ terminated: true }), error => !error.message.includes(diagnostic));
    } finally { stdin.destroy(); stdout.destroy(); stderr.destroy(); }
  }
});

test('unexpected process failure cannot pass ordinary session cleanup', async () => {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  const closed = Promise.reject(Object.assign(new Error(diagnostic), { code: 'EXIT' }));
  void closed.catch(() => {});
  const session = openMaintenanceFaultSession({ name, role: 'postgres', env, start: () => ({
    child: { stdin, stdout, stderr }, closed, abort: async () => {} }) });
  try { await assert.rejects(session.close()); }
  finally { stdin.destroy(); stdout.destroy(); stderr.destroy(); }
});

test('a process that closes stdout without its query marker cannot produce a successful observation', async () => {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  const session = openMaintenanceFaultSession({ name, role: 'postgres', env, start: () => ({
    child: { stdin, stdout, stderr }, closed: Promise.resolve(), abort: async () => {} }) });
  stdout.end('partial-result\n');
  try { await assert.rejects(session.query('SELECT 1;')); }
  finally { await session.close(); stdin.destroy(); stderr.destroy(); }
});


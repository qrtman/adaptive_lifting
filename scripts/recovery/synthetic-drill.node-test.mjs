import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  assertHostedRunnerEnvironment,
  assertCleanupOwnedInspect,
  assertIsolatedInspect,
  attemptAllCleanups,
  cleanupArgs,
  commandPlan,
  catalogProbeSql,
  combineRunErrors,
  containerNames,
  dockerRunArgs,
  IMAGE,
  pipeAndCheck,
  safeContainerSummary,
  runDrill,
} from './synthetic-drill.mjs';

const image = IMAGE;

test('hosted-runner guard rejects local and non-GitHub environments', () => {
  assert.doesNotThrow(() => assertHostedRunnerEnvironment({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, 'linux'));
  for (const [env, platform] of [
    [{ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux'],
    [{ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, 'win32'],
    [{ GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'github-hosted' }, 'linux'],
    [{}, 'linux'],
  ]) assert.throws(() => assertHostedRunnerEnvironment(env, platform), /restricted to a GitHub hosted Linux runner/);
});

test('local drill entrypoint rejects before checking tools or creating files', async () => {
  await assert.rejects(runDrill(), /restricted to a GitHub hosted Linux runner/);
});

test('synthetic drill pins the approved PostgreSQL image digest', () => {
  assert.equal(IMAGE, 'supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00');
  assert.ok(dockerRunArgs(containerNames('pin-test').source, IMAGE).includes(IMAGE));
  assert.throws(() => dockerRunArgs(containerNames('pin-test').source, 'supabase/postgres:latest'), /pinned/);
});

test('container plans use unique names, tmpfs, no network, ports, or host mounts', () => {
  const names = containerNames('ab12-34');
  assert.deepEqual(names, {
    source: 'al-synthetic-recovery-ab12-34-source',
    restore: 'al-synthetic-recovery-ab12-34-restore',
  });
  const args = dockerRunArgs(names.source, image);
  assert.ok(args.includes('--network') && args[args.indexOf('--network') + 1] === 'none');
  assert.ok(args.includes('--user') && args[args.indexOf('--user') + 1] === 'postgres');
  assert.ok(args.some((arg) => arg.startsWith('/tmp:rw,exec,nosuid,nodev')));
  assert.ok(args.some((arg) => arg.startsWith('/var/lib/postgresql/data:rw,nosuid,nodev')));
  assert.ok(args.includes('--read-only'));
  assert.ok(!args.includes('-p') && !args.includes('--publish') && !args.includes('-v') && !args.includes('--volume'));
  assert.throws(() => dockerRunArgs('unsafe', image), /Unsafe/);
  assert.throws(() => containerNames('../x'), /Invalid/);
});

test('inspect accepts Docker tmpfs metadata with or without Mounts entries', () => {
  const name = 'al-synthetic-recovery-abcd-source';
  const good = {
    Name: `/${name}`,
    Config: { User: 'postgres', Labels: { 'adaptive-lifting.synthetic-recovery': 'true', 'adaptive-lifting.synthetic-recovery-run': 'abcd' } },
    HostConfig: { NetworkMode: 'none', PortBindings: {}, ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,exec', '/var/lib/postgresql/data': 'rw' } },
    NetworkSettings: { Ports: {} },
    Mounts: [{ Type: 'tmpfs', Destination: '/tmp' }, { Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }],
  };
  assert.equal(assertIsolatedInspect(good, name), true);
  const hostConfigOnly = structuredClone(good);
  hostConfigOnly.Mounts = [];
  assert.equal(assertIsolatedInspect(hostConfigOnly, name), true);
});

test('inspect invariant rejects altered network, ports, mounts, user, and writable rootfs', () => {
  const name = 'al-synthetic-recovery-abcd-source';
  const good = {
    Name: `/${name}`,
    Config: { User: 'postgres', Labels: { 'adaptive-lifting.synthetic-recovery': 'true', 'adaptive-lifting.synthetic-recovery-run': 'abcd' } },
    HostConfig: { NetworkMode: 'none', PortBindings: {}, ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,exec', '/var/lib/postgresql/data': 'rw' } },
    NetworkSettings: { Ports: {} },
    Mounts: [{ Type: 'tmpfs', Destination: '/tmp' }, { Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }],
  };
  for (const mutate of [
    (item) => { item.HostConfig.NetworkMode = 'bridge'; },
    (item) => { item.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5432' }] }; },
    (item) => { item.Mounts.push({ Type: 'bind', Destination: '/host' }); },
    (item) => { item.Mounts.push({ Type: 'volume', Destination: '/tmp' }); },
    (item) => { item.Mounts.push({ Type: 'tmpfs', Destination: '/unexpected' }); },
    (item) => { item.Config.User = 'root'; },
    (item) => { item.HostConfig.ReadonlyRootfs = false; },
    (item) => { item.HostConfig.Tmpfs['/unexpected'] = 'rw'; },
    (item) => { item.HostConfig.Binds = ['/host:/host']; },
  ]) {
    const item = structuredClone(good);
    mutate(item);
    assert.throws(() => assertIsolatedInspect(item, name));
  }
});

test('cleanup ownership remains checkable when isolation fails and rejects foreign labels', () => {
  const name = 'al-synthetic-recovery-abcd-source';
  const item = {
    Name: `/${name}`,
    Config: { User: 'postgres', Labels: { 'adaptive-lifting.synthetic-recovery': 'true', 'adaptive-lifting.synthetic-recovery-run': 'abcd' } },
    HostConfig: { NetworkMode: 'bridge', PortBindings: {}, ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw', '/var/lib/postgresql/data': 'rw' } },
    NetworkSettings: { Ports: {} },
    Mounts: [],
  };
  assert.equal(assertCleanupOwnedInspect(item, name), true);
  assert.throws(() => assertIsolatedInspect(item, name), /network isolation/);
  item.Config.Labels['adaptive-lifting.synthetic-recovery-run'] = 'different-run';
  assert.throws(() => assertCleanupOwnedInspect(item, name), /ownership/);
});

test('safe inspect summary exposes only static isolation metadata', () => {
  const summary = safeContainerSummary({
    Name: '/container',
    Config: { User: 'postgres', Env: ['SECRET=do-not-copy'], Cmd: ['sensitive-command'] },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, PortBindings: {}, Tmpfs: { '/tmp': 'rw' } },
    NetworkSettings: { Ports: {} },
    Mounts: [{ Type: 'tmpfs', Destination: '/tmp', Source: '/private-path' }],
  });
  const serialized = JSON.stringify(summary);
  assert.match(serialized, /"networkMode":"none"/);
  assert.match(serialized, /"destination":"\/tmp"/);
  assert.doesNotMatch(serialized, /SECRET|sensitive-command|private-path/);
});

test('cleanup attempts all owned names and preserves primary and cleanup failures', async () => {
  const attempts = [];
  await assert.rejects(attemptAllCleanups(['first', 'second'], async (name) => {
    attempts.push(name);
    if (name === 'first') throw new Error('first cleanup failed');
  }), /first cleanup failed/);
  assert.deepEqual(attempts, ['first', 'second']);

  const original = new Error('restore stage failed');
  const cleanup = new Error('source container cleanup failed');
  const combined = combineRunErrors('restore fixture', original, [cleanup]);
  assert.ok(combined instanceof AggregateError);
  assert.equal(combined.errors[0].cause, original);
  assert.match(combined.message, /restore fixture: restore stage failed/);
  assert.match(combined.message, /source container cleanup failed/);
});

test('command plan streams custom dump through age and restores in one transaction', () => {
  const names = containerNames('feedcafe');
  const plan = commandPlan(image, names, '/runner/temp/backup.age', 'age1recipient');
  assert.deepEqual(plan.dump.slice(-2), ['--format=custom', '--schema=synthetic_recovery']);
  assert.deepEqual(plan.encrypt.slice(0, 2), ['age', '-r']);
  assert.ok(plan.restoreCommand.includes('--single-transaction'));
  assert.ok(plan.restoreCommand.includes('--exit-on-error'));
  assert.ok(!plan.restoreCommand.includes('--clean') && !plan.restoreCommand.includes('--create'));
  assert.deepEqual(cleanupArgs([names.source, names.restore]), ['rm', '-f', names.source, names.restore]);
});

test('catalog probe prepares the shared parameterized query and rejects injected identifiers', () => {
  const sql = catalogProbeSql();
  assert.match(sql, /^PREPARE recovery_catalog\(text,text\) AS SELECT/);
  assert.match(sql, /pg_get_constraintdef/);
  assert.match(sql, /pg_policy/);
  assert.match(sql, /recovery_catalog\('synthetic_recovery','workouts'\)/);
  assert.throws(() => catalogProbeSql('synthetic_recovery; DROP SCHEMA public', 'workouts'), /Unsafe synthetic catalog target/);
});

test('pipeline rejects a failed subprocess and terminates both stages', async () => {
  const sourceOut = new PassThrough();
  const ageIn = new PassThrough();
  const killed = [];
  sourceOut.end(Buffer.from([0, 1, 2, 255]));
  const sourceError = new Error('source failed');
  await assert.rejects(pipeAndCheck(
    { child: { stdout: sourceOut, kill: () => killed.push('source') }, closed: Promise.reject(sourceError) },
    { child: { stdin: ageIn, kill: () => killed.push('age') }, closed: Promise.resolve() },
  ), /source failed/);
  assert.deepEqual(killed.sort(), ['age', 'source']);
});

test('pipeline preserves arbitrary binary bytes and rejects a failed destination', async () => {
  const payload = Buffer.from([0, 255, 1, 128, 10, 0]);
  const sourceOut = new PassThrough();
  const ageIn = new PassThrough();
  const received = [];
  ageIn.on('data', (chunk) => received.push(chunk));
  sourceOut.end(payload);
  await pipeAndCheck(
    { child: { stdout: sourceOut, kill() {} }, closed: Promise.resolve() },
    { child: { stdin: ageIn, kill() {} }, closed: Promise.resolve() },
  );
  assert.deepEqual(Buffer.concat(received), payload);

  const nextSource = new PassThrough();
  const nextDestination = new PassThrough();
  const killed = [];
  nextSource.end(Buffer.from([3, 0, 4]));
  await assert.rejects(pipeAndCheck(
    { child: { stdout: nextSource, kill: () => killed.push('source') }, closed: Promise.resolve() },
    { child: { stdin: nextDestination, kill: () => killed.push('destination') }, closed: Promise.reject(new Error('restore failed')) },
  ), /restore failed/);
  assert.deepEqual(killed.sort(), ['destination', 'source']);
});

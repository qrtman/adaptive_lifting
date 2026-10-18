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
  REQUIRED_CHECKS,
  finalizeEvidence,
  expectedSyntheticToc,
  EXPECTED_RELATIONS,
  reconcileRestoredEvidence,
  archiveTocResult,
} from './synthetic-drill.mjs';
import { collectSyntheticArchiveToc } from './catalog-evidence.mjs';
import { parseArchiveToc, reconcileArchiveToc } from './production-source.mjs';

const image = IMAGE;

test('reviewed ACL entries match PostgreSQL 17 namespace and type-prefixed tag formatting', () => {
  // pg_dump.c dumpACL supplies namespace separately and tags each ACL with
  // type + name. The schema object itself has no namespace.
  const parsed = parseArchiveToc('1; 0 0 ACL - SCHEMA synthetic_recovery postgres\n' +
    '2; 0 0 ACL synthetic_recovery TABLE workouts postgres\n');
  const expected = expectedSyntheticToc().filter((entry) => entry.description === 'ACL' &&
    (entry.tag === 'SCHEMA synthetic_recovery' || entry.tag === 'TABLE workouts'));
  assert.deepEqual(parsed, expected);
});

test('validated inline fixture CHECKs stay in TABLE definitions and unexpected separate entries fail', () => {
  // PostgreSQL 17 emits CHECK CONSTRAINT entries only when a CHECK must be
  // separate; this fixture uses validated inline CHECKs without dependency cycles.
  assert.ok(!expectedSyntheticToc().some((entry) => entry.description === 'CHECK CONSTRAINT'));
  assert.throws(() => reconcileArchiveToc({
    expectedEntries: [{ description: 'TABLE', schema: 'synthetic_recovery', tag: 'workouts', owner: 'postgres' }],
    tocText: '1; 1259 123 TABLE synthetic_recovery workouts postgres\n' +
      '2; 2606 124 CHECK CONSTRAINT synthetic_recovery workouts workouts_load_kg_check postgres\n',
  }), /unexpected=1/);
});

test('injected TOC runner preserves exact exit evidence and rejects any stderr or signal', async () => {
  const calls = [];
  const result = await collectSyntheticArchiveToc({ archivePath: '-', run: async (binary, args) => {
    calls.push([binary, ...args]);
    return archiveTocResult({ stdout: args[0] === '--version' ? 'pg_restore (PostgreSQL) 17.6\n' :
      '1; 2615 123 SCHEMA - synthetic_recovery postgres\n', stderrBytes: 0, code: 0, signal: null });
  } });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(calls, [['pg_restore', '--version'], ['pg_restore', '--list', '-']]);
  for (const override of [{ stderrBytes: 1 }, { code: 1 }, { code: null }, { signal: 'SIGTERM' }, { signal: undefined }]) {
    assert.throws(() => archiveTocResult({ stdout: 'sensitive', stderrBytes: 0, code: 0, signal: null, ...override }),
      { message: 'Synthetic archive listing command failed or produced diagnostics.' });
  }
});

test('integrated restored evidence rejects missing rows, ledger, catalog, sequence and changed values', () => {
  const manifest = { migrations: ['20260102030405'], tables: EXPECTED_RELATIONS.map((table) => ({ table, count: 1, sha256: 'a'.repeat(64) })) };
  const records = [{ kind: 'TABLE', schema: 'synthetic_recovery', identity: 'workouts', definitionSha256: 'a'.repeat(64) }];
  const snapshot = { sequence: { last_value: 25, is_called: true }, workouts: [{ id: 12, load_kg: 60 }] };
  const input = { sourceManifest: manifest, restoredManifest: structuredClone(manifest), sourceRecords: records,
    restoredRecords: structuredClone(records), sourceSnapshot: snapshot, restoredSnapshot: structuredClone(snapshot) };
  assert.deepEqual(reconcileRestoredEvidence(input), { rows: true, migrations: true, catalog: true, sequences: true });
  for (const mutate of [
    (value) => { value.restoredManifest = undefined; },
    (value) => { value.restoredManifest.tables.pop(); },
    (value) => { value.restoredManifest.tables[0].count++; },
    (value) => { value.restoredManifest.tables[0].sha256 = 'b'.repeat(64); },
    (value) => { value.restoredManifest.migrations = []; },
    (value) => { value.restoredRecords = []; },
    (value) => { value.restoredRecords[0].definitionSha256 = 'b'.repeat(64); },
    (value) => { value.restoredSnapshot.sequence.last_value = 12; },
    (value) => { value.restoredSnapshot.workouts[0].load_kg = 61; },
  ]) {
    const changed = structuredClone(input); mutate(changed);
    assert.throws(() => reconcileRestoredEvidence(changed));
  }
});

test('one sanitized envelope requires every integrated assertion and cleanup before verified', () => {
  const complete = Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, true]));
  const input = { id: 'synthetic-test', startedAt: '2026-01-01T00:00:00Z', now: '2026-01-01T00:01:00Z' };
  assert.equal(finalizeEvidence({ ...input, checks: complete }).lifecycle, 'verified');
  for (const key of REQUIRED_CHECKS) {
    for (const value of [false, undefined, 'PASS', 1]) {
      const result = finalizeEvidence({ ...input, checks: { ...complete, [key]: value } });
      assert.equal(result.status, 'FAIL', key);
      assert.equal(result.lifecycle, 'failed', key);
    }
  }
  for (const reason of ['mismatch', 'unauthenticated', 'timeout', 'SIGTERM', 'cleanup failure']) {
    const result = finalizeEvidence({ ...input, checks: complete, failed: true });
    assert.equal(result.lifecycle, 'failed', reason);
    assert.equal(result.productionRecovery, 'NOT TESTED');
    assert.equal(result.offsiteRetrieval, 'NOT TESTED');
  }
});

test('reviewed fixture inventories include ledger, all data, sequences, policies and ACLs independently', () => {
  const entries = expectedSyntheticToc();
  for (const table of EXPECTED_RELATIONS) assert.ok(entries.some((entry) => entry.description === 'TABLE DATA' && entry.tag === table));
  for (const description of ['SEQUENCE SET', 'ROW SECURITY', 'POLICY', 'TRIGGER', 'DEFAULT ACL', 'ACL']) {
    assert.ok(entries.some((entry) => entry.description === description));
  }
  assert.equal(entries.filter((entry) => entry.description === 'TABLE').length, 6);
  assert.equal(entries.filter((entry) => entry.description === 'TABLE DATA').length, 6);
});

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
  await assert.rejects(runDrill({ env: {}, platform: 'win32' }), /restricted to a GitHub hosted Linux runner/);
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
  assert.match(sql, /^PREPARE recovery_catalog\(text,text\) AS\s+SELECT/);
  assert.match(sql, /pg_get_constraintdef/);
  assert.match(sql, /pg_policy/);
  assert.match(sql, /EXECUTE recovery_catalog\('synthetic_recovery','workouts'\)/);
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

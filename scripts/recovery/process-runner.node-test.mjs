import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runCommand, startCommand } from './process-runner.mjs';

function fakeProcess(onKill = () => {}) {
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); onKill(signal, child); return true; };
  child.finish = (code = 0, signal = null) => {
    child.emit('exit', code, signal);
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    child.emit('close', code, signal);
  };
  return child;
}

const bounded = { timeoutMs: 30, killGraceMs: 10 };
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code);
  assert.equal(error.name, 'ProcessCommandError');
  return true;
});

test('capture returns output after a successful real child closes', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write("ok");process.stderr.write("note")})'], { timeoutMs: 2_000, input: 'input' });
  assert.equal(result.stdout, 'ok');
  assert.equal(result.stderr, 'note');
  assert.equal(result.code, 0);
});

test('timeout escalates an unresponsive child and confirms closure', async () => {
  const child = fakeProcess((signal, current) => {
    if (signal === 'SIGKILL') queueMicrotask(() => current.finish(null, 'SIGKILL'));
  });
  const handle = startCommand('private/path', ['secret-argument'], { ...bounded, spawnImpl: () => child });
  await assert.rejects(handle.closed, (error) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.doesNotMatch(String(error) + JSON.stringify(error), /private|secret/);
    return true;
  });
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(child.stdout.closed, true);
  assert.equal(child.stderr.closed, true);
});

test('exit is insufficient until both output streams close', async () => {
  const child = fakeProcess();
  const handle = startCommand('fake', [], { timeoutMs: 1_000, spawnImpl: () => child });
  let settled = false;
  handle.closed.then(() => { settled = true; });
  child.emit('exit', 0, null);
  child.stdout.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  child.stderr.destroy();
  assert.deepEqual(await handle.closed, { code: 0, signal: null });
});

test('abort waits for termination and never accepts a zero exit', async () => {
  const child = fakeProcess((_signal, current) => queueMicrotask(() => current.finish(0)));
  const handle = startCommand('fake', [], { ...bounded, spawnImpl: () => child });
  await rejectsCode(handle.abort(new Error('private-reason')), 'ABORTED');
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('synchronous termination clears escalation before returning', async () => {
  const child = fakeProcess((_signal, current) => current.finish(0));
  const handle = startCommand('fake', [], { ...bounded, spawnImpl: () => child });
  await rejectsCode(handle.abort(), 'ABORTED');
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('AbortSignal stops a running child and pre-aborted signals never spawn', async () => {
  const controller = new AbortController();
  const child = fakeProcess((_signal, current) => queueMicrotask(() => current.finish(0)));
  const handle = startCommand('fake', [], { ...bounded, signal: controller.signal, spawnImpl: () => child });
  controller.abort('private-reason');
  await rejectsCode(handle.closed, 'ABORTED');
  let spawned = false;
  const skipped = startCommand('fake', [], { signal: controller.signal, spawnImpl: () => { spawned = true; } });
  await rejectsCode(skipped.closed, 'ABORTED');
  assert.equal(spawned, false);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`parent ${signal} interrupts child and removes handlers`, async () => {
    const signalSource = new EventEmitter();
    const child = fakeProcess((_signal, current) => queueMicrotask(() => current.finish(0)));
    const handle = startCommand('fake', [], { ...bounded, spawnImpl: () => child, handleSignals: true, signalSource });
    signalSource.emit(signal);
    await rejectsCode(handle.closed, 'INTERRUPTED');
    assert.equal(signalSource.listenerCount('SIGINT'), 0);
    assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  });
}

test('unconfirmed kill and inherited open pipes fail within the final bound', async () => {
  const child = fakeProcess();
  const handle = startCommand('fake', [], { ...bounded, spawnImpl: () => child });
  await rejectsCode(handle.closed, 'CLOSURE_UNCONFIRMED');
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(child.stdout.destroyed, true);
});

test('nonzero and signal exits fail closed with redacted diagnostics', async () => {
  for (const [code, signal, expected] of [[4, null, 'EXIT'], [null, 'SIGTERM', 'SIGNAL']]) {
    const child = fakeProcess();
    const promise = runCommand('/private/binary', ['secret-argument'], {
      timeoutMs: 1_000, env: { PRIVATE: 'secret-env' }, spawnImpl: () => child,
    });
    child.stderr.write('secret-stderr');
    child.finish(code, signal);
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(String(error) + JSON.stringify(error), /private|secret/);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('synchronous and asynchronous spawn failures are sanitized', async () => {
  await rejectsCode(startCommand('secret', [], { spawnImpl: () => { throw new Error('/private/secret'); } }).closed, 'SPAWN');
  const child = fakeProcess();
  child.pid = undefined;
  const handle = startCommand('fake', [], { ...bounded, spawnImpl: () => child });
  child.emit('error', new Error('/private/secret'));
  child.stdout.destroy();
  child.stderr.destroy();
  await rejectsCode(handle.closed, 'SPAWN');
});

test('combined output limit stops a child without publishing captured output', async () => {
  const child = fakeProcess((_signal, current) => queueMicrotask(() => current.finish(0)));
  const promise = runCommand('fake', [], { ...bounded, spawnImpl: () => child, maxBufferBytes: 3 });
  child.stdout.write('123');
  child.stderr.write('secret');
  await rejectsCode(promise, 'OUTPUT_LIMIT');
});

test('timeouts and grace periods cannot disable or exceed the hard limits', () => {
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 600_001 }, { killGraceMs: 0 }, { killGraceMs: 10_001 }]) {
    assert.throws(() => startCommand('fake', [], options), { code: 'INVALID_OPTIONS' });
  }
});

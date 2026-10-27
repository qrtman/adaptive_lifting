import test from 'node:test';
import assert from 'node:assert/strict';
import { withExclusiveMaintenance } from './exclusive-maintenance.mjs';

function fixture(mode) {
  const calls = []; let closed = false;
  const client = { identity: { database: 'postgres', version: '170011', tls: true },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SET ')) return { rows: [] };
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ pid: 42, acquired: mode !== 'busy' }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pid: mode === 'pid-change' ? 43 : 42, released: mode !== 'unlock-loss' }] };
      if (mode === 'owner-loss') throw Error('private-native-detail');
      return { rows: [{ pid: 42, held: true }] };
    },
    async close() { closed = true; if (mode === 'close-failure') throw Error('private-close-detail'); },
  };
  return { client, calls, closed: () => closed };
}
const limits = { acquireTimeoutMs: 10, workTimeoutMs: 100, heartbeatMs: 10, queryTimeoutMs: 10, closeTimeoutMs: 10 };

test('exclusive scope checks ownership before and after capture and closes its owned session', async () => {
  const f = fixture();
  const result = await withExclusiveMaintenance({ ...limits, client: f.client, capture: async ({ signal, assertOwnership }) => {
    assert.equal(signal.aborted, false); await assertOwnership(); return 'synthetic';
  } });
  assert.equal(result.result, 'synthetic'); assert.equal(result.evidence.cleanup, 'PASS');
  assert.equal(result.evidence.scope, 'participating-application-writers'); assert.equal(f.closed(), true);
  assert.ok(f.calls.at(-1).includes('pg_advisory_unlock'));
  assert.ok(f.calls.every(sql => !/ALTER|cron\./i.test(sql)));
});

test('busy or lost ownership prevents capture and still closes source', async () => {
  for (const mode of ['busy', 'owner-loss']) {
    const f = fixture(mode); let invoked = false;
    await assert.rejects(withExclusiveMaintenance({ ...limits, client: f.client, capture: async () => { invoked = true; } }));
    assert.equal(invoked, false); assert.equal(f.closed(), true);
  }
});

test('backend replacement, unknown unlock or failed close cannot produce a success receipt', async () => {
  for (const mode of ['pid-change', 'unlock-loss', 'close-failure']) {
    const f = fixture(mode);
    await assert.rejects(withExclusiveMaintenance({ ...limits, client: f.client, capture: async () => 'invalid' }), error => {
      assert.equal(error.evidence.cleanup, 'FAIL'); assert.doesNotMatch(error.message, /private-/); return true;
    });
    assert.equal(f.closed(), true);
  }
});

test('failure, caller cancellation and ignored capture deadline close the source without success', async () => {
  for (const mode of ['throw', 'abort', 'hang']) {
    const f = fixture(); const controller = new AbortController(); let captureSignal;
    await assert.rejects(withExclusiveMaintenance({ ...limits, workTimeoutMs: 20, client: f.client, signal: controller.signal,
      capture: async ({ signal }) => {
        captureSignal = signal;
        if (mode === 'throw') throw Error('private-capture-detail');
        if (mode === 'abort') controller.abort();
        return await new Promise(() => {});
      } }));
    assert.equal(f.closed(), true);
    if (mode !== 'throw') assert.equal(captureSignal.aborted, true);
  }
});

test('hung queries and hung close have independent deadlines', async () => {
  for (const mode of ['query', 'close']) {
    const f = fixture();
    if (mode === 'query') f.client.query = () => new Promise(() => {});
    else f.client.close = () => new Promise(() => {});
    await assert.rejects(withExclusiveMaintenance({ ...limits, client: f.client, capture: async () => undefined }));
    if (mode === 'query') assert.equal(f.closed(), true);
  }
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { createServer as createHttpServer, type Server } from 'node:http';
import { coexistenceProxy } from '../../deploy/coexistenceProxy';

let edge: Server;
let legacy: Server;
let vite: ViteDevServer;
let base: string;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

beforeAll(async () => {
  edge = createHttpServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => response.end(JSON.stringify({
      upstream: 'edge',
      method: request.method,
      path: request.url,
      cookie: request.headers.cookie ?? null,
      authorization: request.headers.authorization ?? null,
      body: Buffer.concat(chunks).toString(),
    })));
  });
  legacy = createHttpServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => response.end(JSON.stringify({
      upstream: 'legacy', method: request.method, path: request.url,
      cookie: request.headers.cookie ?? null,
      authorization: request.headers.authorization ?? null,
      body: Buffer.concat(chunks).toString(),
    })));
  });
  const edgeUrl = await listen(edge);
  const legacyUrl = await listen(legacy);
  vite = await createServer({
    configFile: false,
    plugins: [{
      name: 'coexistence-proxy-test',
    }],
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, proxy: coexistenceProxy(legacyUrl, edgeUrl) },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Expected Vite TCP address');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await vite?.close();
  if (edge) await close(edge);
  if (legacy) await close(legacy);
});

describe('same-origin coexistence proxy', () => {
  it('sends only migrated paths to Edge and preserves method, body, and credentials', async () => {
    for (const path of ['/api/health', '/api/analytics/catalog?limit=1']) {
      const response = await fetch(base + path, {
        headers: { Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        upstream: 'edge',
        method: 'GET',
        path: `/functions/v1/api${path.slice('/api'.length)}`,
        cookie: 'session_id=app-token',
        authorization: 'Bearer app-token',
        body: '',
      });
    }
    const body = JSON.stringify({ athlete_id: 'stg-athlete', config: { metrics: ['tonnage'] } });
    const response = await fetch(`${base}/api/analytics/query?debug=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' },
      body,
    });
    expect(await response.json()).toEqual({
      upstream: 'edge', method: 'POST', path: '/functions/v1/api/analytics/query?debug=1',
      cookie: 'session_id=app-token', authorization: 'Bearer app-token', body,
    });
  });

  it('routes Insight Card CRUD and sync to Edge', async () => {
    const cases = [
      { method: 'GET', path: '/api/insight-cards?view=all', upstream: 'edge', edgePath: '/functions/v1/api/insight-cards?view=all' },
      { method: 'POST', path: '/api/insight-cards', upstream: 'edge', edgePath: '/functions/v1/api/insight-cards' },
      { method: 'PUT', path: '/api/insight-cards/card-1', upstream: 'edge', edgePath: '/functions/v1/api/insight-cards/card-1' },
      { method: 'DELETE', path: '/api/insight-cards/card-1', upstream: 'edge', edgePath: '/functions/v1/api/insight-cards/card-1' },
    ];
    for (const item of cases) {
      const body = item.method === 'GET' || item.method === 'DELETE' ? '' : JSON.stringify({ name: 'Card' });
      const response = await fetch(base + item.path, {
        method: item.method,
        headers: { Cookie: 'session_id=app-token', Authorization: 'Bearer app-token', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body } : {}),
      });
      const result = await response.json();
      expect(result.upstream).toBe(item.upstream);
      expect(result.method).toBe(item.method);
      expect(result.path).toBe(item.edgePath);
      expect(result.cookie).toBe('session_id=app-token');
      expect(result.authorization).toBe('Bearer app-token');
      expect(result.body).toBe(body);
    }
    const syncBody = JSON.stringify({ math_version: 'legacy' });
    const sync = await fetch(`${base}/api/insight-cards/sync?cursor=1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' }, body: syncBody,
    });
    expect(await sync.json()).toEqual({ upstream: 'edge', method: 'POST', path: '/functions/v1/api/insight-cards/sync?cursor=1', cookie: 'session_id=app-token', authorization: 'Bearer app-token', body: syncBody });
    const syncCardId = await fetch(`${base}/api/insight-cards/sync`, {
      method: 'DELETE', headers: { Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' },
    });
    const syncCardResult = await syncCardId.json();
    expect(syncCardResult.upstream).toBe('edge');
    expect(syncCardResult.method).toBe('DELETE');
    expect(syncCardResult.path).toBe('/functions/v1/api/insight-cards/sync');
  });

  it('routes only workout sync to Edge and keeps other workout routes on legacy', async () => {
    const body = JSON.stringify({ mutation_type: 'workout', workout_id: 'w-stg' });
    const response = await fetch(`${base}/api/workouts/w-stg/sync?cursor=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' },
      body,
    });
    expect(await response.json()).toEqual({
      upstream: 'edge', method: 'POST', path: '/functions/v1/api/workouts/w-stg/sync?cursor=1',
      cookie: 'session_id=app-token', authorization: 'Bearer app-token', body,
    });
    for (const path of ['/api/workouts/w-stg', '/api/workouts/w-stg/exercises', '/api/workouts/w-stg/sync/other']) {
      const fallback = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      expect((await fallback.json()).upstream).toBe('legacy');
    }
  });

  it('routes only GET /api/microcycles to Edge and preserves its query string', async () => {
    const response = await fetch(`${base}/api/microcycles?athlete_id=athlete-a`, {
      headers: { Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' },
    });
    expect(await response.json()).toEqual({
      upstream: 'edge', method: 'GET', path: '/functions/v1/api/microcycles?athlete_id=athlete-a',
      cookie: 'session_id=app-token', authorization: 'Bearer app-token', body: '',
    });

    const futureSubroute = await fetch(`${base}/api/microcycles/mc-a`, { method: 'DELETE' });
    expect((await futureSubroute.json()).upstream).toBe('legacy');
  });

  it('keeps all other API paths on the legacy backend', async () => {
    for (const path of ['/api/auth/me', '/api/healthcheck', '/api/analytics/catalogue']) {
      const response = await fetch(base + path);
      expect(await response.json()).toEqual({ upstream: 'legacy', method: 'GET', path, cookie: null, authorization: null, body: '' });
    }
  });

  it('rejects non-local HTTP Edge targets and does not invent an Edge target', () => {
    expect(() => coexistenceProxy('http://localhost:8000', 'http://untrusted.example')).toThrow();
    expect(Object.keys(coexistenceProxy('http://localhost:8000'))).toEqual(['/api']);
  });
});

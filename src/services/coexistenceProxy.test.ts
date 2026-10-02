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
    response.end(JSON.stringify({
      upstream: 'edge',
      path: request.url,
      cookie: request.headers.cookie ?? null,
      authorization: request.headers.authorization ?? null,
    }));
  });
  legacy = createHttpServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ upstream: 'legacy', path: request.url }));
  });
  const edgeUrl = await listen(edge);
  const legacyUrl = await listen(legacy);
  vite = await createServer({
    configFile: false,
    plugins: [],
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
  it('sends only the two migrated GET paths to the Edge function and preserves credentials', async () => {
    for (const path of ['/api/health', '/api/analytics/catalog?limit=1']) {
      const response = await fetch(base + path, {
        headers: { Cookie: 'session_id=app-token', Authorization: 'Bearer app-token' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        upstream: 'edge',
        path: `/functions/v1/api${path}`,
        cookie: 'session_id=app-token',
        authorization: 'Bearer app-token',
      });
    }
  });

  it('keeps all other API paths on the legacy backend', async () => {
    for (const path of ['/api/auth/me', '/api/healthcheck', '/api/analytics/catalogue']) {
      const response = await fetch(base + path);
      expect(await response.json()).toEqual({ upstream: 'legacy', path });
    }
  });

  it('rejects non-local HTTP Edge targets and does not invent an Edge target', () => {
    expect(() => coexistenceProxy('http://localhost:8000', 'http://untrusted.example')).toThrow();
    expect(Object.keys(coexistenceProxy('http://localhost:8000'))).toEqual(['/api']);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { edgeOnlyProxy } from '../../deploy/edgeOnlyProxy';
import { edgeTargetRequiredPlugin } from '../../deploy/edgeTargetRequired';

let edge: Server;
let vite: ViteDevServer;
let base: string;
let seen: { method?: string; path?: string; cookie?: string; authorization?: string; body?: string };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}

/**
 * POST on a fresh connection (no keep-alive reuse) and read the whole reply.
 * Node 22's fetch could reuse a socket the dev server had already closed, which
 * failed this file in CI with "other side closed".
 */
async function postOnce(url: string, headers: Record<string, string>): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

beforeAll(async () => {
  seen = {};
  edge = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen = {
        method: request.method, path: request.url,
        cookie: request.headers.cookie, authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      };
      response.statusCode = 409;
      response.setHeader('content-type', 'application/json');
      response.setHeader('set-cookie', ['session_id=next; HttpOnly; Secure; SameSite=Lax; Path=/', 'csrf=next; Secure; SameSite=Lax; Path=/']);
      response.end(JSON.stringify({ detail: 'upstream conflict' }));
    });
  });
  const edgeUrl = await listen(edge);
  vite = await createServer({
    configFile: false,
    plugins: [edgeTargetRequiredPlugin(true)],
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, proxy: edgeOnlyProxy(edgeUrl) },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Expected Vite TCP address');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await vite?.close();
  if (edge) await close(edge);
});

describe('Edge-only local API routing', () => {
  it('routes every API path to Edge and preserves URL, method, body, credentials, status, and cookies', async () => {
    const body = JSON.stringify({ name: 'session' });
    const response = await fetch(`${base}/api/future/new-route?cursor=a%2Fb&limit=4`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session_id=old; csrf=old',
        Authorization: 'Bearer application-token',
      },
      body,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ detail: 'upstream conflict' });
    expect(seen).toEqual({
      method: 'PATCH',
      path: '/functions/v1/api/future/new-route?cursor=a%2Fb&limit=4',
      cookie: 'session_id=old; csrf=old',
      authorization: 'Bearer application-token',
      body,
    });
    expect(response.headers.getSetCookie()).toEqual([
      'session_id=next; HttpOnly; Secure; SameSite=Lax; Path=/',
      'csrf=next; Secure; SameSite=Lax; Path=/',
    ]);
  });

  it('rejects an unconfigured Edge target instead of falling back to localhost:8000', async () => {
    const missing = await createServer({
      configFile: false,
      plugins: [edgeTargetRequiredPlugin(false)],
      optimizeDeps: { noDiscovery: true },
      server: { host: '127.0.0.1', port: 0 },
    });
    try {
      await missing.listen();
      const address = missing.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Expected Vite TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ detail: 'API_EDGE_TARGET is required for local API requests' });
    } finally {
      await missing.close();
    }
  });

  it('rejects non-HTTPS non-loopback targets', () => {
    expect(() => edgeOnlyProxy('http://untrusted.example')).toThrow();
    expect(() => edgeOnlyProxy('https://edge.example', 'http://staging.example')).toThrow();
  });

  it('with an app origin, sends it only for requests from the local page', async () => {
    const origins: (string | undefined)[] = [];
    const referers: (string | undefined)[] = [];
    const upstream = createHttpServer((request, response) => {
      origins.push(request.headers.origin);
      referers.push(request.headers.referer);
      response.end('{}');
    });
    const upstreamUrl = await listen(upstream);
    const dev = await createServer({
      configFile: false,
      plugins: [edgeTargetRequiredPlugin(true)],
      optimizeDeps: { noDiscovery: true },
      server: { host: '127.0.0.1', port: 0, proxy: edgeOnlyProxy(upstreamUrl, 'https://staging.example') },
    });
    try {
      await dev.listen();
      const address = dev.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Expected Vite TCP address');
      const url = `http://127.0.0.1:${address.port}/api/auth/login`;
      await postOnce(url, { Origin: 'http://localhost:3000', Referer: 'http://localhost:3000/calendar' });
      await postOnce(url, { Origin: 'https://evil.example' });
      expect(origins).toEqual(['https://staging.example', 'https://evil.example']);
      expect(referers).toEqual([undefined, undefined]);
    } finally {
      await dev.close();
      await close(upstream);
    }
  });
});

describe('local dev cookies for Safari', () => {
  it('drops only the Secure attribute so http://localhost keeps the session', async () => {
    const { stripSecure } = await import('../../deploy/edgeOnlyProxy');
    expect(stripSecure('session_id=x; Path=/; HttpOnly; SameSite=lax; Max-Age=604800; Secure'))
      .toBe('session_id=x; Path=/; HttpOnly; SameSite=lax; Max-Age=604800');
    expect(stripSecure('a=1; Secure; SameSite=Lax; Path=/')).toBe('a=1; SameSite=Lax; Path=/');
    expect(stripSecure('SecureToken=1; Path=/')).toBe('SecureToken=1; Path=/');
  });
});

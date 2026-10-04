import type { Plugin } from 'vite';

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'connection', 'content-length', 'expect', 'host', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection', 'content-length', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function edgeOrigin(value: string): URL {
  const parsed = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('API_EDGE_TARGET must be an HTTPS origin (HTTP loopback is allowed for local tests)');
  }
  return parsed;
}

/** Method-specific Vite proxy for the migrated session create/update/delete routes. */
export function sessionCreateProxyPlugin(edgeUrl?: string): Plugin {
  const edge = edgeUrl ? edgeOrigin(edgeUrl) : null;
  return {
    name: 'adaptive-lifting-session-create-proxy',
    configureServer(server) {
      if (!edge) return;
      server.middlewares.use((request, response, next) => {
        const incoming = request.url ?? '/';
        const parsed = new URL(incoming, 'http://vite.local');
        const createSession = request.method === 'POST' && parsed.pathname === '/api/sessions';
        const updateSession = request.method === 'PATCH' &&
          /^\/api\/sessions\/[^/]+$/.test(parsed.pathname) &&
          parsed.pathname !== '/api/sessions/labels';
        const deleteSession = request.method === 'DELETE' &&
          /^\/api\/sessions\/[^/]+$/.test(parsed.pathname) &&
          parsed.pathname !== '/api/sessions/labels';
        if (!createSession && !updateSession && !deleteSession) return next();

        const targetPath = `/functions/v1/api${parsed.pathname.slice('/api'.length)}${parsed.search}`;
        const target = new URL(targetPath, edge);
        const headers = new Headers();
        for (const [name, raw] of Object.entries(request.headers)) {
          if (raw === undefined || HOP_BY_HOP_REQUEST_HEADERS.has(name.toLowerCase())) continue;
          headers.set(name, Array.isArray(raw) ? raw.join(', ') : raw);
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        request.on('error', () => {
          if (!response.headersSent) response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ detail: 'Request body could not be read' }));
        });
        request.on('end', async () => {
          try {
            const upstream = await fetch(target, {
              method: request.method,
              headers,
              body: Buffer.concat(chunks),
              redirect: 'manual',
            });
            const responseHeaders: Record<string, string> = {};
            upstream.headers.forEach((value, name) => {
              if (!HOP_BY_HOP_RESPONSE_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'set-cookie') {
                responseHeaders[name] = value;
              }
            });
            const cookies = upstream.headers.getSetCookie?.();
            if (cookies?.length) response.setHeader('set-cookie', cookies);
            response.writeHead(upstream.status, responseHeaders);
            response.end(Buffer.from(await upstream.arrayBuffer()));
          } catch {
            if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ detail: 'Staging API proxy unavailable' }));
          }
        });
      });
    },
  };
}

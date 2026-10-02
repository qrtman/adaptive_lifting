import type { ProxyOptions } from 'vite';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const edgePaths = ['/api/health', '/api/analytics/catalog', '/api/analytics/query'] as const;

function origin(value: string, label: string): string {
  const parsed = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTPS origin (HTTP loopback is allowed for local tests)`);
  }
  return parsed.origin;
}

// Vite matches proxy keys in insertion order. The anchored rules keep adjacent
// routes on the legacy backend until each capability has been migrated.
export function coexistenceProxy(legacyUrl: string, edgeUrl?: string): Record<string, ProxyOptions> {
  const legacy = origin(legacyUrl, 'API_PROXY_TARGET');
  const proxy: Record<string, ProxyOptions> = {};
  if (edgeUrl) {
    const edge = origin(edgeUrl, 'API_EDGE_TARGET');
    for (const path of edgePaths) {
      proxy[`^${path}(?:\\?|$)`] = {
        target: edge,
        changeOrigin: true,
        // The function slug is already `api`; append the route after removing
        // the same-origin `/api` prefix to avoid `/api/api/...` upstream paths.
        rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
      };
    }
    proxy['^/api/insight-cards(?:/[^/?]+)?(?:\\?.*)?$'] = {
      target: edge,
      changeOrigin: true,
      rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
    };
  }
  proxy['/api'] = { target: legacy, changeOrigin: true };
  return proxy;
}

// Vite's proxy context matchers see paths but not methods. Keep POST sync on
// legacy in a small method-aware middleware while allowing PUT/DELETE for a
// card whose opaque ID happens to be "sync" to reach the migrated CRUD route.
export function createLegacyInsightSyncMiddleware(legacyUrl: string) {
  const targetOrigin = origin(legacyUrl, 'API_PROXY_TARGET');
  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: (error?: unknown) => void) => {
    let incoming: URL;
    try { incoming = new URL(request.url || '/', 'http://vite.local'); } catch { return next(); }
    if (request.method !== 'POST' || incoming.pathname !== '/api/insight-cards/sync') return next();
    const target = new URL(request.url || '/', targetOrigin);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = send({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers: { ...request.headers, host: target.host },
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode || 502;
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined) response.setHeader(name, value);
      }
      upstreamResponse.pipe(response);
    });
    upstream.on('error', (error) => {
      if (!response.headersSent) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ detail: 'Legacy backend unavailable' }));
      } else response.destroy(error);
    });
    request.pipe(upstream);
  };
}

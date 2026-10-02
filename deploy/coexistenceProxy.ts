import type { ProxyOptions } from 'vite';

const edgePaths = ['/api/health', '/api/analytics/catalog'] as const;

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
        rewrite: (incoming) => `/functions/v1/api${incoming}`,
      };
    }
  }
  proxy['/api'] = { target: legacy, changeOrigin: true };
  return proxy;
}

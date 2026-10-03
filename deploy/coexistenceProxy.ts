import type { ProxyOptions } from 'vite';

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
    // Workout sync is migrated as one exact capability. Session CRUD and
    // other workout endpoints continue to use the legacy backend.
    proxy['^/api/workouts/[^/?]+/sync(?:\\?.*)?$'] = {
      target: edge,
      changeOrigin: true,
      rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
    };
    // Match this exact path only; future microcycle subroutes stay on legacy.
    proxy['^/api/microcycles(?:\\?.*)?$'] = {
      target: edge,
      changeOrigin: true,
      rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
    };
  }
  proxy['/api'] = { target: legacy, changeOrigin: true };
  return proxy;
}

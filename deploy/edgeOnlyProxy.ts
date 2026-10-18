import type { ProxyOptions } from 'vite';

function edgeOrigin(value: string): string {
  const parsed = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('API_EDGE_TARGET must be an HTTPS origin (HTTP loopback is allowed for local tests)');
  }
  return parsed.origin;
}

/** One same-origin development proxy for every application API route. */
export function edgeOnlyProxy(edgeUrl?: string): Record<string, ProxyOptions> {
  if (!edgeUrl) return {};
  const edge = edgeOrigin(edgeUrl);
  return {
    '/api': {
      target: edge,
      changeOrigin: true,
      rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
    },
  };
}

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

function siteOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('API_EDGE_ORIGIN must be an HTTPS site origin, e.g. https://staging.example');
  }
  return parsed.origin;
}

const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * One same-origin development proxy for every application API route.
 *
 * `appOrigin` (dev only): the deployed site the Edge API trusts, e.g. staging. Requests
 * from the local dev page (loopback Origin) are sent with that Origin so sign-in works on
 * localhost. Any other Origin (another website) is passed through and stays rejected.
 */
export function edgeOnlyProxy(edgeUrl?: string, appOrigin?: string): Record<string, ProxyOptions> {
  if (!edgeUrl) return {};
  const edge = edgeOrigin(edgeUrl);
  const site = appOrigin ? siteOrigin(appOrigin) : null;
  return {
    '/api': {
      target: edge,
      changeOrigin: true,
      rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
      ...(site ? {
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const origin = req.headers.origin;
            const referer = req.headers.referer;
            const fromLocalPage = origin
              ? LOOPBACK_ORIGIN.test(origin)
              : Boolean(referer && LOOPBACK_ORIGIN.test(new URL(referer).origin));
            if (!fromLocalPage) return;
            proxyReq.setHeader('origin', site);
            proxyReq.removeHeader('referer');
          });
        },
      } : {}),
    },
  };
}

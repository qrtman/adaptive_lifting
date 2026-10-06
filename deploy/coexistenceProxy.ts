import type { ProxyOptions } from 'vite';

const edgePaths = [
  '/api/health', '/api/analytics/catalog', '/api/analytics/query',
  '/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/auth/profile',
  '/api/auth/register', '/api/auth/verify-email', '/api/auth/resend-verification', '/api/auth/google',
  '/api/auth/coach-code', '/api/auth/link', '/api/auth/link-athlete',
  '/api/account/access', '/api/coach/roster', '/api/coach/roster/history',
  '/api/coach/push-program', '/api/security/devices', '/api/security/sessions',
  '/api/security/audit-events', '/api/day-notes', '/api/export/csv', '/api/export/json',
  '/api/integrations/telegram/link-token', '/api/integrations/telegram/miniapp/session',
  '/api/integrations/telegram/status', '/api/integrations/telegram', '/api/integrations/telegram/webhook',
  '/api/integrations/google-sheets/auth-url', '/api/integrations/google-sheets/callback',
  '/api/integrations/google-sheets/status', '/api/integrations/google-sheets',
  '/api/integrations/google-sheets/publish',
  '/api/billing/plans', '/api/billing/stripe/checkout-session',
  '/api/billing/stripe/portal-session', '/api/billing/stripe/webhook',
  '/api/billing/vouchers/redeem',
] as const;

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
    // Set execution logging is an exact POST capability; adjacent set routes
    // stay on the legacy API during coexistence.
    proxy['^/api/sets/log(?:\\?.*)?$'] = {
      target: edge,
      changeOrigin: true,
      rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
    };
    // Resource subroutes are explicitly enumerated; unrelated paths remain on
    // the legacy service.
    for (const pattern of [
      '^/api/auth/link/[^/?]+(?:\\?.*)?$',
      '^/api/coach/roster/history/[^/?]+(?:\\?.*)?$',
      '^/api/security/devices/[^/?]+(?:\\?.*)?$',
      '^/api/security/sessions/[^/?]+(?:\\?.*)?$',
    ]) {
      proxy[pattern] = {
        target: edge,
        changeOrigin: true,
        rewrite: (incoming) => `/functions/v1/api${incoming.slice('/api'.length)}`,
      };
    }
  }
  proxy['/api'] = { target: legacy, changeOrigin: true };
  return proxy;
}

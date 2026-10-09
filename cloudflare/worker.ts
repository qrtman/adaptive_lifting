export interface Env {
  SUPABASE_PROJECT_ORIGIN?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const HOP_BY_HOP = new Set([
  'connection', 'expect', 'host', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade',
]);

const FORWARDED_CLIENT_HEADERS = new Set([
  'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port',
  'x-forwarded-proto', 'x-real-ip', 'x-client-ip', 'client-ip',
  'true-client-ip', 'cf-connecting-ip', 'x-original-forwarded-for',
  'x-vercel-forwarded-for', 'x-cluster-client-ip', 'x-remote-ip', 'x-remote-addr',
]);

function trustedProjectOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
      url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash
    ) return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function cleanRequestHeaders(source: Headers, publishableKey?: string): Headers {
  const headers = new Headers(source);
  const connectionTokens = (headers.get('connection') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const name of HOP_BY_HOP) headers.delete(name);
  for (const name of Array.from(headers.keys())) {
    const lower = name.toLowerCase();
    if (FORWARDED_CLIENT_HEADERS.has(lower) || lower.startsWith('x-forwarded-') || lower.startsWith('x-original-') || lower.startsWith('x-envoy-')) headers.delete(name);
  }
  for (const name of connectionTokens) headers.delete(name);
  if (publishableKey) headers.set('apikey', publishableKey);
  return headers;
}

function cleanResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && lower !== 'set-cookie') headers.append(name, value);
  });
  const sourceWithCookieAccess = source as Headers & { getSetCookie?: () => string[]; getAll?: (name: string) => string[] };
  const cookies = sourceWithCookieAccess.getSetCookie?.() ?? sourceWithCookieAccess.getAll?.('set-cookie');
  if (cookies?.length) {
    for (const cookie of cookies) headers.append('set-cookie', cookie);
  } else {
    const cookie = source.get('set-cookie');
    if (cookie) headers.append('set-cookie', cookie);
  }
  headers.set('cache-control', 'private, no-store');
  headers.set('cdn-cache-control', 'no-store');
  headers.set('cloudflare-cdn-cache-control', 'no-store');
  return headers;
}

function unavailable(status: number, detail: string): Response {
  return Response.json({ detail }, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'cdn-cache-control': 'no-store',
      'cloudflare-cdn-cache-control': 'no-store',
    },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);
    if (!isApiPath(incoming.pathname)) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }

    const origin = trustedProjectOrigin(env.SUPABASE_PROJECT_ORIGIN);
    if (!origin) return unavailable(500, 'Supabase API proxy is not configured');

    const upstream = new URL(origin);
    upstream.pathname = '/functions/v1/api' + incoming.pathname.slice('/api'.length);
    upstream.search = incoming.search;

    try {
      const method = request.method.toUpperCase();
      const bodyAllowed = method !== 'GET' && method !== 'HEAD';
      const init = {
        method,
        headers: cleanRequestHeaders(request.headers, env.SUPABASE_PUBLISHABLE_KEY),
        body: bodyAllowed ? request.body : undefined,
        redirect: 'manual' as RequestRedirect,
        cache: 'no-store' as RequestCache,
        duplex: 'half',
      } as RequestInit;
      const upstreamRequest = new Request(upstream, init);
      const response = await fetch(upstreamRequest);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: cleanResponseHeaders(response.headers),
      });
    } catch {
      return unavailable(502, 'Supabase API proxy unavailable');
    }
  },
};

export default worker;

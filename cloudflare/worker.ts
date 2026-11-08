export interface Env {
  SUPABASE_PROJECT_ORIGIN?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Secret shared with the Edge API; signs the forwarded visitor IP. */
  CLIENT_IP_SIGNING_KEY?: string;
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

// The Worker's subrequest to supabase.co carries the Worker's egress address in
// cf-connecting-ip, so the visitor address travels in these signed headers.
const CLIENT_IP_HEADER = 'x-al-client-ip';
const CLIENT_IP_TS_HEADER = 'x-al-client-ip-ts';
const CLIENT_IP_SIG_HEADER = 'x-al-client-ip-sig';
const MIN_SIGNING_KEY_BYTES = 32;

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Cloudflare sets cf-connecting-ip on the Worker's incoming request itself, so
 * callers cannot spoof it here. Signs `${ip}|${unixSeconds}` for the Edge API.
 */
async function signClientIp(headers: Headers, clientIp: string | null, signingKey?: string): Promise<void> {
  const ip = clientIp?.trim() ?? '';
  if (!signingKey || new TextEncoder().encode(signingKey).length < MIN_SIGNING_KEY_BYTES) return;
  if (!ip || ip.length > 64 || !/^[0-9A-Fa-f:.]+$/.test(ip)) return;
  const ts = String(Math.floor(Date.now() / 1000));
  headers.set(CLIENT_IP_HEADER, ip);
  headers.set(CLIENT_IP_TS_HEADER, ts);
  headers.set(CLIENT_IP_SIG_HEADER, await hmacSha256Hex(signingKey, `${ip}|${ts}`));
}

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
    if (FORWARDED_CLIENT_HEADERS.has(lower) || lower.startsWith('x-forwarded-') || lower.startsWith('x-original-') || lower.startsWith('x-envoy-') || lower.startsWith('x-al-client-ip')) headers.delete(name);
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
  // Supabase's own edge adds bot-management cookies scoped to supabase.co. They
  // are meaningless for this host (browsers reject them), so do not pass them on.
  const foreignDomain = /;\s*domain=\.?(?:[a-z0-9-]+\.)*supabase\.co\s*(?:;|$)/i;
  if (cookies?.length) {
    for (const cookie of cookies) if (!foreignDomain.test(cookie)) headers.append('set-cookie', cookie);
  } else {
    const cookie = source.get('set-cookie');
    if (cookie && !foreignDomain.test(cookie)) headers.append('set-cookie', cookie);
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
      const headers = cleanRequestHeaders(request.headers, env.SUPABASE_PUBLISHABLE_KEY);
      await signClientIp(headers, request.headers.get('cf-connecting-ip'), env.CLIENT_IP_SIGNING_KEY);
      const init = {
        method,
        headers,
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

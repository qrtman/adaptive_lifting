import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { resolveClientIp } from '../supabase/functions/_shared/clientIp';

const origin = 'https://abcdefghijklmnopqrst.supabase.co';
const signingKey = 'test-client-ip-signing-key-0123456789abcdef';

async function hmacHex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cloudflare API Worker', () => {
  it('forwards cookie-authenticated requests with path, query, method, body, origin, and authorization intact', async () => {
    const upstreamResponse = new Response(JSON.stringify({ accepted: true }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'edge-request-7',
      },
    });
    upstreamResponse.headers.append('set-cookie', 'session_id=new-token; HttpOnly; Secure; SameSite=Lax; Path=/');
    upstreamResponse.headers.append('set-cookie', 'csrf=new-value; Secure; SameSite=Lax; Path=/');
    upstreamResponse.headers.append('set-cookie', '__cf_bm=x; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Domain=supabase.co; HttpOnly; Secure');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe(origin + '/functions/v1/api/sessions/active?cursor=a%2Fb&limit=5');
      expect(request.method).toBe('PATCH');
      expect(request.headers.get('cookie')).toBe('session_id=old-token; csrf=old-value');
      expect(request.headers.get('authorization')).toBe('Bearer application-jwt');
      expect(request.headers.get('apikey')).toBe('sb_publishable_configured-key');
      expect(request.headers.get('origin')).toBe('https://app.example.test');
      expect(request.headers.get('referer')).toBe('https://app.example.test/sessions');
      expect(request.headers.get('x-forwarded-for')).toBeNull();
      expect(request.headers.get('forwarded')).toBeNull();
      expect(request.headers.get('x-real-ip')).toBeNull();
      expect(request.headers.get('x-request-hop')).toBeNull();
      expect(request.cache).toBe('no-store');
      expect(await request.text()).toBe(JSON.stringify({ title: 'Evening' }));
      return upstreamResponse;
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request(
      'https://app.example.test/api/sessions/active?cursor=a%2Fb&limit=5',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: 'session_id=old-token; csrf=old-value',
          authorization: 'Bearer application-jwt',
          origin: 'https://app.example.test',
          referer: 'https://app.example.test/sessions',
          'x-forwarded-for': '198.51.100.44',
          forwarded: 'for=198.51.100.44;proto=http',
          'x-real-ip': '198.51.100.44',
          connection: 'keep-alive, x-request-hop',
          'x-request-hop': 'untrusted',
        },
        body: JSON.stringify({ title: 'Evening' }),
      },
    ), { SUPABASE_PROJECT_ORIGIN: origin, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_configured-key' });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get('x-request-id')).toBe('edge-request-7');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.getSetCookie()).toEqual([
      'session_id=new-token; HttpOnly; Secure; SameSite=Lax; Path=/',
      'csrf=new-value; Secure; SameSite=Lax; Path=/',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves GET and DELETE semantics and query strings', async () => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      calls.push(request);
      return new Response(null, { status: 204 });
    }));

    for (const [path, method] of [
      ['/api/health?check=all', 'GET'],
      ['/api/sessions/active?purge=1', 'DELETE'],
    ] as const) {
      const response = await worker.fetch(new Request('https://app.example.test' + path, { method }), {
        SUPABASE_PROJECT_ORIGIN: origin,
      });
      expect(response.status).toBe(204);
    }
    expect(calls.map((request) => [request.method, new URL(request.url).pathname, new URL(request.url).search])).toEqual([
      ['GET', '/functions/v1/api/health', '?check=all'],
      ['DELETE', '/functions/v1/api/sessions/active', '?purge=1'],
    ]);
  });

  it('uses the static assets binding for non-API paths without running an upstream request', async () => {
    const assetRequest = new Request('https://app.example.test/assets/app.js');
    const assetsFetch = vi.fn(async (request: Request) => new Response('asset:' + new URL(request.url).pathname));
    vi.stubGlobal('fetch', vi.fn());

    const response = await worker.fetch(assetRequest, {
      SUPABASE_PROJECT_ORIGIN: origin,
      ASSETS: { fetch: assetsFetch },
    });
    expect(await response.text()).toBe('asset:/assets/app.js');
    expect(assetsFetch).toHaveBeenCalledWith(assetRequest);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['/privacy.html', '/terms.html'])('serves the static legal page %s from assets, not the API proxy', async (pathname) => {
    const assetsFetch = vi.fn(async (request: Request) => new Response('page:' + new URL(request.url).pathname, {
      headers: { 'content-type': 'text/html' },
    }));
    vi.stubGlobal('fetch', vi.fn());

    const response = await worker.fetch(new Request('https://app.example.test' + pathname), {
      SUPABASE_PROJECT_ORIGIN: origin,
      ASSETS: { fetch: assetsFetch },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('page:' + pathname);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed for a missing or untrusted configured origin', async () => {
    vi.stubGlobal('fetch', vi.fn());
    for (const configured of [undefined, 'https://evil.example/path', 'http://abcdefghijklmnopqrst.supabase.co']) {
      const response = await worker.fetch(new Request('https://app.example.test/api/auth/me'), {
        SUPABASE_PROJECT_ORIGIN: configured,
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ detail: 'Supabase API proxy is not configured' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an uncached 502 when the Supabase upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private network detail'); }));
    const response = await worker.fetch(new Request('https://app.example.test/api/sessions'), {
      SUPABASE_PROJECT_ORIGIN: origin,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ detail: 'Supabase API proxy unavailable' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('forwards the visitor IP in signed headers and drops client-supplied copies', async () => {
    let forwarded: Request | null = null;
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      forwarded = request;
      return new Response(null, { status: 204 });
    }));
    const before = Math.floor(Date.now() / 1000);
    await worker.fetch(new Request('https://app.example.test/api/auth/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.50',
        'x-al-client-ip': '198.51.100.1',
        'X-AL-Client-IP-TS': '1',
        'x-al-client-ip-sig': 'f'.repeat(64),
        'x-al-client-ip-extra': 'spoof',
      },
      body: 'username=a&password=b',
    }), { SUPABASE_PROJECT_ORIGIN: origin, CLIENT_IP_SIGNING_KEY: signingKey });

    const headers = forwarded!.headers;
    expect(headers.get('cf-connecting-ip')).toBeNull();
    expect(headers.get('x-al-client-ip-extra')).toBeNull();
    expect(headers.get('x-al-client-ip')).toBe('203.0.113.50');
    const ts = Number(headers.get('x-al-client-ip-ts'));
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(headers.get('x-al-client-ip-sig')).toBe(await hmacHex(signingKey, `203.0.113.50|${ts}`));

    // The Edge resolver accepts exactly what the Worker produced.
    const edgeRequest = new Request('https://abcdefghijklmnopqrst.supabase.co/functions/v1/api/auth/login', {
      headers: { ...Object.fromEntries(headers), 'cf-connecting-ip': '104.28.0.9' },
    });
    expect(await resolveClientIp(edgeRequest, signingKey)).toBe('203.0.113.50');
    expect(await resolveClientIp(edgeRequest, 'a-different-signing-key-0123456789abcdef')).toBe('104.28.0.9');
  });

  it('strips spoofed signed-IP headers and adds none when no signing key is configured', async () => {
    let forwarded: Request | null = null;
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      forwarded = request;
      return new Response(null, { status: 204 });
    }));
    for (const env of [
      { SUPABASE_PROJECT_ORIGIN: origin },
      { SUPABASE_PROJECT_ORIGIN: origin, CLIENT_IP_SIGNING_KEY: 'too-short' },
    ]) {
      await worker.fetch(new Request('https://app.example.test/api/auth/login', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.50',
          'x-al-client-ip': '198.51.100.1',
          'x-al-client-ip-ts': String(Math.floor(Date.now() / 1000)),
          'x-al-client-ip-sig': 'a'.repeat(64),
        },
        body: 'x',
      }), env);
      const headers = forwarded!.headers;
      expect(headers.get('x-al-client-ip')).toBeNull();
      expect(headers.get('x-al-client-ip-ts')).toBeNull();
      expect(headers.get('x-al-client-ip-sig')).toBeNull();
      expect(headers.get('cf-connecting-ip')).toBeNull();
    }
  });

  it('does not sign when the incoming request has no usable visitor IP', async () => {
    let forwarded: Request | null = null;
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      forwarded = request;
      return new Response(null, { status: 204 });
    }));
    await worker.fetch(new Request('https://app.example.test/api/auth/me', {
      headers: { 'cf-connecting-ip': '203.0.113.50, 198.51.100.1' },
    }), { SUPABASE_PROJECT_ORIGIN: origin, CLIENT_IP_SIGNING_KEY: signingKey });
    expect(forwarded!.headers.get('x-al-client-ip')).toBeNull();
    expect(forwarded!.headers.get('x-al-client-ip-sig')).toBeNull();
  });
});

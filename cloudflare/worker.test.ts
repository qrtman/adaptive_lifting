import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';

const origin = 'https://abcdefghijklmnopqrst.supabase.co';

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
});

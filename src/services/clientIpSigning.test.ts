import { describe, expect, it } from 'vitest';
import { rateLimitClientIp, resolveClientIp } from '../../supabase/functions/_shared/clientIp';

// Node-side mirror of supabase/functions/_shared/clientIp.test.ts (Deno), so the
// signed visitor-IP contract also runs under the default vitest suite.
const KEY = 'test-client-ip-signing-key-0123456789abcdef';
const HOSTED = 'https://project.supabase.co/functions/v1/api/auth/login';
const NOW_MS = 1_900_000_000_000;
const NOW_S = NOW_MS / 1000;

async function hmacHex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signed(ip: string, ts: number, key = KEY): Promise<Record<string, string>> {
  return { 'x-al-client-ip': ip, 'x-al-client-ip-ts': String(ts), 'x-al-client-ip-sig': await hmacHex(key, `${ip}|${ts}`) };
}

const hosted = (headers: Record<string, string>) => new Request(HOSTED, { headers: { 'cf-connecting-ip': '104.28.0.9', ...headers } });

describe('Worker-signed client IP verification', () => {
  it('trusts a fresh signature over the Worker egress address', async () => {
    expect(await rateLimitClientIp(hosted(await signed('203.0.113.50', NOW_S - 60)), { clientIpSigningKey: KEY }, NOW_MS)).toBe('203.0.113.50');
  });

  it('falls back to the ingress address for stale, tampered, or unkeyed headers', async () => {
    const fresh = await signed('203.0.113.50', NOW_S);
    for (const [headers, key] of [
      [await signed('203.0.113.50', NOW_S - 61), KEY],
      [{ ...fresh, 'x-al-client-ip': '203.0.113.51' }, KEY],
      [{ ...fresh, 'x-al-client-ip-sig': '0'.repeat(64) }, KEY],
      [await signed('203.0.113.50', NOW_S, 'attacker-chosen-signing-key-0123456789'), KEY],
      [fresh, null],
    ] as Array<[Record<string, string>, string | null]>) {
      expect(await resolveClientIp(hosted(headers), key, NOW_MS)).toBe('104.28.0.9');
    }
  });

  it('fails closed when nothing trusted remains', async () => {
    const request = new Request(HOSTED, { headers: { 'x-forwarded-for': '198.51.100.1' } });
    await expect(rateLimitClientIp(request, { clientIpSigningKey: KEY }, NOW_MS)).rejects.toMatchObject({ status: 503 });
  });
});

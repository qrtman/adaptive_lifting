import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canReadOffline, clearAuthorization, restoreOfflineAuthorization, setOnlineAuthorization, verifyOfflineGrant } from './authAuthorization';
import { getSnapshot } from './db';

vi.mock('./db', () => ({ clearSnapshot: vi.fn().mockResolvedValue(undefined), getSnapshot: vi.fn(), saveSnapshot: vi.fn() }));

beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); await clearAuthorization(); });

async function signedGrant(overrides: Record<string, unknown> = {}) {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'adaptive-lifting', aud: 'adaptive-lifting-offline', iat: now, exp: now + 3600,
    sub: 'user', sid: 'session', scopes: ['user'], user: { id: 'user', role: 'ATHLETE' }, ...overrides };
  const content = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(content));
  const key = Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');
  return { token: content + '.' + Buffer.from(signature).toString('base64url'), key };
}

describe('offline authorization', () => {
  it('does not restore a grant after logout during an asynchronous read', async () => {
    const grant = await signedGrant();
    vi.stubEnv('VITE_OFFLINE_AUTH_PUBLIC_KEY', grant.key);
    let complete!: (value: string) => void;
    vi.mocked(getSnapshot).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const restoration = restoreOfflineAuthorization();
    await clearAuthorization();
    complete(grant.token);
    expect(await restoration).toBeNull();
    expect(canReadOffline('user')).toBe(false);
    vi.unstubAllEnvs();
  });

  it('accepts only a grant signed by the pinned server key', async () => {
    const grant = await signedGrant();
    expect(await verifyOfflineGrant(grant.token, grant.key)).toMatchObject({ user: { id: 'user' }, scopes: ['user'] });
    const other = await signedGrant();
    expect(await verifyOfflineGrant(grant.token, other.key)).toBeNull();
    expect(await verifyOfflineGrant(grant.token.replace('eyJ', 'aaJ'), grant.key)).toBeNull();
    expect(await verifyOfflineGrant(grant.token, '')).toBeNull();
  });

  it.each([{ exp: 1 }, { aud: 'other' }, { user: { id: 'other', role: 'ATHLETE' } }, { exp: Math.floor(Date.now() / 1000) + 172800 }])('rejects expired, mismatched or overlong grants: %j', async claims => {
    const grant = await signedGrant(claims);
    expect(await verifyOfflineGrant(grant.token, grant.key)).toBeNull();
  });

  it('restricts cached reads by scope and expiry and clears authority on logout', async () => {
    expect(canReadOffline('user')).toBe(false);
    setOnlineAuthorization({ id: 'user', role: 'ATHLETE' }, new Date(Date.now() + 60000).toISOString());
    expect(canReadOffline('user')).toBe(true);
    expect(canReadOffline('other')).toBe(false);
    expect(canReadOffline()).toBe(false);
    await clearAuthorization();
    expect(canReadOffline('user')).toBe(false);
  });
});

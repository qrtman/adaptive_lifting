import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canReadOffline, clearAuthorization, restoreOfflineAuthorization, setOnlineAuthorization, verifyOfflineGrant } from './authAuthorization';
import { getSnapshot } from './db';

vi.mock('./db', () => ({ clearSnapshot: vi.fn().mockResolvedValue(undefined), getSnapshot: vi.fn(), saveSnapshot: vi.fn() }));

beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); await clearAuthorization(); });

async function signedGrant(overrides: Record<string, unknown> = {}, alg = 'ES256') {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'adaptive-lifting', aud: 'adaptive-lifting-offline', iat: now, exp: now + 3600,
    sub: 'user', sid: 'session', scopes: ['user'],
    user: { id: 'user', email: 'athlete@example.com', role: 'ATHLETE', displayName: 'Athlete' }, ...overrides };
  const content = Buffer.from(JSON.stringify({ alg })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
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
    expect(await verifyOfflineGrant(grant.token, grant.key)).toMatchObject({
      user: { id: 'user', email: 'athlete@example.com', role: 'ATHLETE', displayName: 'Athlete' },
      scopes: ['user'],
    });
    const other = await signedGrant();
    expect(await verifyOfflineGrant(grant.token, other.key)).toBeNull();
    const [header, payload, signature] = grant.token.split('.');
    const changedPayload = Buffer.from(JSON.stringify({ iss: 'adaptive-lifting', aud: 'adaptive-lifting-offline',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'other', sid: 'session', scopes: ['user'], user: { id: 'user', role: 'ATHLETE' } })).toString('base64url');
    const changedSignature = `${header}.${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    expect(await verifyOfflineGrant(`${header}.${changedPayload}.${signature}`, grant.key)).toBeNull();
    expect(await verifyOfflineGrant(changedSignature, grant.key)).toBeNull();
    const wrongAlg = await signedGrant({}, 'HS256');
    expect(await verifyOfflineGrant(wrongAlg.token, wrongAlg.key)).toBeNull();
    expect(await verifyOfflineGrant(grant.token, '')).toBeNull();
  });

  it.each([
    { exp: 1 },
    { iss: 'other' },
    { aud: 'other' },
    // Keep the value outside the verifier's 30-second skew even if the
    // parameterized case runs after earlier async signature checks.
    { iat: Math.floor(Date.now() / 1000) + 61 },
    { exp: Math.floor(Date.now() / 1000) + 172800 },
    { sid: '' },
    { sub: '' },
    { user: { id: 'other', role: 'ATHLETE' } },
    { user: { id: 'user', role: 'ADMIN' } },
    { scopes: ['user', 7] },
  ])('rejects invalid claim values: %j', async claims => {
    const grant = await signedGrant(claims);
    expect(await verifyOfflineGrant(grant.token, grant.key)).toBeNull();
  });

  it('restores only signed scopes and persists the online grant for offline reload', async () => {
    const grant = await signedGrant({ scopes: ['coach', 'athlete-a'] });
    vi.stubEnv('VITE_OFFLINE_AUTH_PUBLIC_KEY', grant.key);
    vi.mocked(getSnapshot).mockResolvedValueOnce(grant.token);
    expect(await restoreOfflineAuthorization()).toMatchObject({ id: 'user', role: 'ATHLETE' });
    expect(canReadOffline('athlete-a')).toBe(true);
    expect(canReadOffline('athlete-b')).toBe(false);
    await clearAuthorization();
    expect(canReadOffline('athlete-a')).toBe(false);
    vi.unstubAllEnvs();
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

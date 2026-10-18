import { exportJWK, generateKeyPair, jwtVerify, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  issueRealtimeToken,
  loadRealtimeSigner,
  REALTIME_PURPOSE,
  REALTIME_ROLE,
  REALTIME_SIGNING_KID,
  REALTIME_TOKEN_TTL_SECONDS,
  signerFromEnv,
} from '../../supabase/functions/_shared/realtime/token';

let privateJwk: JWK;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateJwk = await exportJWK(pair.privateKey);
  publicKey = pair.publicKey;
});

function envReader(overrides: Record<string, string> = {}, jwk = privateJwk) {
  const values: Record<string, string> = {
    APP_ENV: 'production',
    REALTIME_JWT_PRIVATE_JWK: JSON.stringify(jwk),
    REALTIME_JWT_KEY_ID: 'production-synthetic-key',
    ...overrides,
  };
  return (name: string) => values[name];
}

describe('production Realtime signer configuration', () => {
  it.each(['private-key-canary', '{"d":"private-key-canary"', 'null'])('sanitizes malformed key input before startup', async raw => {
    const loading = loadRealtimeSigner(envReader({ REALTIME_JWT_PRIVATE_JWK: raw }));
    await expect(loading).rejects.toThrow(/^Realtime signing key must be/);
    await expect(loading).rejects.not.toThrow('private-key-canary');
  });
  it('validates signing before serving and issues a restricted, 60-second grant', async () => {
    const signer = await loadRealtimeSigner(envReader());
    const now = 1_800_000_000;
    const issued = await issueRealtimeToken('athlete-test', 'workout-test', signer, now);
    const { payload, protectedHeader } = await jwtVerify(issued.token, publicKey, {
      algorithms: ['ES256'],
      currentDate: new Date((now + 1) * 1000),
    });
    expect(protectedHeader.kid).toBe('production-synthetic-key');
    expect(issued.topic).toBe('workout:workout-test');
    expect(issued.expires_at).toBe(now + REALTIME_TOKEN_TTL_SECONDS);
    expect(payload).toMatchObject({
      sub: 'athlete-test',
      role: REALTIME_ROLE,
      purpose: REALTIME_PURPOSE,
      rt_topic: issued.topic,
      app_user_id: 'athlete-test',
      workout_id: 'workout-test',
      exp: issued.expires_at,
    });
    expect(payload).not.toHaveProperty('session_id');
  });

  it.each(['x', 'y', 'd'] as const)('rejects malformed nonempty %s before serving', async coordinate => {
    const malformedJwk = { ...privateJwk, [coordinate]: 'malformed-coordinate' };
    // This shape passed the earlier startup check and failed only on issuance.
    expect(() => signerFromEnv(envReader({}, malformedJwk))).not.toThrow();
    await expect(loadRealtimeSigner(envReader({}, malformedJwk)))
      .rejects.toThrow('Realtime signing key must be usable for ES256 signing');
  });

  it('rejects a public key without private coordinates', async () => {
    const { d: _privateCoordinate, ...publicJwk } = privateJwk;
    await expect(loadRealtimeSigner(envReader({}, publicJwk)))
      .rejects.toThrow('Realtime signing key must be a private P-256 JWK');
  });

  it('rejects valid public coordinates from a different private key', async () => {
    const other = await generateKeyPair('ES256', { extractable: true });
    const otherPublic = await exportJWK(other.publicKey);
    await expect(loadRealtimeSigner(envReader({}, {
      ...privateJwk, x: otherPublic.x, y: otherPublic.y,
    }))).rejects.toThrow('Realtime signing key must be usable for ES256 signing');
  });

  it('normalizes verify-only exported metadata for signing', async () => {
    const signer = await loadRealtimeSigner(envReader({}, {
      ...privateJwk,
      key_ops: ['verify'],
      use: 'enc',
    }));
    expect(signer.jwk.key_ops).toEqual(['sign']);
    expect(signer.jwk.use).toBeUndefined();
  });

  it('accepts the production kid from the JWK without a separate override', async () => {
    const signer = await loadRealtimeSigner(envReader({ REALTIME_JWT_KEY_ID: '' }, {
      ...privateJwk,
      kid: 'production-jwk-kid',
    }));
    expect(signer.kid).toBe('production-jwk-kid');
  });

  it('accepts matching configured and JWK production kids', async () => {
    const signer = await loadRealtimeSigner(envReader({}, {
      ...privateJwk,
      kid: 'production-synthetic-key',
    }));
    expect(signer.kid).toBe('production-synthetic-key');
  });

  it('rejects mismatched configured and JWK kids', async () => {
    await expect(loadRealtimeSigner(envReader({}, { ...privateJwk, kid: 'other-key' })))
      .rejects.toThrow('Realtime configured key ID and JWK kid must match');
  });

  it.each(['production', 'prod', ' Production '])('requires an explicit independent kid for APP_ENV=%s', async appEnv => {
    await expect(loadRealtimeSigner(envReader({ APP_ENV: appEnv, REALTIME_JWT_KEY_ID: '' })))
      .rejects.toThrow('Realtime signing key requires a valid key ID');
  });

  it('recognizes the production ENV fallback', async () => {
    await expect(loadRealtimeSigner(envReader({ APP_ENV: '', ENV: 'prod', REALTIME_JWT_KEY_ID: '' })))
      .rejects.toThrow('Realtime signing key requires a valid key ID');
  });

  it.each(['configured', 'jwk'])('rejects the staging kid from the %s production setting', async source => {
    const reader = source === 'configured'
      ? envReader({ REALTIME_JWT_KEY_ID: REALTIME_SIGNING_KID })
      : envReader({ REALTIME_JWT_KEY_ID: '' }, { ...privateJwk, kid: REALTIME_SIGNING_KID });
    await expect(loadRealtimeSigner(reader))
      .rejects.toThrow('Production Realtime signing key must have an independent key ID');
  });

  it.each(['bad kid', '-leading', 'x'.repeat(129)])('rejects invalid kid %s', async kid => {
    await expect(loadRealtimeSigner(envReader({ REALTIME_JWT_KEY_ID: kid })))
      .rejects.toThrow('Realtime signing key requires a valid key ID');
  });

  it('preserves the staging fallback kid', async () => {
    const signer = await loadRealtimeSigner(envReader({ APP_ENV: 'staging', REALTIME_JWT_KEY_ID: '' }));
    expect(signer.kid).toBe(REALTIME_SIGNING_KID);
  });
});

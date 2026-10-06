import { describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { verifyGoogleIdTokenWithJwks } from '../../supabase/functions/_shared/googleIdToken.ts';

describe('Google ID-token verification', () => {
  it('accepts a correctly signed token with the configured audience and verified email', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey) as JWK;
    jwk.kid = 'google-test-key';
    jwk.use = 'sig';
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: 'ATHLETE@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience('test-client')
      .setSubject('google-subject')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    await expect(verifyGoogleIdTokenWithJwks(token, 'test-client', { keys: [jwk] }))
      .resolves.toEqual({ subject: 'google-subject', email: 'athlete@example.com' });
  });

  it('rejects bad signatures, audiences, issuers, expiry, and unverified email', async () => {
    const signer = await generateKeyPair('RS256');
    const attacker = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(signer.publicKey) as JWK;
    publicJwk.kid = 'google-test-key';
    publicJwk.use = 'sig';
    const jwks = { keys: [publicJwk] };
    const now = Math.floor(Date.now() / 1000);
    const makeToken = (key: CryptoKey, overrides: Record<string, unknown> = {}, audience = 'test-client', issuer = 'https://accounts.google.com', expiresAt = now + 3600) =>
      new SignJWT({ email: 'athlete@example.com', email_verified: true, ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' })
        .setIssuer(issuer).setAudience(audience).setSubject('google-subject')
        .setIssuedAt(now).setExpirationTime(expiresAt).sign(key);

    await expect(verifyGoogleIdTokenWithJwks(await makeToken(attacker.privateKey), 'test-client', jwks)).rejects.toThrow();
    await expect(verifyGoogleIdTokenWithJwks(await makeToken(signer.privateKey, {}, 'wrong-client'), 'test-client', jwks)).rejects.toThrow();
    const multiAudienceToken = await new SignJWT({ email: 'athlete@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' }).setIssuer('https://accounts.google.com')
      .setAudience(['test-client', 'another-client']).setSubject('google-subject').setIssuedAt(now)
      .setExpirationTime(now + 3600).sign(signer.privateKey);
    await expect(verifyGoogleIdTokenWithJwks(multiAudienceToken, 'test-client', jwks)).rejects.toThrow();
    await expect(verifyGoogleIdTokenWithJwks(await makeToken(signer.privateKey, {}, 'test-client', 'https://attacker.invalid'), 'test-client', jwks)).rejects.toThrow();
    await expect(verifyGoogleIdTokenWithJwks(await makeToken(signer.privateKey, {}, 'test-client', 'https://accounts.google.com', now - 1), 'test-client', jwks)).rejects.toThrow();
    await expect(verifyGoogleIdTokenWithJwks(await makeToken(signer.privateKey, { email_verified: false }), 'test-client', jwks)).rejects.toThrow('verified email');
  });

  it('rejects a non-RS256 header before key lookup', async () => {
    await expect(verifyGoogleIdTokenWithJwks('eyJhbGciOiJIUzI1NiIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJ4In0.signature', 'test-client', { keys: [] }))
      .rejects.toThrow('Invalid Google ID token');
  });
});

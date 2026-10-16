import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../supabase/functions/_shared/config';

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    DATABASE_URL: 'postgresql://runtime:private-test@db.example.test:5432/postgres',
    JWT_SECRET_CURRENT: 'synthetic-production-signing-key-with-sufficient-length',
    CORS_ALLOWED_ORIGINS: 'https://app.goatedmethod.me',
    APP_ENV: 'production',
    COOKIE_SECURE: 'true',
    EMAIL_VERIFICATION_NEW_ACCOUNTS: 'true',
    ...overrides,
  } as Record<string, string>;
}

describe('fresh production auth configuration', () => {
  it('rejects disabling new-account email verification at runtime', () => {
    const values = productionEnv({ EMAIL_VERIFICATION_NEW_ACCOUNTS: 'false' });
    expect(() => loadConfig((name) => values[name])).toThrow('EMAIL_VERIFICATION_NEW_ACCOUNTS must be true in production');
  });

  it('requires only the new current key and preserves the exact production origin', () => {
    const values = productionEnv();
    const config = loadConfig((name) => values[name]);
    expect(config.jwtPrevious).toBeNull();
    expect(config.newEmailVerificationEnabled).toBe(true);
    expect(config.allowedOrigins).toEqual(['https://app.goatedmethod.me']);
  });

  it('loads the Realtime private JWK from the same variable used by the signer', () => {
    const syntheticJwk = JSON.stringify({ kty: 'EC', crv: 'P-256', d: 'synthetic-test-only' });
    const values = productionEnv({
      REALTIME_JWT_PRIVATE_JWK: syntheticJwk,
      REALTIME_SIGNING_JWK: 'obsolete-variable-must-not-win',
    });
    expect(loadConfig((name) => values[name]).realtimeSigningJwk).toBe(syntheticJwk);
  });

  it('does not load the obsolete Realtime signing variable', () => {
    const values = productionEnv({ REALTIME_SIGNING_JWK: 'obsolete-variable' });
    expect(loadConfig((name) => values[name]).realtimeSigningJwk).toBeNull();
  });
});

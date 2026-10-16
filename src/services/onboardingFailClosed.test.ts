import { describe, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/db/mod.ts', () => ({ authRepository: vi.fn() }));
import { handleOnboardingRoute } from '../../supabase/functions/_shared/onboardingRoute';
import { ApiError } from '../../supabase/functions/_shared/errors/mod';

describe('new account registration readiness', () => {
  it('does not create an account when email delivery is not configured', async () => {
    const queryObject = vi.fn(async (_sql: string) => ({ rows: [{ config: {} }] }));
    const release = vi.fn();
    const db = { connect: vi.fn(async () => ({ queryObject, release })) } as any;
    const config = {
      newEmailVerificationEnabled: true,
      emailOnboardingEnabled: true,
      emailProviderApiKey: null,
      emailFrom: null,
      emailPayloadEncryptionKey: null,
      appUrl: 'https://app.goatedmethod.me',
      allowedOrigins: ['https://app.goatedmethod.me'],
      appEnv: 'production',
      cookieSecure: true,
      enforceLegacyEmailVerification: false,
    } as any;
    const request = new Request('https://app.goatedmethod.me/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.goatedmethod.me' },
      body: JSON.stringify({ email: 'new@example.test', password: 'test-password-123' }),
    });

    await expect(handleOnboardingRoute(request, db, config)).rejects.toMatchObject({
      status: 503,
      message: 'Email verification is temporarily unavailable',
    } satisfies Partial<ApiError>);
    expect(queryObject).toHaveBeenCalledOnce();
    expect(queryObject.mock.calls[0]?.[0]).toContain('al_email_delivery_config');
    expect(queryObject.mock.calls.some(([sql]) => String(sql).includes('al_onboarding_register'))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    ['/api/auth/register', false], ['/api/auth/register', undefined],
    ['/api/auth/resend-verification', false], ['/api/auth/resend-verification', undefined],
  ])('keeps unapproved production onboarding closed at %s (%s)', async (path, enabled) => {
    const connect = vi.fn();
    const config = { appEnv: 'production', emailOnboardingEnabled: enabled } as any;
    const request = new Request(`https://app.goatedmethod.me${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.test', password: 'test-password-123' }),
    });
    await expect(handleOnboardingRoute(request, { connect } as any, config)).rejects.toMatchObject({ status: 503 });
    expect(connect).not.toHaveBeenCalled();
  });

  it('allows an issued link to be verified while new onboarding is closed', async () => {
    const queryObject = vi.fn(async (_sql: string) => ({ rows: [{ payload: { denial: 'invalid_token' } }] }));
    const release = vi.fn();
    const db = { connect: vi.fn(async () => ({ queryObject, release })) } as any;
    const request = new Request('https://app.goatedmethod.me/api/auth/verify-email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(43) }),
    });
    await expect(handleOnboardingRoute(request, db, {
      appEnv: 'production', emailOnboardingEnabled: false,
    } as any)).rejects.toMatchObject({ status: 400 });
    expect(queryObject.mock.calls[0]?.[0]).toContain('al_onboarding_verify');
    expect(release).toHaveBeenCalledOnce();
  });
});

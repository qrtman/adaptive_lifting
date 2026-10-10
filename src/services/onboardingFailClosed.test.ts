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
});

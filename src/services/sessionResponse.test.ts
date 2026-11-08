import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { sessionResponse } from '../../supabase/functions/_shared/sessionResponse.ts';

describe('shared custom app-session response', () => {
  it('mints the existing HS256 app token and cookie contract for account onboarding', async () => {
    const secret = 'session-response-test-secret-32-characters';
    const response = await sessionResponse(
      { id: 'user-1', email: 'athlete@example.invalid', role: 'ATHLETE', displayName: null },
      'session-1',
      {
        databaseUrl: 'postgres://unused', jwtCurrent: secret, jwtPrevious: null,
        enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3,
        allowedOrigins: ['https://app.example.invalid'], cookieSecure: true,
      },
    );
    const body = await response.json();
    const cookieToken = decodeURIComponent(/session_id=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')![1]);
    const { payload, protectedHeader } = await jwtVerify(cookieToken, new TextEncoder().encode(secret));
    expect(protectedHeader).toMatchObject({ alg: 'HS256', kid: 'current' });
    expect(payload).toMatchObject({ sub: 'user-1', role: 'ATHLETE', session_id: 'session-1' });
    // The JWT stays in the HttpOnly cookie; page scripts never receive it.
    expect(body).toEqual({
      user: { id: 'user-1', email: 'athlete@example.invalid', role: 'ATHLETE', displayName: null },
    });
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

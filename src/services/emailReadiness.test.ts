import { describe, expect, it, vi } from 'vitest';
import { requireEmailRegistrationReady } from '../../supabase/functions/_shared/emailReadiness';

const config = {
  emailProviderApiKey: null,
  emailFrom: null,
  appUrl: 'https://app.goatedmethod.me',
  allowedOrigins: ['https://app.goatedmethod.me'],
  appEnv: 'production',
  cookieSecure: true,
};

describe('production email registration gate', () => {
  it('fails closed if sender or verification settings are missing', async () => {
    const fallback = vi.fn(async () => ({ apiKey: '', emailFrom: '', appUrl: config.appUrl }));
    await expect(requireEmailRegistrationReady(config, fallback)).rejects.toThrow('email delivery configuration unavailable');
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('accepts a configured sender and exact HTTPS application origin', async () => {
    const fallback = vi.fn(async () => ({ apiKey: 'private-test-value', emailFrom: 'verify@example.test', appUrl: config.appUrl }));
    await expect(requireEmailRegistrationReady(config, fallback)).resolves.toBeUndefined();
  });

  it('rejects an APP_URL outside the strict origin allowlist', async () => {
    const fallback = vi.fn(async () => ({ apiKey: 'private-test-value', emailFrom: 'verify@example.test' }));
    await expect(requireEmailRegistrationReady({ ...config, appUrl: 'https://untrusted.example' }, fallback))
      .rejects.toThrow('not an allowed origin');
  });
});

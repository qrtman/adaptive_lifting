import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('API base URL', () => {
  it('uses the configured separate origin only in development builds', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_BACKEND_URL', 'http://localhost:8000/');

    const { API_BASE_URL } = await import('./apiBase');
    expect(API_BASE_URL).toBe('http://localhost:8000');
  });

  it('keeps production API calls same-origin even if an override is present', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_BACKEND_URL', 'https://legacy.example.test');

    const { API_BASE_URL } = await import('./apiBase');
    expect(API_BASE_URL).toBe('');
  });
});

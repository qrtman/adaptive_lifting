import { afterEach, describe, expect, it, vi } from 'vitest';
import { integrationsEnabled, resolveIntegrationsEnabled } from './featureFlags';

afterEach(() => { vi.unstubAllEnvs(); });

describe('resolveIntegrationsEnabled', () => {
  it('defaults off in production and on in development', () => {
    expect(resolveIntegrationsEnabled(undefined, true)).toBe(false);
    expect(resolveIntegrationsEnabled('', true)).toBe(false);
    expect(resolveIntegrationsEnabled(undefined, false)).toBe(true);
  });

  it('honours an explicit value', () => {
    expect(resolveIntegrationsEnabled('true', true)).toBe(true);
    expect(resolveIntegrationsEnabled('false', false)).toBe(false);
  });

  it('reads VITE_INTEGRATIONS_ENABLED from the build env', () => {
    vi.stubEnv('VITE_INTEGRATIONS_ENABLED', 'false');
    expect(integrationsEnabled()).toBe(false);
    vi.stubEnv('VITE_INTEGRATIONS_ENABLED', 'true');
    expect(integrationsEnabled()).toBe(true);
  });
});

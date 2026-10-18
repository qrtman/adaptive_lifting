import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../supabase/functions/_shared/config';
import { validateProductionRuntime } from '../../supabase/functions/_shared/productionRuntime';

const origin = 'https://app.goatedmethod.me';
const ref = 'gadusaizqnshxqcckibq';
const role = 'al_edge_catalog_runtime';
const direct = `postgresql://${role}:synthetic-password@db.${ref}.supabase.co:5432/postgres`;
function config(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    APP_ENV: 'production', APP_URL: origin, CORS_ALLOWED_ORIGINS: origin,
    DATABASE_URL: direct, JWT_SECRET_CURRENT: 'synthetic-test-signing-key-of-sufficient-length',
    ...overrides,
  };
  return loadConfig(name => env[name]);
}

describe('production release target guards', () => {
  it('accepts the approved direct database and session pooler identities', () => {
    expect(() => validateProductionRuntime(config())).not.toThrow();
    expect(() => validateProductionRuntime(config({ DATABASE_URL:
      `postgresql://${role}.${ref}:synthetic-password@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres` }))).not.toThrow();
  });
  it.each([
    direct.replace(role, 'postgres'), direct.replace(ref, 'admyuepbbtstayaydjmo'),
    direct.replace('.supabase.co', '.supabase.co.attacker.test'),
    direct.replace(':5432', ':6543'), direct + '?sslmode=disable',
    direct.replace('/postgres', '/other'), direct.replace('synthetic-password', ''),
    `postgresql://${role}.${ref}:synthetic-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
    `postgresql://${role}:synthetic-password@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  ])('rejects a wrong or unsafe database target without logging credentials (%#)', databaseUrl => {
    const run = () => validateProductionRuntime(config({ DATABASE_URL: databaseUrl }));
    expect(run).toThrow('Production database');
    expect(run).not.toThrow('synthetic-password');
  });
  it.each([
    { APP_URL: 'https://staging.example.test' },
    { CORS_ALLOWED_ORIGINS: `${origin},https://staging.example.test` },
    { APP_URL: `${origin}/callback` },
  ])('rejects origins outside the release boundary', override => {
    expect(() => validateProductionRuntime(config(override))).toThrow('exact approved application origin');
  });
  it('preserves independent staging configuration', () => {
    expect(() => validateProductionRuntime(config({ APP_ENV: 'staging', DATABASE_URL: direct.replace(ref, 'admyuepbbtstayaydjmo') }))).not.toThrow();
  });
  it('keeps production onboarding closed until explicitly enabled', () => {
    expect(config().emailOnboardingEnabled).toBe(false);
    expect(config({ EMAIL_ONBOARDING_ENABLED: 'true' }).emailOnboardingEnabled).toBe(true);
    expect(() => config({ EMAIL_ONBOARDING_ENABLED: 'invalid' })).toThrow('must be a boolean');
  });
});

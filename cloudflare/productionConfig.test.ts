import { describe, expect, it } from 'vitest';
import { validateProductionConfig } from '../scripts/validate-production-config.mjs';
import { makeProductionWranglerConfig } from '../scripts/prepare-production-wrangler.mjs';

describe('isolated production release configuration', () => {
  it('keeps production routing, assets and project identity separate from staging', () => {
    const { prod, staging, env, versions } = validateProductionConfig();
    expect(prod.name).toBe('adaptive-lifting-production');
    expect(staging.name).toBe('adaptive-lifting-staging');
    expect(prod.vars.SUPABASE_PROJECT_ORIGIN).toContain('REQUIRED_PRODUCTION_PROJECT_REF');
    expect(prod.assets.not_found_handling).toBe('single-page-application');
    expect(prod.assets.run_worker_first).toContain('/api/*');
    expect(prod.routes[0].pattern).toBe('app.goatedmethod.me/*');
    expect(env.get('APP_ENV')).toBe('production');
    expect(env.get('COOKIE_SECURE')).toBe('true');
    expect(versions).toHaveLength(63);
  });

  it('builds a local production config only from a non-staging project ref', () => {
    expect(() => makeProductionWranglerConfig('admyuepbbtstayaydjmo')).toThrow(/staging is rejected/);
    const config = JSON.parse(makeProductionWranglerConfig('abcdefghijklmnopqrst'));
    expect(config.name).toBe('adaptive-lifting-production');
    expect(config.vars.SUPABASE_PROJECT_ORIGIN).toBe('https://abcdefghijklmnopqrst.supabase.co');
  });
});

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

  it('builds a local production config only from the approved project ref', () => {
    expect(() => makeProductionWranglerConfig('admyuepbbtstayaydjmo')).toThrow(/staging is rejected/);
    expect(() => makeProductionWranglerConfig('abcdefghijklmnopqrst')).toThrow(/approved production project/);
    const config = JSON.parse(makeProductionWranglerConfig('gadusaizqnshxqcckibq'));
    expect(config.name).toBe('adaptive-lifting-production');
    expect(config.vars.SUPABASE_PROJECT_ORIGIN).toBe('https://gadusaizqnshxqcckibq.supabase.co');
  });

  it('ships an installable PWA manifest and root icon in the production build', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = process.cwd();
    expect(readFileSync(resolve(root, 'index.html'), 'utf8')).toContain('/manifest.webmanifest');
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone' });
    expect(existsSync(resolve(root, 'public/app-icon.svg'))).toBe(true);
    for (const size of [192, 512]) {
      const icon = manifest.icons.find((entry: { src: string }) => entry.src === `/app-icon-${size}.png`);
      expect(icon).toMatchObject({ sizes: `${size}x${size}`, type: 'image/png' });
      const png = readFileSync(resolve(root, `public/app-icon-${size}.png`));
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
});

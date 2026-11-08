// Production smoke suite. Runs against the live app and writes real data
// (cleaned up per test). Credentials come only from the environment:
//   E2E_EMAIL, E2E_PASSWORD             (required)
//   E2E_COACH_EMAIL, E2E_COACH_PASSWORD (coach-link test only)
// Missing keys are filled from .env (only E2E_* keys; values never printed).
// Override the file with E2E_ENV_FILE. Run with: npm run test:e2e:prod
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

const envFile = process.env.E2E_ENV_FILE || path.resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(dotenv.parse(readFileSync(envFile)))) {
    if (key.startsWith('E2E_') && !(key in process.env)) process.env[key] = value;
  }
}
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
  // Loud, not silent: every prod test will be reported as skipped.
  console.warn(`\n[prod e2e] E2E_EMAIL / E2E_PASSWORD missing (env and ${envFile}). All production tests will SKIP.\n`);
}

export default defineConfig({
  testDir: './e2e/prod',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results/prod',
  use: {
    baseURL: process.env.E2E_PROD_URL || 'https://app.goatedmethod.me',
    trace: 'off',
    serviceWorkers: 'block',
    // Screenshots of a signed-in production account may contain personal data.
    screenshot: 'off',
  },
});

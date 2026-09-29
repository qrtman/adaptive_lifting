import { generateKeyPairSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

process.env.E2E_TEST_DATABASE = path.join(os.tmpdir(), 'adaptive-email-verification-e2e.sqlite');
process.env.APP_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.DATABASE_URL = `sqlite:///${process.env.E2E_TEST_DATABASE.replace(/\\/g, '/')}`;
process.env.EMAIL_PROVIDER = 'fake';
process.env.EMAIL_FROM = 'Adaptive Lifting <verify@example.test>';
process.env.EMAIL_VERIFICATION_NEW_ACCOUNTS = 'true';
process.env.EMAIL_VERIFICATION_ENFORCE_LEGACY = 'false';
process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.JWT_SECRET_CURRENT = 'isolated-playwright-verification-jwt-secret';
process.env.CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:3011';
process.env.APP_URL = 'http://127.0.0.1:3011';
if (!process.env.E2E_OFFLINE_AUTH_PRIVATE_KEY) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'der' } });
  process.env.E2E_OFFLINE_AUTH_PRIVATE_KEY = pair.privateKey;
  process.env.E2E_OFFLINE_AUTH_PUBLIC_KEY = pair.publicKey.toString('base64');
}
process.env.OFFLINE_AUTH_PRIVATE_KEY = process.env.E2E_OFFLINE_AUTH_PRIVATE_KEY;
process.env.VITE_OFFLINE_AUTH_PUBLIC_KEY = process.env.E2E_OFFLINE_AUTH_PUBLIC_KEY;
process.env.E2E_BASE_URL = 'http://127.0.0.1:3011';
process.env.E2E_API_URL = 'http://127.0.0.1:8123';
const python = path.resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3011', trace: 'off', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: `"${python}" scripts/email_verification_test_server.py`, url: 'http://127.0.0.1:8123/api/health', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3011 --strictPort', url: 'http://127.0.0.1:3011', reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8123', VITE_BACKEND_URL: '' } },
  ],
});

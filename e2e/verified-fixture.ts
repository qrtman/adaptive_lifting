import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';

export const apiUrl = process.env.E2E_API_URL || 'http://localhost:8000';
function fixture(input: unknown) {
  const python = path.resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const result = spawnSync(python, ['scripts/email_verification_test_fixture.py'], {
    input: JSON.stringify(input), encoding: 'utf8', env: process.env,
  });
  if (result.status !== 0) throw new Error('Isolated email verification test fixture failed. Run with playwright.verification.config.ts.');
  return result.stdout.trim();
}
export function verificationToken(email: string) { return fixture({ action: 'token', email }); }
export async function registerVerified(request: APIRequestContext, options: { data: { email: string; password: string; role?: string } }) {
  fixture({ action: 'register', data: options.data });
  return request.post(`${apiUrl}/api/auth/login`, { form: { username: options.data.email, password: options.data.password } });
}

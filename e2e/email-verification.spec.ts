import { expect, test } from '@playwright/test';
import { apiUrl, registerVerified, verificationToken } from './verified-fixture';

test('registration, explicit POST verification, login and reload', async ({ page, request, context }) => {
  const email = `verify-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill('password123');
  await page.getByPlaceholder('Confirm password').fill('password123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect((await context.cookies()).some(cookie => cookie.name === 'session_id')).toBe(false);
  const login = await request.post(`${apiUrl}/api/auth/login`, { form: { username: email, password: 'password123' } });
  expect((await login.json()).detail.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  const raw = verificationToken(email);
  const tab = await context.newPage();
  let posts = 0;
  tab.on('request', req => { if (req.url().includes('/api/auth/verify-email') && req.method() === 'POST') posts++; });
  await tab.goto(`/verify-email#token=${raw}`);
  await expect(tab).toHaveURL(/\/verify-email$/);
  await expect(tab.getByRole('button', { name: 'Confirm email address' })).toBeVisible();
  expect(posts).toBe(0);
  await tab.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(tab.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  expect(posts).toBe(1);
  expect((await context.cookies()).some(cookie => cookie.name === 'session_id')).toBe(false);
  await tab.getByRole('link', { name: 'Return to sign in' }).click();
  await tab.getByPlaceholder('coach@example.com').fill(email);
  await tab.getByPlaceholder('Password', { exact: true }).fill('password123');
  await tab.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(tab.getByTestId('nav-sessions')).toBeVisible();
  await tab.reload();
  await expect(tab.getByTestId('nav-sessions')).toBeVisible();
});

test('invalid links offer recovery and never establish a session', async ({ page }) => {
  await page.goto('/verify-email#token=invalid');
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Link invalid or expired' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request a new verification email' })).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email$/);
});

test('verification and recovery fit a mobile screen without leaking URL tokens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const outbound: Array<{ url: string; referrer: string }> = [];
  page.on('request', req => outbound.push({ url: req.url(), referrer: req.headers().referer || '' }));
  await page.goto('/verify-email#token=invalid');
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('button', { name: 'Confirm email address' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Link invalid or expired' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email address' }).fill('recovery@example.test');
  await page.getByRole('button', { name: 'Request a new verification email' }).click();
  await expect(page.getByRole('status')).toContainText('If eligible');
  expect(outbound.every(req => !req.url.includes('token=') && !req.referrer.includes('token='))).toBe(true);
});

test('cached profile fields cannot open protected UI', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('al_user_id', 'pending-user'); localStorage.setItem('al_role', 'ATHLETE');
    localStorage.setItem('al_role_mode', 'athlete');
  });
  await page.goto('/');
  await expect(page.getByTestId('login-card')).toBeVisible();
  await expect(page.getByTestId('nav-sessions')).toHaveCount(0);
});

test('verified athlete can reload a signed cached plan offline', async ({ page, context }) => {
  const email = `offline-reload-${Date.now()}@example.com`;
  const login = await registerVerified(page.request, { data: { email, password: 'password123' } });
  expect(login.ok()).toBeTruthy();
  const session = await page.request.post(`${apiUrl}/api/sessions`, { data: { date: '2026-09-28', title: 'Preserved offline session' } });
  expect(session.ok()).toBeTruthy();
  await page.goto('/#/sessions');
  await expect(page.getByText('Preserved offline session')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByText('Preserved offline session')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    return new Promise<boolean>(resolve => {
      const open = indexedDB.open('adaptive_lifting_db');
      open.onsuccess = () => {
        const request = open.result.transaction('snapshots').objectStore('snapshots').get('auth:offline-grant');
        request.onsuccess = () => { resolve(typeof request.result?.data === 'string'); open.result.close(); };
      };
    });
  })).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('nav-sessions')).toBeVisible();
  await expect(page.getByText('Preserved offline session')).toBeVisible();
});

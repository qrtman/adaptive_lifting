import { expect, test } from '@playwright/test';

test('login screen shows Adaptive Lifting', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Adaptive Lifting' })).toBeVisible();
});

test('sidebar has Sign out and no Reset plan', async ({ page, request }) => {
  const email = `no-reset-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('nav-sessions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset plan' })).toHaveCount(0);
  await expect(page.getByText('Reset plan')).toHaveCount(0);
});

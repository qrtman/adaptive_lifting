import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('clicking a calendar day opens the session', async ({ page, request }) => {
  const email = `cal-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible();

  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.getByTestId('calendar-day-2026-09-04').click();

  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page.getByTestId('add-lift-squat')).toBeVisible();
  await expect(page.getByText('Focus brace and bar path')).toHaveCount(0);
  await expect(page.getByText('Open logger')).toHaveCount(0);
});

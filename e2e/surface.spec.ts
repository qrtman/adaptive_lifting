import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('calendar deep link opens inspector; keyboard create stays on calendar', async ({ page, request }) => {
  const email = `surface-${Date.now()}@example.com`;
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
  await expect(page.getByTestId('month-calendar')).toBeVisible();

  const day = page.getByTestId('calendar-day-2026-09-14');
  await day.click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-title').fill('Surface day');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-inspector')).toBeVisible();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page).toHaveURL(/session=/);

  const hash = await page.evaluate(() => window.location.hash);
  const sessionId = new URLSearchParams(hash.split('?')[1] || '').get('session');
  expect(sessionId).toBeTruthy();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('session-inspector')).toHaveCount(0);

  await page.goto(`/#/calendar?session=${sessionId}`);
  await expect(page.getByTestId('session-inspector')).toBeVisible();
  await expect(page.getByTestId('session-name')).toContainText('Surface day');
});

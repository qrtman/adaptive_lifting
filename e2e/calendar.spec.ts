import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('hover New session opens a dialog; cancel creates nothing', async ({ page, request }) => {
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
  await page.getByTestId('calendar-day-2026-09-04').hover();
  await page.getByTestId('calendar-new-session-2026-09-04').click({ force: true });
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-cancel').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-empty-lifts')).toHaveCount(0);

  await page.getByTestId('calendar-new-session-2026-09-04').click({ force: true });
  await page.getByTestId('new-session-title').fill('Meet day');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
});

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
  const day = page.getByTestId('calendar-day-2026-09-04');
  await day.hover();
  const newSession = page.getByTestId('calendar-new-session-2026-09-04');
  await expect(newSession).toBeVisible();
  await newSession.click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-cancel').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-empty-lifts')).toHaveCount(0);

  await day.hover();
  await newSession.click();
  await page.getByTestId('new-session-title').fill('Meet day');
  await page.getByTestId('new-session-block').fill('Hypertrophy');
  await page.getByTestId('new-session-week').fill('Week1');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
  await expect(page.getByTestId('session-block')).toHaveValue('Hypertrophy');
  await expect(page.getByTestId('session-week')).toHaveValue('Week1');
  await page.getByRole('button', { name: 'Back' }).click();
  await day.hover();
  await expect(page.getByRole('button', { name: 'Copy to' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy to' }).click();
  await expect(page.getByTestId('copy-to-banner')).toBeVisible();
  await page.getByTestId('calendar-day-2026-09-11').click();
  await expect(page.getByTestId('copy-to-banner')).toHaveCount(0);
  const copiedCard = page.getByTestId('calendar-day-2026-09-11').locator('[data-testid^="workout-card-"]');
  await expect(copiedCard).toHaveCount(1);
  await expect(copiedCard).toContainText('Hypertrophy · Week1');

  await copiedCard.click();
  await expect(page.getByTestId('session-block')).toHaveValue('Hypertrophy');
  await page.getByTestId('session-block').fill('Meet');
  await page.getByTestId('session-block').blur();
  await page.getByTestId('session-week').fill('Week2');
  await page.getByTestId('session-week').blur();
  await expect(page.getByTestId('session-block')).toHaveValue('Meet');
  await expect(page.getByTestId('session-week')).toHaveValue('Week2');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(copiedCard).toContainText('Meet · Week2');
});

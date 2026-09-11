import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('moves a lift up and keeps the order after reload', async ({ page, request }) => {
  const email = `reorder-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();

  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.locator('input[type="date"]').fill('2026-09-12');
  await page.locator('label:has-text("Title") input').fill('Reorder day');
  await page.getByTestId('sessions-add').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await page.getByTestId('add-lift-squat').click();
  await expect(page.getByRole('heading', { name: 'Squat' })).toBeVisible();
  await page.getByTestId('add-lift-bench').click();
  await expect(page.getByRole('heading', { name: 'Bench' })).toBeVisible();
  await page.getByTestId('add-lift-deadlift').click();
  await expect(page.getByRole('heading', { name: 'Deadlift' })).toBeVisible();

  const liftHeadings = page.locator('.border-b.border-white\\/10 h4');
  await expect(liftHeadings).toHaveText(['Squat', 'Bench', 'Deadlift']);

  const moved = page.waitForResponse((res) =>
    res.url().includes('/exercises/') && res.request().method() === 'PATCH'
  );
  await page.getByRole('heading', { name: 'Bench', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"border-b")][1]')
    .getByRole('button', { name: 'Up', exact: true })
    .click();
  expect((await moved).ok()).toBeTruthy();
  await expect(liftHeadings).toHaveText(['Bench', 'Squat', 'Deadlift']);

  await page.reload();
  await expect(page.locator('.border-b.border-white\\/10 h4')).toHaveText(['Bench', 'Squat', 'Deadlift']);

  await page.getByTestId('session-complete').click();
  await page.locator('[data-testid^="sessions-card-"] button').first().click();
  await expect(page.getByTestId('session-open')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Up', exact: true }).first()).toBeDisabled();
});

import { expect, test, type Locator } from '@playwright/test';
import { fillEditableCell } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

async function typeCell(cell: Locator, value: string) {
  await cell.page().keyboard.press('Escape');
  await fillEditableCell(cell, value);
  await cell.blur();
}

test('LOG e1RM: 150×6 @5 is 200, @4 equals @5, empty RPE is load', async ({ page, request }) => {
  const email = `e1rm-floor-${Date.now()}@example.com`;
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
  await page.getByTestId('sessions-add').click();
  await page.getByTestId('new-session-date').fill('2026-09-12');
  await page.getByTestId('new-session-title').fill('e1RM RPE floor');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '150');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '6');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '5');

  const e1rm = page.locator('[data-testid^="set-e1rm-"]').first();
  await expect(e1rm).toHaveText('200');
  expect(await e1rm.innerText()).not.toBe('150');
  const atFive = (await e1rm.innerText()).trim();

  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '4');
  await expect(e1rm).toHaveText(atFive);

  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '');
  await expect(e1rm).toHaveText('150');
});

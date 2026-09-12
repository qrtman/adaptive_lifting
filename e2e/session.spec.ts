import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('plans typed kg, suggests later kg after a log, then stays editable after Complete', async ({ page, request }) => {
  const email = `plan-log-${Date.now()}@example.com`;
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
  await page.getByTestId('new-session-title').fill('Plan log day');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-exercise').selectOption('Squat');
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  await expect(page.getByRole('columnheader', { name: /Plan/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Log/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Rx/ })).toHaveCount(0);

  await page.getByTestId('rx-weight').first().click();
  await page.getByTestId('rx-weight').first().fill('180');
  await page.getByTestId('rx-weight').first().press('Enter');
  await expect(page.getByTestId('rx-weight').first()).toHaveText('180');

  await page.getByRole('button', { name: '+ Set' }).click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);

  await page.locator('[data-testid$="-actual-weight"]').first().click();
  await page.locator('[data-testid$="-actual-weight"]').first().fill('180');
  await page.locator('[data-testid$="-actual-weight"]').first().press('Enter');
  await page.locator('[data-testid$="-reps"]').first().click();
  await page.locator('[data-testid$="-reps"]').first().fill('5');
  await page.locator('[data-testid$="-reps"]').first().press('Enter');
  await page.locator('[data-testid$="-executedRpe"]').first().click();
  await page.locator('[data-testid$="-executedRpe"]').first().fill('9');
  await page.locator('[data-testid$="-executedRpe"]').first().press('Enter');

  const suggest = page.getByTestId('plan-suggest');
  await expect(suggest).toBeVisible();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  const suggested = (await suggest.innerText()).replace('use ', '').trim();
  expect(Number(suggested)).toBeGreaterThan(0);
  expect(Number(suggested)).toBeLessThan(180);
  await suggest.click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText(suggested);
  await expect(suggest).toHaveCount(0);

  await page.getByTestId('session-complete').click();
  await page.locator('[data-testid^="sessions-card-"] button').first().click();
  await expect(page.getByTestId('session-open')).toHaveCount(0);
  await expect(page.getByTestId('workout-lock-banner')).toHaveCount(0);
  await expect(page.getByText(/SESSION LOCKED/i)).toHaveCount(0);
  await expect(page.getByTestId('session-complete')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Set' })).toBeVisible();
  await page.getByRole('button', { name: '+ Set' }).click();
  const extraPlan = page.getByTestId('rx-weight').nth(2);
  await extraPlan.click();
  await extraPlan.fill('175');
  await extraPlan.press('Enter');
  await expect(extraPlan).toHaveText('175');
});

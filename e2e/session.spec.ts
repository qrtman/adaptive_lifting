import { expect, test, type Locator } from '@playwright/test';
import { fillEditableCell } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

async function typeCell(cell: Locator, value: string) {
  await cell.page().keyboard.press('Escape');
  await fillEditableCell(cell, value);
  await cell.blur();
}

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
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();
  const liftRow = page.getByRole('heading', { name: 'Squat', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
  await expect(liftRow.locator('select[data-testid^="movement-pattern-"]')).toHaveCount(0);
  await expect(liftRow.getByTestId(/^movement-pattern-label-/)).toHaveText('Knee Dominant');
  await page.getByTestId(/^edit-lift-/).first().click();
  await expect(page.getByTestId('edit-lift-dialog')).toBeVisible();
  const pattern = page.getByTestId(/^movement-pattern-edit-/);
  await expect(pattern).toHaveValue('Knee Dominant');
  await pattern.selectOption('Hip Dominant');
  await expect(pattern).toHaveValue('Hip Dominant');
  await page.getByTestId('edit-lift-done').click();
  await expect(page.getByTestId('edit-lift-dialog')).toHaveCount(0);
  await expect(liftRow.getByTestId(/^movement-pattern-label-/)).toHaveText('Hip Dominant');
  await expect(liftRow.locator('select[data-testid^="movement-pattern-"]')).toHaveCount(0);

  await expect(page.getByRole('columnheader', { name: /Plan/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Log/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Rx/ })).toHaveCount(0);

  await typeCell(page.getByTestId('rx-weight').first(), '180');
  await expect(page.getByTestId('rx-weight').first()).toHaveText('180');

  await page.getByRole('button', { name: '+ Set' }).click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);

  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '180');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '5');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '9');

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
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
  await page.locator('[data-testid^="sessions-card-"] button').first().click();
  await expect(page.getByTestId('session-open')).toHaveCount(0);
  await expect(page.getByTestId('workout-lock-banner')).toHaveCount(0);
  await expect(page.getByText(/SESSION LOCKED/i)).toHaveCount(0);
  await expect(page.getByTestId('session-complete')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Set' })).toBeVisible();
  const firstPlan = page.getByTestId('rx-weight').first();
  await typeCell(firstPlan, '175');
  await expect(firstPlan).toHaveText('175');
  const planCount = await page.getByTestId('rx-weight').count();
  await page.getByRole('button', { name: '+ Set' }).click();
  await expect(page.getByTestId('rx-weight')).toHaveCount(planCount + 1);
});

test('offers plan kg update after a log when later plan kg is already filled', async ({ page, request }) => {
  const email = `plan-suggest-filled-${Date.now()}@example.com`;
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
  await page.getByTestId('new-session-date').fill('2026-09-13');
  await page.getByTestId('new-session-title').fill('Plan kg update offer');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  await typeCell(page.getByTestId('rx-weight').first(), '180');
  await page.getByRole('button', { name: '+ Set' }).click();
  await typeCell(page.getByTestId('rx-weight').nth(1), '180');
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('180');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);

  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '180');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '5');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '9');

  const suggest = page.getByTestId('plan-suggest');
  await expect(suggest).toBeVisible();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('180');
  const suggested = (await suggest.innerText()).replace('use ', '').trim();
  expect(Number(suggested)).toBeGreaterThan(0);
  expect(Number(suggested)).not.toBe(180);
  await suggest.click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText(suggested);
  await expect(suggest).toHaveCount(0);

  await page.getByRole('button', { name: '+ Set' }).click();
  await typeCell(page.getByTestId('rx-weight').nth(2), '175');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(1);
  await expect(page.getByTestId('rx-weight').nth(2)).toHaveText('175');
  await typeCell(page.locator('[data-testid$="-actual-weight"]').nth(2), '170');
  await expect(page.getByTestId('rx-weight').nth(2)).toHaveText('175');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);
});

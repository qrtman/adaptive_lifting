import { expect, test, type Locator } from '@playwright/test';
import { fillEditableCell, pickComboOption } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

async function typeCell(cell: Locator, value: string) {
  await cell.page().keyboard.press('Escape');
  await fillEditableCell(cell, value);
  await cell.blur();
}

test('Sessions cards lead with Name and show every set as Plan vs Log', async ({ page, request }) => {
  const email = `sessions-list-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('nav-sessions')).toBeVisible();
  await page.getByTestId('nav-sessions').click();

  await page.getByTestId('sessions-add').click();
  await page.getByTestId('new-session-date').fill('2026-09-01');
  await page.getByTestId('new-session-title').fill('Lower');
  await pickComboOption(page, 'new-session-day', 'Day 1');
  await page.getByTestId('new-session-block').fill('1');
  await page.getByTestId('new-session-week').fill('1');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.getByTestId(/sessions-open-/).click();
  await expect(page.getByTestId('add-lift')).toBeVisible();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Hip Dominant');
  await page.getByTestId('add-lift-result-Deadlift').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Deadlift', exact: true })).toBeVisible();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();
  const squatRow = page.getByRole('heading', { name: 'Squat', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"cal-nested-card")][1]');

  await typeCell(squatRow.getByTestId('rx-weight').first(), '150');
  await expect(squatRow.getByTestId('rx-weight').first()).toHaveText('150');
  await typeCell(squatRow.getByTestId('reps').first(), '5');
  await expect(squatRow.getByTestId('reps').first()).toHaveText('5');
  await typeCell(squatRow.getByTestId('targetValue').first(), '6');
  await expect(squatRow.getByTestId('targetValue').first()).toHaveText('6');
  await typeCell(squatRow.locator('[data-testid$="-actual-weight"]').first(), '150');
  await expect(squatRow.locator('[data-testid$="-actual-weight"]').first()).toHaveText('150');
  await typeCell(squatRow.locator('[data-testid$="-reps"]').first(), '5');
  await expect(squatRow.locator('[data-testid$="-reps"]').first()).toHaveText('5');
  await typeCell(squatRow.locator('[data-testid$="-executedRpe"]').first(), '6');
  await expect(squatRow.locator('[data-testid$="-executedRpe"]').first()).toHaveText('6');

  await squatRow.getByRole('button', { name: '+ Set' }).click();
  await typeCell(squatRow.getByTestId('rx-weight').nth(1), '140');
  await expect(squatRow.getByTestId('rx-weight').nth(1)).toHaveText('140');
  await typeCell(squatRow.getByTestId('reps').nth(1), '5');
  await expect(squatRow.getByTestId('reps').nth(1)).toHaveText('5');
  await typeCell(squatRow.getByTestId('targetValue').nth(1), '7');
  await expect(squatRow.getByTestId('targetValue').nth(1)).toHaveText('7');
  await new Promise((resolve) => setTimeout(resolve, 800));

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId(/sessions-open-/)).toContainText('Lower');
  await expect(card.getByTestId(/sessions-open-/)).toContainText('Day 1');
  await expect(card.getByTestId(/sessions-open-/)).toContainText('2026-09-01');
  await expect(card.getByTestId(/sessions-plan-h-/)).toHaveText('Plan');
  await expect(card.getByTestId(/sessions-log-h-/)).toHaveText('Log');
  await expect(card).toContainText('150 × 5 @ 6');
  await expect(card).toContainText('140 × 5 @ 7');
  await expect(card).toContainText('5 @ 8');
  await expect(card).not.toContainText('—×');
  await expect(card).not.toContainText('COMPLETED');
  await expect(card).not.toContainText('0kg');
  const openText = await card.getByTestId(/sessions-open-/).innerText();
  expect(openText.includes('1 · 1')).toBeFalsy();
  const titleStyle = await card.locator('p').first().evaluate((el) => {
    const computed = getComputedStyle(el);
    return { size: parseFloat(computed.fontSize), weight: parseInt(computed.fontWeight, 10) };
  });
  const metaStyle = await card.locator('p').nth(1).evaluate((el) => {
    const computed = getComputedStyle(el);
    return { size: parseFloat(computed.fontSize), weight: parseInt(computed.fontWeight, 10) || 400 };
  });
  expect(titleStyle.size).toBeGreaterThan(metaStyle.size);
  expect(titleStyle.weight).toBeGreaterThan(metaStyle.weight);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByTestId('sidebar-toggle').click();
  await expect(card.getByTestId(/sessions-plan-h-/)).toBeVisible();
  await expect(card.getByTestId(/sessions-log-h-/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow).toBeFalsy();

  await card.getByTestId(/sessions-open-/).click();
  await page.getByTestId('session-complete').click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(card).toContainText('Done');
  await expect(card).toContainText('kg');
  await expect(card).not.toContainText('COMPLETED');
});

import { apiUrl, registerVerified } from './verified-fixture';
import { expect, test } from '@playwright/test';
import { fillEditableCell } from './helpers';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000' });

test('moves a lift up and keeps the order after reload', async ({ page, request }) => {
  const email = `reorder-${Date.now()}@example.com`;
  const register = await registerVerified(request, {
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
  await page.getByTestId('new-session-title').fill('Reorder day');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  const addNamedLift = async (category: string, exercise: string) => {
    await page.getByTestId('add-lift').click();
    await page.getByTestId('movement-pattern-add-lift').selectOption(category);
    await page.getByTestId(`add-lift-result-${exercise}`).click();
    await page.getByTestId('add-lift-confirm').click();
    await expect(page.getByRole('heading', { name: exercise, exact: true })).toBeVisible();
    if (exercise === 'Squat') await page.getByRole('button', { name: 'Expand Squat', exact: true }).click();
  };
  await addNamedLift('Knee Dominant', 'Squat');
  await expect(page.getByTestId('rx-weight').first()).toHaveText('—');
  const savedSets = page.waitForResponse((res) =>
    res.url().includes('/sets') && res.request().method() === 'PUT'
  );
  await page.getByTestId('rx-weight').first().click();
  await fillEditableCell(page.getByTestId('rx-weight').first(), '180');
  await page.getByTestId('rx-weight').first().press('Enter');
  expect((await savedSets).ok()).toBeTruthy();
  await expect(page.getByTestId('rx-weight').first()).toHaveText('180');
  await page.getByRole('button', { name: '+ Plan set' }).click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('lift-constructor')).toHaveCount(0);
  await page.getByTestId(/^edit-lift-/).first().click();
  await expect(page.getByTestId('edit-lift-dialog')).toBeVisible();
  await expect(page.getByTestId('lift-constructor')).toBeVisible();
  await page.getByTestId('edit-lift-done').click();
  await expect(page.getByTestId('edit-lift-dialog')).toHaveCount(0);
  await addNamedLift('Horizontal Push', 'Bench');
  await addNamedLift('Hip Dominant', 'Deadlift');

  const liftHeadings = page.locator('.cal-nested-card h4');
  await expect(liftHeadings).toHaveText(['Squat', 'Bench', 'Deadlift']);

  await page.getByRole('button', { name: 'Minimize Squat', exact: true }).click();
  const benchHandle = page.getByRole('button', { name: 'Reorder Bench', exact: true });
  const squatHandle = page.getByRole('button', { name: 'Reorder Squat', exact: true });
  const source = await benchHandle.boundingBox();
  const target = await squatHandle.boundingBox();
  expect(source && target).toBeTruthy();
  const [moved] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/exercises/') && res.request().method() === 'PATCH'),
    (async () => {
      await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
      await page.mouse.down();
      await page.mouse.move(target!.x + target!.width / 2, target!.y, { steps: 20 });
      await page.mouse.up();
    })(),
  ]);
  expect(moved.ok()).toBeTruthy();
  await expect(liftHeadings).toHaveText(['Bench', 'Squat', 'Deadlift']);

  await page.reload();
  await expect(page.locator('.cal-nested-card h4')).toHaveText(['Bench', 'Squat', 'Deadlift']);
  await page.getByRole('button', { name: 'Expand Squat', exact: true }).click();
  const squatRow = page.getByRole('heading', { name: 'Squat', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"cal-nested-card")][1]');
  await expect(squatRow.getByTestId('rx-weight').first()).toHaveText('180');
  await expect(squatRow.getByTestId('rx-weight').nth(1)).toHaveText('—');

  await page.getByTestId('session-complete').click();
  await page.locator('[data-testid^="sessions-card-"] button').first().click();
  await expect(page.getByTestId('session-open')).toHaveCount(0);
  await expect(page.getByTestId('workout-lock-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reorder Squat', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Expand Squat', exact: true }).click();
  const squatPlan = page.getByRole('heading', { name: 'Squat', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"cal-nested-card")][1]')
    .getByTestId('rx-weight').first();
  await fillEditableCell(squatPlan, '182.5');
  await squatPlan.blur();
  await expect(squatPlan).toHaveText('182.5');
});

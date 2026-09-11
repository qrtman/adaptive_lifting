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
    await page.getByTestId('add-lift-category').selectOption(category);
    await page.getByTestId('add-lift-exercise').selectOption(exercise);
    await page.getByTestId('add-lift-confirm').click();
    await expect(page.getByRole('heading', { name: exercise, exact: true })).toBeVisible();
  };
  await addNamedLift('Knee Dominant', 'Squat');
  await expect(page.getByTestId('rx-weight').first()).toHaveText('—');
  const savedSets = page.waitForResponse((res) =>
    res.url().includes('/sets') && res.request().method() === 'PUT'
  );
  await page.getByTestId('rx-weight').first().click();
  await page.getByTestId('rx-weight').first().fill('180');
  await page.getByTestId('rx-weight').first().press('Enter');
  expect((await savedSets).ok()).toBeTruthy();
  await expect(page.getByTestId('rx-weight').first()).toHaveText('180');
  await page.getByRole('button', { name: '+ Set' }).click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('lift-constructor')).toHaveCount(0);
  await page.getByTestId(/^edit-lift-/).first().click();
  await expect(page.getByTestId('edit-lift-dialog')).toBeVisible();
  await expect(page.getByTestId('lift-constructor')).toBeVisible();
  await page.getByTestId('edit-lift-done').click();
  await expect(page.getByTestId('edit-lift-dialog')).toHaveCount(0);
  await addNamedLift('Horizontal Push', 'Bench');
  await addNamedLift('Hip Dominant', 'Deadlift');

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
  const squatRow = page.getByRole('heading', { name: 'Squat', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
  await expect(squatRow.getByTestId('rx-weight').first()).toHaveText('180');
  await expect(squatRow.getByTestId('rx-weight').nth(1)).toHaveText('—');

  await page.getByTestId('session-complete').click();
  await page.locator('[data-testid^="sessions-card-"] button').first().click();
  await expect(page.getByTestId('session-open')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Up', exact: true }).first()).toBeDisabled();
});

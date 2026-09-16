import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('Sheets-parity: click selects; Tab kg→reps; Enter down same column; PLAN↔LOG arrows', async ({ page, request }) => {
  const email = `sheets-cell-${Date.now()}@example.com`;
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
  await page.getByTestId('new-session-title').fill('Sheets cell edit');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '+ Set' }).click();
  await expect(page.getByTestId('rx-weight')).toHaveCount(2);

  const planKg0 = page.locator('[data-cell-id$=":0:plan:kg"]');
  const planKg1 = page.locator('[data-cell-id$=":1:plan:kg"]');
  const planReps0 = page.locator('[data-cell-id$=":0:plan:reps"]');
  const planRpe0 = page.locator('[data-cell-id$=":0:plan:rpe"]');
  const logKg0 = page.locator('[data-cell-id$=":0:log:kg"]');
  const logReps0 = page.locator('[data-cell-id$=":0:log:reps"]');
  const copyPlan = page.getByTitle('Copy plan to log').first();

  // 1. Click plan kg → not an input; type 180; Enter → next set same column selected
  await planKg0.click();
  await expect(planKg0).not.toBeEditable();
  await expect(planKg0).toHaveAttribute('data-grid-mode', 'selected');
  await page.keyboard.type('180');
  await expect(planKg0).toBeEditable();
  await expect(planKg0).toHaveValue('180');
  await planKg0.press('Enter');
  await expect(planKg0).toHaveText('180');
  await expect(planKg0).not.toBeEditable();
  await expect(planKg1).toHaveAttribute('data-grid-mode', 'selected');
  await expect(planKg1).not.toBeEditable();

  // 2. Tab kg→reps→rpe→log kg; never the copy-plan button
  await planKg0.click();
  await expect(planKg0).toHaveAttribute('data-grid-mode', 'selected');
  await planKg0.press('Tab');
  await expect(planReps0).toHaveAttribute('data-grid-mode', 'selected');
  await expect(planReps0).not.toBeEditable();
  await planReps0.press('Tab');
  await expect(planRpe0).toHaveAttribute('data-grid-mode', 'selected');
  await planRpe0.press('Tab');
  await expect(logKg0).toHaveAttribute('data-grid-mode', 'selected');
  await expect(logKg0).not.toBeEditable();
  await expect(copyPlan).not.toBeFocused();

  // 3. Enter from plan kg set 0 (editing) → plan kg set 1
  await planKg0.click();
  await planKg0.press('F2');
  await expect(planKg0).toBeEditable();
  await planKg0.press('Enter');
  await expect(planKg1).toHaveAttribute('data-grid-mode', 'selected');
  await expect(planKg1).not.toBeEditable();

  // 4. Left/Right across PLAN and LOG (skip copy button)
  await planRpe0.click();
  await planRpe0.press('ArrowRight');
  await expect(logKg0).toHaveAttribute('data-grid-mode', 'selected');
  await expect(copyPlan).not.toBeFocused();
  await logKg0.press('ArrowLeft');
  await expect(planRpe0).toHaveAttribute('data-grid-mode', 'selected');

  // 5. F2 on committed plan kg; Escape keeps the value
  await planKg0.click();
  await planKg0.press('F2');
  await expect(planKg0).toBeEditable();
  await expect(planKg0).toHaveValue('180');
  await planKg0.press('Escape');
  await expect(planKg0).toHaveText('180');
  await expect(planKg0).not.toBeEditable();
  await expect(planKg0).toHaveAttribute('data-grid-mode', 'selected');

  // 6. Edit log reps; ArrowLeft at start stays in the input
  await logReps0.click();
  await logReps0.press('F2');
  await logReps0.fill('12');
  await logReps0.press('Home');
  await logReps0.press('ArrowLeft');
  await expect(logReps0).toBeEditable();
  await expect(logReps0).toBeFocused();
  await logReps0.press('Escape');

  // 7. Selected + Backspace on logged kg → —
  await logKg0.click();
  await page.keyboard.type('100');
  await expect(logKg0).toBeEditable();
  await logKg0.press('Enter');
  await expect(logKg0).toHaveText('100');
  await logKg0.click();
  await expect(logKg0).toHaveAttribute('data-grid-mode', 'selected');
  await expect(logKg0).not.toBeEditable();
  await logKg0.press('Backspace');
  await expect(logKg0).toHaveText('—');

  // 8. Enter while selected starts insert-edit and does not move
  await planKg0.click();
  await expect(planKg0).toHaveAttribute('data-grid-mode', 'selected');
  await planKg0.press('Enter');
  await expect(planKg0).toBeEditable();
  await expect(planKg1).not.toHaveAttribute('data-grid-mode', 'selected');
  await planKg0.press('Escape');

  // 9. Enter while editing last-set plan kg stays on last-set plan kg
  await planKg1.click();
  await planKg1.press('F2');
  await expect(planKg1).toBeEditable();
  await planKg1.press('Enter');
  await expect(planKg1).not.toBeEditable();
  await expect(planKg1).toHaveAttribute('data-grid-mode', 'selected');
});

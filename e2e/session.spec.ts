import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectCellSelected, fillEditableCell } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

async function typeCell(cell: Locator, value: string) {
  await cell.page().keyboard.press('Escape');
  await fillEditableCell(cell, value);
  await cell.blur();
}

async function planSuggestionKg(page: Page): Promise<number> {
  return Number(await page.getByTestId('plan-suggestion-value').innerText());
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
    .locator('xpath=ancestor::div[contains(@class,"cal-nested-card")][1]');
  await expect(liftRow.locator('select[data-testid^="movement-pattern-"]')).toHaveCount(1);
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
  await expect(liftRow.locator('select[data-testid^="movement-pattern-"]')).toHaveCount(1);

  await expect(page.getByRole('columnheader', { name: /Plan/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Log/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Rx/ })).toHaveCount(0);

  await typeCell(page.getByTestId('rx-weight').first(), '180');
  await expect(page.getByTestId('rx-weight').first()).toHaveText('180');

  await page.getByRole('button', { name: '+ Plan set' }).click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('reps').nth(1)).toHaveText('—');
  await expect(page.getByTestId('targetValue').nth(1)).toHaveText('—');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);
  await typeCell(page.getByTestId('reps').nth(1), '5');
  await typeCell(page.getByTestId('targetValue').nth(1), '6');

  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '180');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '5');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '9');
  await page.getByTestId('rx-weight').nth(1).click();

  const suggest = page.getByTestId('plan-suggest');
  await expect(suggest).toBeVisible();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  const suggested = await planSuggestionKg(page);
  expect(suggested).toBeGreaterThan(0);
  expect(suggested).toBeLessThan(180);
  await suggest.click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText(String(suggested));
  await expect(suggest).toHaveCount(0);

  await page.getByTestId('session-complete').click();
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
  await page.locator('[data-testid^="sessions-card-"] button').first().click();
  await expect(page.getByTestId('session-open')).toHaveCount(0);
  await expect(page.getByTestId('workout-lock-banner')).toHaveCount(0);
  await expect(page.getByText(/SESSION LOCKED/i)).toHaveCount(0);
  await expect(page.getByTestId('session-complete')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Plan set' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Log set' })).toBeVisible();
  const firstPlan = page.getByTestId('rx-weight').first();
  await typeCell(firstPlan, '175');
  await expect(firstPlan).toHaveText('175');
  const planCount = await page.getByTestId('rx-weight').count();
  await page.getByRole('button', { name: '+ Plan set' }).click();
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
  await page.getByRole('button', { name: '+ Plan set' }).click();
  await typeCell(page.getByTestId('rx-weight').nth(1), '180');
  await typeCell(page.getByTestId('reps').nth(1), '5');
  await typeCell(page.getByTestId('targetValue').nth(1), '6');
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('180');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);

  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '180');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '5');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '9');
  await page.getByTestId('rx-weight').nth(1).click();

  const suggest = page.getByTestId('plan-suggest');
  await expect(suggest).toBeVisible();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('180');
  const suggested = await planSuggestionKg(page);
  expect(suggested).toBeGreaterThan(0);
  expect(suggested).not.toBe(180);
  await suggest.click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText(String(suggested));
  await expect(suggest).toHaveCount(0);

  const logWeightCount = await page.locator('[data-testid$="-actual-weight"]').count();
  await page.getByRole('button', { name: '+ Plan set' }).click();
  await typeCell(page.getByTestId('rx-weight').nth(2), '175');
  await expect(page.getByTestId('rx-weight').nth(2)).toHaveText('175');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);
  await expect(page.locator('[data-testid$="-actual-weight"]')).toHaveCount(logWeightCount);
});

test('set grid headers sit on kg/reps/RPE; Δ% is e1RM percent; Adj is gone', async ({ page, request }) => {
  const email = `set-grid-${Date.now()}@example.com`;
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
  await page.getByTestId('new-session-date').fill('2026-09-14');
  await page.getByTestId('new-session-title').fill('Set grid');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  await expect(page.getByTestId('lift-adj-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adj', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /^Adj$/ })).toHaveCount(0);

  const headers = page.locator('thead th');
  await expect(headers).toHaveCount(16);
  await expect(page.getByTestId('set-grid-h-plan')).toHaveText('Plan');
  await expect(page.getByTestId('set-grid-h-log')).toHaveText('Log');
  await expect(page.getByTestId('set-grid-h-planKg')).toHaveText('kg');
  await expect(page.getByTestId('set-grid-h-planReps')).toHaveText('reps');
  await expect(page.getByTestId('set-grid-h-planTarget')).toHaveText('Target');
  await expect(page.getByTestId('set-grid-h-logKg')).toHaveText('kg');
  await expect(page.getByTestId('set-grid-h-delta')).toHaveText('Δ%');
  await expect(page.getByTestId('set-grid-h-e1rm')).toHaveText('e1RM');
  await expect(page.getByTestId('set-grid-h-inol')).toHaveText('INOL');

  const intensityMode = page.getByTestId('rx-intensity').first();
  await expect(intensityMode).toHaveText('@');
  await intensityMode.click();
  const targetModeMenu = page.getByRole('menu', { name: 'Target mode' });
  await expect(targetModeMenu).toBeVisible();
  await targetModeMenu.getByRole('menuitem', { name: 'Percentage' }).click();
  await expect(intensityMode).toHaveText('%');
  await expect(page.getByLabel('Target %').first()).toBeVisible();
  await intensityMode.click();
  await targetModeMenu.getByRole('menuitem', { name: 'RPE' }).click();
  await expect(intensityMode).toHaveText('@');

  const kgHeaderBox = await page.getByTestId('set-grid-h-planKg').boundingBox();
  const kgCellBox = await page.getByTestId('rx-weight').first().boundingBox();
  expect(kgHeaderBox && kgCellBox).toBeTruthy();
  expect(Math.abs(kgHeaderBox!.x - kgCellBox!.x)).toBeLessThan(24);

  const table = page.getByTestId('set-grid');
  await expect(table.getByText('×', { exact: true })).toHaveCount(0);

  await typeCell(page.getByTestId('rx-weight').first(), '150');
  await typeCell(page.getByTestId('reps').first(), '5');
  await typeCell(page.getByTestId('targetValue').first(), '6');
  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '150');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '5');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '6');

  const delta = page.getByTestId(/^set-e1rm-delta-/);
  await expect(delta).toHaveText('0%');
  await expect(delta).not.toContainText('r');

  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '7');
  await expect(delta).toHaveText('-4%');

  await page.getByRole('button', { name: '+ Plan set' }).click();
  await typeCell(page.getByTestId('reps').nth(1), '5');
  await typeCell(page.getByTestId('targetValue').nth(1), '6');
  await page.getByTestId('rx-weight').nth(1).click();
  await expect(page.getByTestId('plan-suggest')).toBeVisible();
  await expect(page.getByTestId('set-drop-pct')).toHaveCount(1);
});

test('set % column on later sets scales use {n} without writing Plan kg', async ({ page, request }) => {
  const email = `set-pct-${Date.now()}@example.com`;
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
  await page.getByTestId('new-session-date').fill('2026-09-17');
  await page.getByTestId('new-session-title').fill('Set pct column');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  const headers = page.locator('thead th');
  await expect(headers).toHaveCount(16);
  await expect(headers.nth(0)).toHaveText('#');
  await expect(headers.nth(1)).toHaveText('%');
  await expect(headers.nth(2)).toContainText('Plan');
  await expect(page.getByRole('button', { name: 'Adj', exact: true })).toHaveCount(0);

  const waitForSetsPut = () => page.waitForResponse((response) => (
    response.url().includes('/exercises/')
    && response.url().includes('/sets')
    && response.request().method() === 'PUT'
  ));

  const firstSave = waitForSetsPut();
  await typeCell(page.getByTestId('rx-weight').first(), '200');
  await firstSave;
  const addedSave = waitForSetsPut();
  await page.getByRole('button', { name: '+ Plan set' }).click();
  await addedSave;
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await typeCell(page.getByTestId('reps').nth(1), '5');
  await typeCell(page.getByTestId('targetValue').nth(1), '6');

  const firstPctCell = page.locator('tbody tr').nth(0).locator('td').nth(1);
  await expect(firstPctCell).toHaveText('—');
  await expect(firstPctCell.locator('[data-testid="set-drop-pct"]')).toHaveCount(0);
  await expect(page.getByTestId('set-drop-pct')).toHaveCount(1);
  await expect(page.getByTestId('set-drop-pct-dec')).toHaveCount(0);
  await expect(page.getByTestId('set-drop-pct-inc')).toHaveCount(0);

  const laterPct = page.getByTestId('set-drop-pct');
  await expect(laterPct).toHaveAttribute('tabindex', '-1');
  await expect(laterPct).toHaveValue('');
  const laterPctCell = page.locator('tbody tr').nth(1).locator('td').nth(1);
  await expect(laterPctCell).not.toContainText('%');

  const saved = waitForSetsPut();
  await laterPct.fill('-5');
  await laterPct.blur();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  const payload = await saved.then((response) => response.json());
  const written = payload.sets.find((row: { dropPercent?: number }) => row.dropPercent === -5);
  expect(written).toBeTruthy();
  expect(written.plannedWeight == null || written.plannedWeight === 0).toBeTruthy();

  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '200');
  await typeCell(page.locator('[data-testid$="-reps"]').first(), '5');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '9');
  await page.getByTestId('rx-weight').nth(1).click();
  const suggest = page.getByTestId('plan-suggest');
  await expect(suggest).toBeVisible();
  const scaled = await planSuggestionKg(page);
  expect(scaled).toBeGreaterThan(0);

  await laterPct.fill('0');
  await laterPct.blur();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('plan-suggestion-value')).not.toHaveText(String(scaled));
  const unscaled = await planSuggestionKg(page);
  expect(unscaled).toBeGreaterThan(0);
  const expectedScaled = Math.round((unscaled * 0.95) / 2.5) * 2.5;
  await laterPct.fill('-5');
  await laterPct.blur();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText('—');
  await expect(page.getByTestId('plan-suggestion-value')).toHaveText(String(expectedScaled));
  await expect(laterPct).toHaveValue('-5');
  await expect(laterPctCell).not.toContainText('%');

  await page.getByTestId('plan-suggest').click();
  await expect(page.getByTestId('rx-weight').nth(1)).toHaveText(String(expectedScaled));
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);

  const logWeightCount = await page.locator('[data-testid$="-actual-weight"]').count();
  await page.getByRole('button', { name: '+ Plan set' }).click();
  await typeCell(page.getByTestId('rx-weight').nth(2), '175');
  await expect(page.getByTestId('rx-weight').nth(2)).toHaveText('175');
  await expect(page.getByTestId('plan-suggest')).toHaveCount(0);
  await expect(page.locator('[data-testid$="-actual-weight"]')).toHaveCount(logWeightCount);
  await page.getByTestId('set-drop-pct').nth(1).fill('-10');
  await page.getByTestId('set-drop-pct').nth(1).blur();
  await expect(page.getByTestId('rx-weight').nth(2)).toHaveText('175');
  await expect(page.getByTestId('set-drop-pct').nth(1)).toHaveValue('-10');

  const planKg0 = page.locator('[data-cell-id$=":0:plan:kg"]');
  const planReps0 = page.locator('[data-cell-id$=":0:plan:reps"]');
  await planKg0.click();
  await expectCellSelected(planKg0);
  await planKg0.press('Tab');
  await expectCellSelected(planReps0);
});

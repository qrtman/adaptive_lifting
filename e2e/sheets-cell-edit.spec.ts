import { apiUrl, registerVerified } from './verified-fixture';
import { expect, test } from '@playwright/test';
import { expectCellEditing, expectCellSelected, pinCalendarClock } from './helpers';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000' });

test.beforeEach(async ({ page }) => {
  await pinCalendarClock(page);
});

test('Sheets-parity: click selects; Tab kg→reps; Enter down same column; PLAN↔LOG arrows', async ({ page, request }) => {
  const email = `sheets-cell-${Date.now()}@example.com`;
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
  await page.getByTestId('new-session-title').fill('Sheets cell edit');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-pattern-Knee Dominant').click();
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Squat', exact: true }).click();

  await page.getByRole('button', { name: '+ Plan set' }).click();
  await expect(page.getByTestId('rx-weight')).toHaveCount(2);

  await expect(page.getByRole('columnheader', { name: /^Drop %$/ })).toBeVisible();
  await expect(page.getByTestId('set-grid-h-plan')).toBeVisible();
  await expect(page.getByTestId('set-grid-h-planKg')).toBeVisible();
  await expect(page.getByTestId('set-grid-h-delta')).toHaveText('Δ%');
  await expect(page.getByTestId('set-grid').getByText('×', { exact: true })).toHaveCount(0);
  // RPE labels are target-mode buttons, never separators between numeric cells.
  const modeLabels = page.getByTestId('set-grid').locator('tbody').getByText('RPE', { exact: true });
  await expect(modeLabels).toHaveCount(2);
  expect(await modeLabels.evaluateAll((nodes) => nodes.every((node) => node.tagName === 'BUTTON' && node.getAttribute('data-testid') === 'rx-intensity'))).toBeTruthy();
  await expect(page.locator('tbody tr').nth(0).locator('[data-testid="set-drop-pct"]')).toHaveCount(0);
  // The selected adjustment display is focusable, but it is not a seventh
  // editable input in the Sheets keyboard sequence checked below.
  await expect(page.getByTestId('set-drop-pct').first()).toHaveAttribute('tabindex', /-1|0/);
  await expect(page.getByTestId('set-drop-pct-dec')).toHaveCount(0);
  await expect(page.getByTestId('set-drop-pct-inc')).toHaveCount(0);

  const planKg0 = page.locator('[data-cell-id$=":0:plan:kg"]');
  const planKg1 = page.locator('[data-cell-id$=":1:plan:kg"]');
  const planReps0 = page.locator('[data-cell-id$=":0:plan:reps"]');
  const planRpe0 = page.locator('[data-cell-id$=":0:plan:rpe"]');
  const logKg0 = page.locator('[data-cell-id$=":0:log:kg"]');
  const logReps0 = page.locator('[data-cell-id$=":0:log:reps"]');
  const copyPlan = page.getByTitle('Copy plan to log').first();

  await expect(planKg0).toHaveAttribute('data-cell-id', /:0:plan:kg$/);
  await expect(planKg1).toHaveAttribute('data-cell-id', /:1:plan:kg$/);

  // 1. Click plan kg → not an input; type 180; Enter → next set same column selected
  await planKg0.click();
  await expectCellSelected(planKg0);
  await page.keyboard.type('180');
  await expectCellEditing(planKg0);
  await expect(planKg0).toHaveValue('180');
  await planKg0.press('Enter');
  await expect(planKg0).toHaveText('180');
  await expectCellSelected(planKg1);
  await expect(planKg1).toHaveAttribute('data-cell-id', /:1:plan:kg$/);

  // 2. Tab kg→reps→rpe→log kg; never the copy-plan button
  await planKg0.click();
  await expectCellSelected(planKg0);
  await planKg0.press('Tab');
  await expectCellSelected(planReps0);
  await expect(planReps0).toHaveAttribute('data-testid', 'reps');
  await planReps0.press('Tab');
  await expectCellSelected(planRpe0);
  await planRpe0.press('Tab');
  await expectCellSelected(logKg0);
  await expect(logKg0).toHaveAttribute('data-testid', /actual-weight$/);
  await expect(copyPlan).not.toBeFocused();

  // 3. Enter from plan kg set 0 (editing) → plan kg set 1
  await planKg0.click();
  await planKg0.press('F2');
  await expectCellEditing(planKg0);
  await planKg0.press('Enter');
  await expectCellSelected(planKg1);

  // 4. Left/Right across PLAN and LOG (skip copy button)
  await planRpe0.click();
  await planRpe0.press('ArrowRight');
  await expectCellSelected(logKg0);
  await expect(copyPlan).not.toBeFocused();
  await logKg0.press('ArrowLeft');
  await expectCellSelected(planRpe0);

  // 5. F2 on committed plan kg; Escape keeps the value
  await planKg0.click();
  await planKg0.press('F2');
  await expectCellEditing(planKg0);
  await expect(planKg0).toHaveValue('180');
  await planKg0.press('Escape');
  await expect(planKg0).toHaveText('180');
  await expectCellSelected(planKg0);

  // 6. Edit log reps; ArrowLeft at start stays in the input
  await logReps0.click();
  await logReps0.press('F2');
  await logReps0.fill('12');
  await logReps0.press('Home');
  await logReps0.press('ArrowLeft');
  await expectCellEditing(logReps0);
  await expect(logReps0).toBeFocused();
  await logReps0.press('Escape');

  // 7. Selected + Backspace on logged kg → —
  await logKg0.click();
  await page.keyboard.type('100');
  await expectCellEditing(logKg0);
  await logKg0.press('Enter');
  await expect(logKg0).toHaveText('100');
  await logKg0.click();
  await expectCellSelected(logKg0);
  await logKg0.press('Backspace');
  await expect(logKg0).toHaveText('');

  // 8. Enter while selected starts insert-edit and does not move
  await planKg0.click();
  await expectCellSelected(planKg0);
  await planKg0.press('Enter');
  await expectCellEditing(planKg0);
  await expect(planKg1).not.toHaveAttribute('data-grid-mode', 'selected');
  await planKg0.press('Escape');

  // 9. Enter while editing last-set plan kg stays on last-set plan kg
  await planKg1.click();
  await planKg1.press('F2');
  await expectCellEditing(planKg1);
  await planKg1.press('Enter');
  await expectCellSelected(planKg1);
  await expect(page.locator('[data-cell-id$=":0:plan:kg"]')).toHaveCount(1);
  await expect(page.locator('[data-cell-id$=":0:plan:reps"]')).toHaveCount(1);
  await expect(page.locator('[data-cell-id$=":0:plan:rpe"]')).toHaveCount(1);
  await expect(page.locator('[data-cell-id$=":0:log:kg"]')).toHaveCount(1);
  await expect(page.locator('[data-cell-id$=":0:log:reps"]')).toHaveCount(1);
  await expect(page.locator('[data-cell-id$=":0:log:rpe"]')).toHaveCount(1);
  await expect(page.locator('[data-cell-id*=":drop:"]')).toHaveCount(0);
});

test('Sheets ranges: paste TSV, drag-select, clear, undo, fill down, Delete set', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const email = `sheets-range-${Date.now()}@example.com`;
  const register = await registerVerified(request, {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.getByTestId('sessions-add').click();
  await page.getByTestId('new-session-date').fill('2026-09-12');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();
  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-pattern-Knee Dominant').click();
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await page.getByRole('button', { name: 'Expand Squat', exact: true }).click();
  await page.getByRole('button', { name: '+ Plan set' }).click();
  await page.getByRole('button', { name: '+ Plan set' }).click();
  const planKg = (row: number) => page.locator(`[data-cell-id$=":${row}:plan:kg"]`);
  const planReps = (row: number) => page.locator(`[data-cell-id$=":${row}:plan:reps"]`);
  await expect(planKg(2)).toBeVisible();

  // Paste 4 rows into 3: clipped, then "Add 1 set" pastes the rest.
  await planKg(0).click();
  await page.evaluate(() => navigator.clipboard.writeText('100\t5\t8\r\n110\t5\t8\r\n120\t3\t9\r\n130\t2\t9,5\r\n'));
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-testid^="set-grid-notice-"]').first()).toContainText('Pasted 3 of 4 rows.');
  await page.locator('[data-testid^="set-grid-notice-action-"]').click();
  await expect(planKg(3)).toHaveText('130');

  // Drag-select kg+reps of rows 1–3, copy as TSV.
  const a = (await planKg(0).boundingBox())!;
  const b = (await planReps(2).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-in-range="true"]')).toHaveCount(5);
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('100\t5\n110\t5\n120\t3');

  // Clear the range (rows stay), then undo.
  await page.keyboard.press('Delete');
  await expect(planKg(0)).toHaveText('');
  await expect(planKg(3)).toHaveText('130');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(planKg(0)).toHaveText('100');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-in-range="true"]')).toHaveCount(0);

  // Fill down reps from row 1 with Shift+Arrows + Ctrl+D.
  await planReps(0).click();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(planReps(3)).toHaveText('5');

  // One Delete set per row.
  await expect(page.locator('[aria-label^="Delete plan set"], [aria-label^="Delete log set"]')).toHaveCount(0);
  await page.locator('tbody tr').nth(3).hover();
  await page.getByRole('button', { name: 'Delete set 4' }).click();
  await expect(planKg(3)).toHaveCount(0);
});

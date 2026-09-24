import { expect, test, type Locator } from '@playwright/test';
import { fillEditableCell, pickComboOption } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

test('empty athlete plan shows an addable empty state', async ({ page, request }) => {
  const email = `sessions-empty-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('nav-sessions').click();
  await expect(page.getByTestId('sessions-show-accessories')).not.toBeChecked();
  await expect(page.getByTestId('sessions-empty')).toContainText('No sessions yet');
  await expect(page.locator('[data-testid^="sessions-week-board-"]')).toHaveCount(0);
  await expect(page.getByTestId('sessions-add')).toBeVisible();
});

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
  await page.getByTestId('add-lift-result-Deadlift').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Competition Deadlift', exact: true })).toBeVisible();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Competition Squat', exact: true })).toBeVisible();
  const squatRow = page.getByRole('heading', { name: 'Competition Squat', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"cal-nested-card")][1]');
  await squatRow.getByRole('button', { name: 'Expand Competition Squat' }).click();

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

  await squatRow.getByRole('button', { name: '+ Plan set' }).click();
  await typeCell(squatRow.getByTestId('rx-weight').nth(1), '140');
  await expect(squatRow.getByTestId('rx-weight').nth(1)).toHaveText('140');
  await typeCell(squatRow.getByTestId('reps').nth(1), '5');
  await expect(squatRow.getByTestId('reps').nth(1)).toHaveText('5');
  await typeCell(squatRow.getByTestId('targetValue').nth(1), '7');
  await expect(squatRow.getByTestId('targetValue').nth(1)).toHaveText('7');

  await squatRow.getByRole('button', { name: '+ Log set' }).click();
  await typeCell(squatRow.locator('[data-testid$="-actual-weight"]').last(), '130');
  await typeCell(squatRow.locator('[data-testid$="-reps"]').last(), '3');
  await typeCell(squatRow.locator('[data-testid$="-executedRpe"]').last(), '7');
  await new Promise((resolve) => setTimeout(resolve, 800));

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId(/sessions-open-/)).toContainText('Lower');
  await expect(card.getByTestId(/sessions-open-/)).toContainText('Day 1');
  await expect(card.getByTestId(/sessions-open-/).locator('p').first()).toHaveText('Day 1');
  await expect(card.getByTestId(/sessions-open-/)).toContainText('2026-09-01');
  await expect(card.getByTestId(/sessions-plan-h-/)).toHaveText('Plan');
  await expect(card.getByTestId(/sessions-log-h-/)).toHaveText('Log');
  await expect(card).toContainText('150 × 5 @ 6');
  await expect(card).toContainText('140 × 5 @ 7');
  await expect(card).toContainText('130 × 3 @ 7');
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

  const weekKey = '1::1';
  await page.getByTestId(`sessions-mode-${weekKey}-plan`).click();
  await expect(card.getByTestId(/sessions-plan-h-/)).toBeVisible();
  await expect(card.getByTestId(/sessions-log-h-/)).toHaveCount(0);
  await expect(card).not.toContainText('130 × 3 @ 7');
  await page.getByTestId(`sessions-mode-${weekKey}-log`).click();
  await expect(card.getByTestId(/sessions-plan-h-/)).toHaveCount(0);
  await expect(card.getByTestId(/sessions-log-h-/)).toBeVisible();
  await expect(card).not.toContainText('140 × 5 @ 7');
  await expect(card).toContainText('130 × 3 @ 7');
  await page.getByTestId(`sessions-mode-${weekKey}-both`).click();

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

test('labeled weeks compare by first session date with dated rest rows', async ({ page, request }) => {
  const email = `sessions-board-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();
  const sessions = [
    { date: '2026-09-01', title: 'First', blockLabel: '1', weekLabel: '9' },
    { date: '2026-09-03', title: 'Second', blockLabel: '1', weekLabel: '9' },
    { date: '2026-09-06', title: 'Third', blockLabel: '1', weekLabel: '2' },
    { date: '2026-09-08', title: 'Block only', blockLabel: '1' },
    { date: '2026-09-09', title: 'Unlabeled' },
  ];
  const ids: string[] = [];
  for (const session of sessions) {
    const response = await request.post('http://localhost:8000/api/sessions', { data: session });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).id as string);
  }

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('nav-sessions').click();
  const board = page.getByTestId('sessions-week-board-1');
  await expect(board.locator('[data-testid^="sessions-week-row-"]')).toHaveCount(2);
  expect(await board.locator('[data-testid^="sessions-week-row-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid'))))
    .toEqual(['sessions-week-row-1::9', 'sessions-week-row-1::2']);
  const firstWeek = board.locator(':scope > div').first();
  const secondWeek = board.locator(':scope > div').nth(1);
  await expect(firstWeek.getByTestId('sessions-rest-2026-09-02')).toBeVisible();
  await expect(firstWeek.getByTestId('sessions-rest-2026-09-04')).toBeVisible();
  await expect(firstWeek.getByTestId('sessions-rest-2026-09-05')).toBeVisible();
  await expect(secondWeek.locator('[data-testid^="sessions-rest-"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No Week' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No Block or Week' })).toBeVisible();

  await firstWeek.getByTestId('sessions-mode-1::9-log').click();
  await expect(firstWeek.getByTestId('sessions-mode-1::9-log')).toHaveAttribute('aria-pressed', 'true');
  await expect(secondWeek.getByTestId('sessions-mode-1::2-both')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId(`sessions-actions-${ids[3]}`).click();
  await page.getByTestId(`sessions-edit-${ids[3]}`).click();
  await expect(page.getByTestId('edit-session-dialog')).toBeVisible();
  await page.getByTestId('edit-session-cancel').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId(`sessions-actions-${ids[4]}`).click();
  await page.getByTestId(`sessions-delete-${ids[4]}`).click();
  await expect(page.getByTestId(`sessions-card-${ids[4]}`)).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByTestId('sidebar-toggle').click();
  const widths = await board.evaluate((element) => ({
    board: element.clientWidth,
    column: element.firstElementChild?.getBoundingClientRect().width || 0,
  }));
  expect(Math.abs(widths.board - widths.column)).toBeLessThan(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)).toBeFalsy();
});

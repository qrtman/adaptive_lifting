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
  await expect(page.getByTestId('sessions-show-accessories')).toHaveCount(0);
  await expect(page.getByTestId('lift-filter-open')).toHaveText('All lifts');
  await expect(page.getByTestId('sessions-mode-both')).toHaveAttribute('aria-pressed', 'true');
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
  await expect(card.getByTestId(/sessions-lift-e1rm-/)).toHaveText('e1RM 197 kg');
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

  await page.getByTestId('sessions-mode-plan').click();
  await expect(card.getByTestId(/sessions-lift-e1rm-/)).toHaveText('e1RM 197 kg');
  await expect(card.getByTestId(/sessions-plan-h-/)).toBeVisible();
  await expect(card.getByTestId(/sessions-log-h-/)).toHaveCount(0);
  await expect(card).not.toContainText('130 × 3 @ 7');
  await page.getByTestId('sessions-mode-log').click();
  await expect(card.getByTestId(/sessions-plan-h-/)).toHaveCount(0);
  await expect(card.getByTestId(/sessions-log-h-/)).toBeVisible();
  await expect(card).not.toContainText('140 × 5 @ 7');
  await expect(card).toContainText('130 × 3 @ 7');
  await page.getByTestId('sessions-mode-both').click();

  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByTestId('sidebar-toggle').click();
  const addButton = await page.getByTestId('sessions-add').boundingBox();
  const filterButton = await page.getByTestId('lift-filter-open').boundingBox();
  expect(addButton && filterButton && addButton.y < filterButton.y).toBeTruthy();
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
  for (const id of [ids[0], ids[2], ids[3], ids[4]]) {
    const response = await request.post(`http://localhost:8000/api/sessions/${id}/exercises`, {
      data: { title: 'Competition Squat', tier: 'Comp', liftCategory: 'Squat', plannedWeight: 100, plannedReps: 5, plannedRpe: 7 },
    });
    expect(response.ok()).toBeTruthy();
    const accessory = await request.post(`http://localhost:8000/api/sessions/${id}/exercises`, {
      data: { title: 'Accessory Row', tier: 'Accessory', liftCategory: 'Other', plannedWeight: 40, plannedReps: 10, plannedRpe: 7 },
    });
    expect(accessory.ok()).toBeTruthy();
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
  await expect(page.getByTestId('sessions-block-picker')).toHaveValue('block:1');
  await expect(page.getByTestId('sessions-block-picker').locator('option[value="unassigned"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'No Block or Week' })).toHaveCount(0);
  await expect(page.getByTestId('lift-filter-open')).toHaveText('All lifts');
  await expect(page.getByTestId('sessions-show-accessories')).toHaveCount(0);
  for (const id of [ids[0], ids[2], ids[3]]) {
    const card = page.getByTestId(`sessions-card-${id}`);
    await expect(card).toContainText('Competition Squat');
    await expect(card).toContainText('Accessory Row');
    await expect(card).toContainText('40 × 10 @ 7');
  }

  await expect(page.getByTestId('sessions-mode-both')).toHaveCount(1);
  await page.getByTestId('sessions-mode-log').click();
  await expect(page.getByTestId('sessions-mode-log')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sessions-mode-both')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-testid^="sessions-plan-h-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="sessions-log-h-"]')).toHaveCount(3);
  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('nav-sessions').click();
  await expect(page.getByTestId('sessions-mode-both')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="sessions-plan-h-"]')).toHaveCount(3);
  await page.getByTestId('sessions-block-picker').selectOption('unassigned');
  await expect(page.getByRole('heading', { name: 'No Block or Week' })).toBeVisible();
  await expect(page.getByTestId(`sessions-card-${ids[4]}`)).toContainText('Accessory Row');
  await page.getByTestId('sessions-add').click();
  await expect(page.getByTestId('new-session-block')).toHaveValue('');
  await page.getByTestId('new-session-cancel').click();

  await page.getByTestId('sessions-block-picker').selectOption('block:1');
  await page.getByTestId(`sessions-actions-${ids[3]}`).click();
  await page.getByTestId(`sessions-edit-${ids[3]}`).click();
  await expect(page.getByTestId('edit-session-dialog')).toBeVisible();
  await page.getByTestId('edit-session-cancel').click();
  await page.getByTestId('sessions-block-picker').selectOption('unassigned');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId(`sessions-actions-${ids[4]}`).click();
  await page.getByTestId(`sessions-delete-${ids[4]}`).click();
  await expect(page.getByTestId(`sessions-card-${ids[4]}`)).toHaveCount(0);
  await expect(page.getByTestId('sessions-block-picker').locator('option[value="unassigned"]')).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 400 });
  await page.getByTestId('sidebar-toggle').click();
  const widths = await board.evaluate((element) => ({
    board: element.clientWidth,
    column: element.firstElementChild?.getBoundingClientRect().width || 0,
  }));
  expect(Math.abs(widths.board - widths.column)).toBeLessThan(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)).toBeFalsy();

  const scrollbar = page.getByTestId('sessions-scrollbar');
  await expect(scrollbar).toBeVisible();
  await scrollbar.evaluate((element) => { element.scrollLeft = 100; });
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBe(100);
  await board.evaluate((element) => { element.scrollLeft = 0; });
  await expect.poll(() => scrollbar.evaluate((element) => element.scrollLeft)).toBe(0);

  const content = page.getByTestId('sessions-content');
  await content.evaluate((element) => {
    const weekBoard = element.querySelector('[data-testid="sessions-week-board-1"]');
    if (weekBoard) element.scrollTop += weekBoard.getBoundingClientRect().top - element.getBoundingClientRect().top + 60;
  });
  await expect(page.getByTestId('sessions-sticky-weeks')).toContainText('Week 9');
  await expect(page.getByTestId('sessions-sticky-weeks')).toContainText('Week 2');
  await expect(page.getByTestId('sessions-sticky-weeks')).toContainText('Block 1');
  const stickyTop = await page.getByTestId('sessions-sticky-weeks').evaluate((element) => element.getBoundingClientRect().top);
  const contentTop = await content.evaluate((element) => element.getBoundingClientRect().top);
  const toolbarBottom = await page.getByTestId('sessions-toolbar').evaluate((element) => element.getBoundingClientRect().bottom);
  expect(Math.abs(stickyTop - contentTop)).toBeLessThan(2);
  expect(Math.abs(stickyTop - toolbarBottom)).toBeLessThan(2);
});

test('block picker opens the latest block and resets scrolling when switching', async ({ page, request }) => {
  const email = `sessions-scroll-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();
  for (const blockLabel of ['1', '2']) {
    for (const weekLabel of ['1', '2', '3']) {
      const response = await request.post('http://localhost:8000/api/sessions', {
        data: { date: `2026-0${blockLabel}-${weekLabel.padStart(2, '0')}`, title: `Block ${blockLabel} week ${weekLabel}`, blockLabel, weekLabel },
      });
      expect(response.ok()).toBeTruthy();
      if (weekLabel === '1') {
        const sessionId = (await response.json()).id as string;
        const exercise = await request.post(`http://localhost:8000/api/sessions/${sessionId}/exercises`, {
          data: { title: blockLabel === '1' ? 'Competition Squat' : 'Competition Bench', tier: 'Comp', liftCategory: blockLabel === '1' ? 'Squat' : 'Bench', plannedWeight: 100, plannedReps: 5, plannedRpe: 7 },
        });
        expect(exercise.ok()).toBeTruthy();
      }
    }
  }
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('nav-sessions').click();
  await page.setViewportSize({ width: 420, height: 250 });

  const scrollbar = page.getByTestId('sessions-scrollbar');
  const first = page.getByTestId('sessions-week-board-1');
  const second = page.getByTestId('sessions-week-board-2');
  const picker = page.getByTestId('sessions-block-picker');
  await expect(picker).toHaveValue('block:2');
  await expect(first).toHaveCount(0);
  await expect(second).toBeVisible();
  await expect(scrollbar).toBeVisible();
  await scrollbar.evaluate((element) => { element.scrollLeft = 120; });
  await expect.poll(() => second.evaluate((element) => element.scrollLeft)).toBe(120);

  const content = page.getByTestId('sessions-content');
  await content.evaluate((element) => {
    const weekBoard = element.querySelector('[data-testid="sessions-week-board-2"]');
    if (weekBoard) element.scrollTop += weekBoard.getBoundingClientRect().top - element.getBoundingClientRect().top + 20;
  });
  await expect(page.getByTestId('sessions-sticky-weeks')).toContainText('Block 2');
  await page.getByTestId('sessions-block-prev').click();
  await expect(picker).toHaveValue('block:1');
  await expect(first).toBeVisible();
  await expect(second).toHaveCount(0);
  await expect.poll(() => first.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByTestId('sessions-add').click();
  await expect(page.getByTestId('new-session-block')).toHaveValue('1');
  await page.getByTestId('new-session-cancel').click();
  await page.getByTestId('sessions-block-next').click();
  await expect(picker).toHaveValue('block:2');
  await page.getByTestId('lift-filter-open').click();
  await page.getByTestId('lift-filter-lift-Squat').click();
  await page.getByTestId('lift-filter-done').click();
  await expect(picker).toHaveValue('block:1');
  await expect(second).toHaveCount(0);
});

test('Compare switches control logged lift deltas across Weeks and reset on reopen', async ({ page, request }) => {
  const email = `sessions-compare-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  const ids: string[] = [];
  for (const [date, weekLabel, weight] of [
    ['2026-09-01', '1', 140], ['2026-09-08', '2', 150], ['2026-09-15', '3', 145],
  ] as const) {
    const session = await request.post('http://localhost:8000/api/sessions', {
      data: { date, title: `Lower ${weekLabel}`, blockLabel: '1', weekLabel, dayLabel: '1' },
    });
    expect(session.ok()).toBeTruthy();
    const id = (await session.json()).id as string;
    ids.push(id);
    const added = await request.post(`http://localhost:8000/api/sessions/${id}/exercises`, {
      data: { title: 'Competition Squat', variation: 'Competition', tier: 'Comp', liftCategory: 'Squat', plannedWeight: 300, plannedReps: 5, plannedRpe: 8 },
    });
    expect(added.ok()).toBeTruthy();
    const exercise = await added.json();
    const logged = await request.put(`http://localhost:8000/api/sessions/${id}/exercises/${exercise.id}/sets`, {
      data: { sets: [{ id: exercise.sets[0].id, scope: 'both', plannedWeight: 300, plannedReps: 5, plannedRpe: 8, actual: weight, reps: 5, executedRpe: 8 }] },
    });
    expect(logged.ok()).toBeTruthy();
  }

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('nav-sessions').click();
  const first = page.getByTestId(`sessions-card-${ids[0]}`);
  const second = page.getByTestId(`sessions-card-${ids[1]}`);
  const third = page.getByTestId(`sessions-card-${ids[2]}`);
  await expect(first.getByTestId(/sessions-lift-tonnage-/)).toHaveText('Tonnage 700 kg');
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toContainText('+50 kg (+7.1%)');
  await expect(third.getByTestId(/sessions-lift-tonnage-/)).toContainText('-25 kg (-3.3%)');
  await expect(second.getByTestId(/sessions-lift-avg-int-/)).toContainText('0%');

  await page.getByTestId('sessions-compare-open').click();
  await page.getByTestId('sessions-compare-hide-all').click();
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toHaveText('Tonnage 750 kg');
  await expect(third.getByTestId(/sessions-lift-tonnage-/)).toHaveText('Tonnage 725 kg');
  await page.getByTestId('sessions-compare-e1rm').check();
  await expect(second.getByTestId(/sessions-lift-e1rm-/)).toContainText('(+');
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toHaveText('Tonnage 750 kg');
  await page.getByTestId('sessions-compare-show-all').click();
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toContainText('+50 kg');
  await page.getByTestId('sessions-mode-plan').click();
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toContainText('+50 kg');
  await page.getByTestId('sessions-mode-log').click();
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toContainText('+50 kg');

  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByTestId('sidebar-toggle').click();
  await expect(second.getByTestId(/sessions-lift-tonnage-/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)).toBeFalsy();
  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('nav-sessions').click();
  await page.getByTestId('sessions-compare-open').click();
  await expect(page.getByTestId('sessions-compare-tonnage')).toBeChecked();
  await expect(page.getByTestId(`sessions-card-${ids[1]}`).getByTestId(/sessions-lift-tonnage-/)).toContainText('+50 kg');
});

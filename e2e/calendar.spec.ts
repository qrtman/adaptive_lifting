import { expect, test } from '@playwright/test';
import { pickComboOption } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

test('hover New session opens a dialog; cancel creates nothing', async ({ page, request }) => {
  const email = `cal-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible();

  await page.getByRole('button', { name: 'Calendar' }).click();
  const unlabeledDay = page.getByTestId('calendar-day-2026-09-03');
  await unlabeledDay.click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await expect(page.getByTestId('new-session-day')).toHaveValue('');
  await expect(page.getByTestId('new-session-title')).toHaveValue('');
  await expect(page.getByTestId('new-session-block')).toHaveValue('');
  await expect(page.getByTestId('new-session-week')).toHaveValue('');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('new-session-error')).toHaveText('Enter a name');
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-title').fill('Unlabeled');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page.getByTestId('session-name')).toHaveText('Unlabeled');
  await expect(page.getByTestId('session-labels')).toHaveText('No block/week');
  await expect(page.getByTestId('session-labels')).not.toContainText('Day');
  await page.getByRole('button', { name: 'Back' }).click();

  const day = page.getByTestId('calendar-day-2026-09-04');
  await day.hover();
  const newSession = page.getByTestId('calendar-new-session-2026-09-04');
  await expect(newSession).toBeVisible();
  await newSession.click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-cancel').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-empty-lifts')).toHaveCount(0);

  await day.hover();
  await newSession.click();
  await expect(page.getByTestId('new-session-title')).toHaveValue('Unlabeled');
  await pickComboOption(page, 'new-session-day', 'Day 1');
  await page.getByTestId('new-session-title').fill('Squat');
  await page.getByTestId('new-session-block').selectOption('__new__');
  await page.getByTestId('new-session-block-custom').fill('Hypertrophy');
  await page.getByTestId('new-session-week').selectOption('__new__');
  await page.getByTestId('new-session-week-custom').fill('Week1');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
  await expect(page.getByTestId('session-name')).toHaveText('Squat');
  await expect(page.getByTestId('session-name')).not.toContainText('Day');
  await expect(page.getByTestId('session-labels')).toContainText('Day 1');
  await expect(page.getByTestId('session-labels')).toContainText('Week 1');
  await expect(page.getByTestId('session-labels')).toContainText('Block Hypertrophy');
  await expect(page.getByTestId('edit-session-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  const reuseDay = page.getByTestId('calendar-day-2026-09-05');
  await reuseDay.hover();
  await page.getByTestId('calendar-new-session-2026-09-05').click();
  await expect(page.getByTestId('new-session-day')).toHaveValue('Day 1');
  await expect(page.getByTestId('new-session-title')).toHaveValue('Squat');
  await expect(page.getByTestId('new-session-block')).toHaveValue('Hypertrophy');
  await expect(page.getByTestId('new-session-week')).toHaveValue('Week1');
  await expect(page.getByTestId('new-session-block').locator('option[value="Hypertrophy"]')).toHaveCount(1);
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-name')).toHaveText('Squat');
  await expect(page.getByTestId('session-labels')).toContainText('Day 1');
  await expect(page.getByTestId('session-labels')).toContainText('Week 1');
  await expect(page.getByTestId('session-labels')).toContainText('Block Hypertrophy');
  await page.getByRole('button', { name: 'Back' }).click();
  await day.hover();
  await expect(page.getByRole('button', { name: 'Copy to' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy to' }).click();
  await expect(page.getByTestId('copy-to-banner')).toBeVisible();
  await page.getByTestId('calendar-day-2026-09-11').click();
  await expect(page.getByTestId('copy-to-banner')).toHaveCount(0);
  const copiedCard = page.getByTestId('calendar-day-2026-09-11').locator('[data-testid^="workout-card-"]');
  await expect(copiedCard).toHaveCount(1);
  await expect(copiedCard).toContainText('Hypertrophy · Week1');

  await copiedCard.click();
  await expect(page.getByTestId('session-name')).toHaveText('Squat');
  await expect(page.getByTestId('session-labels')).toContainText('Day 1');
  await expect(page.getByTestId('session-labels')).toContainText('Week 1');
  await expect(page.getByTestId('session-labels')).toContainText('Block Hypertrophy');
  await page.getByTestId('session-edit').click();
  await expect(page.getByTestId('edit-session-dialog')).toBeVisible();
  await expect(page.getByTestId('session-day')).toHaveValue('Day 1');
  await expect(page.getByTestId('session-title')).toHaveValue('Squat');
  await page.getByTestId('session-block').selectOption('__new__');
  await page.getByTestId('session-block-custom').fill('Meet');
  await page.getByTestId('session-week').selectOption('__new__');
  await page.getByTestId('session-week-custom').fill('Week2');
  await page.getByTestId('edit-session-save').click();
  await expect(page.getByTestId('edit-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-labels')).toContainText('Day 1');
  await expect(page.getByTestId('session-labels')).toContainText('Week 2');
  await expect(page.getByTestId('session-labels')).toContainText('Block Meet');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(copiedCard).toContainText('Meet · Week2');
});

test('coach without an athlete cannot create; linked coach can', async ({ page, playwright }) => {
  const suffix = Date.now();
  const coachEmail = `coach-${suffix}@example.com`;
  const athleteEmail = `ath-${suffix}@example.com`;
  const coachApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const athleteApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  try {
    const coachReg = await coachApi.post('/api/auth/register', {
      data: { email: coachEmail, password: 'password123', role: 'COACH' },
    });
    const athleteReg = await athleteApi.post('/api/auth/register', {
      data: { email: athleteEmail, password: 'password123', role: 'ATHLETE' },
    });
    expect(coachReg.ok()).toBeTruthy();
    expect(athleteReg.ok()).toBeTruthy();

    await page.goto('/');
    await page.getByPlaceholder('coach@example.com').fill(coachEmail);
    await page.getByPlaceholder('Password').fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible();
    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByTestId('calendar-empty')).toBeVisible();
    await expect(page.getByText('Select an athlete')).toBeVisible();

    const codeResp = await coachApi.post('/api/auth/coach-code');
    expect(codeResp.ok()).toBeTruthy();
    const code = (await codeResp.json()).code as string;
    const link = await athleteApi.post('/api/auth/link-athlete', { data: { code } });
    expect(link.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId('athlete-scope-selector')).toContainText(athleteEmail);
    await page.getByRole('button', { name: 'Calendar' }).click();
    const day = page.getByTestId('calendar-day-2026-09-04');
    await day.hover();
    await page.getByTestId('calendar-new-session-2026-09-04').click();
    await expect(page.getByTestId('new-session-need-athlete')).toHaveCount(0);
    await page.getByTestId('new-session-title').fill('Coach day');
    await page.getByTestId('new-session-create').click();
    await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  } finally {
    await coachApi.dispose();
    await athleteApi.dispose();
  }
});

test('hover overlay does not grow the day cell; Notes saves a day card', async ({ page, request }) => {
  const email = `notes-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar' }).click();

  const day01 = page.getByTestId('calendar-day-2026-09-01');
  const day02 = page.getByTestId('calendar-day-2026-09-02');
  await expect(day01).toBeVisible();

  const restHeight = await day01.evaluate((el) => el.getBoundingClientRect().height);
  const neighborHeight = await day02.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(restHeight)).toBe(Math.round(neighborHeight));

  await day01.hover();
  const overlay = page.getByTestId('calendar-day-hover-2026-09-01');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS('position', 'absolute');
  await expect(page.getByTestId('calendar-new-session-2026-09-01')).toBeVisible();
  await expect(page.getByTestId('calendar-day-notes-2026-09-01')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy to' })).toHaveCount(0);

  const hoverHeight = await day01.evaluate((el) => el.getBoundingClientRect().height);
  const neighborWhileHover = await day02.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(hoverHeight)).toBe(Math.round(restHeight));
  expect(Math.round(hoverHeight)).toBe(Math.round(neighborWhileHover));

  const overlayBox = await overlay.boundingBox();
  const cellBox = await day01.boundingBox();
  expect(overlayBox).toBeTruthy();
  expect(cellBox).toBeTruthy();
  expect(overlayBox!.width).toBeLessThan(cellBox!.width);
  expect(overlayBox!.width).toBeLessThanOrEqual(160);

  await page.getByTestId('calendar-day-notes-2026-09-01').click();
  await expect(page.getByTestId('day-note-dialog')).toBeVisible();
  await expect(page.getByTestId('day-note-body')).toHaveValue('');
  await page.getByTestId('day-note-body').fill('Deload — keep SQ light');
  await page.getByTestId('day-note-save').click();
  await expect(page.getByTestId('day-note-dialog')).toHaveCount(0);
  const noteCard = page.getByTestId('calendar-day-note-card-2026-09-01');
  await expect(noteCard).toBeVisible();
  await expect(noteCard).toContainText('Deload — keep SQ light');
  await expect(day01.locator('[data-testid^="workout-card-"]')).toHaveCount(0);

  await noteCard.click();
  await expect(page.getByTestId('day-note-dialog')).toBeVisible();
  await expect(page.getByTestId('session-empty-lifts')).toHaveCount(0);
  await page.getByTestId('day-note-body').fill('');
  await page.getByTestId('day-note-save').click();
  await expect(page.getByTestId('day-note-dialog')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-note-card-2026-09-01')).toHaveCount(0);

  await day01.hover();
  await page.getByTestId('calendar-day-notes-2026-09-01').click();
  await page.getByTestId('day-note-body').fill('Deload — keep SQ light');
  await page.getByTestId('day-note-save').click();
  await expect(noteCard).toBeVisible();

  await day02.hover();
  await page.getByTestId('calendar-new-session-2026-09-02').click();
  await page.getByTestId('new-session-title').fill('Squat');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('calendar-day-2026-09-02').hover();
  await expect(page.getByRole('button', { name: 'Copy to' })).toBeVisible();
  await page.getByTestId('calendar-day-notes-2026-09-02').click();
  await page.getByTestId('day-note-body').fill('Meet week');
  await page.getByTestId('day-note-save').click();
  await expect(page.getByTestId('calendar-day-note-card-2026-09-02')).toContainText('Meet week');
  await expect(page.getByTestId('calendar-day-2026-09-02').locator('[data-testid^="workout-card-"]')).toHaveCount(1);

  await page.getByTestId('calendar-day-note-card-2026-09-02').click();
  await expect(page.getByTestId('day-note-dialog')).toBeVisible();
  await expect(page.getByTestId('session-empty-lifts')).toHaveCount(0);
  await page.getByTestId('day-note-cancel').click();

  const restWithNote = await page.getByTestId('calendar-day-2026-09-02').evaluate((el) => el.getBoundingClientRect().height);
  await page.getByTestId('calendar-day-2026-09-02').hover();
  await expect(page.getByTestId('calendar-day-hover-2026-09-02')).toBeVisible();
  const hoverWithNote = await page.getByTestId('calendar-day-2026-09-02').evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(hoverWithNote)).toBe(Math.round(restWithNote));

  await page.setViewportSize({ width: 360, height: 740 });
  const day03 = page.getByTestId('calendar-day-2026-09-03');
  const day04 = page.getByTestId('calendar-day-2026-09-04');
  await day03.scrollIntoViewIfNeeded();
  const emptyRest = await day03.evaluate((el) => el.getBoundingClientRect().height);
  await day03.hover();
  await expect(page.getByTestId('calendar-day-hover-2026-09-03')).toBeVisible();
  await expect(page.getByTestId('calendar-day-hover-2026-09-03')).toHaveCSS('position', 'absolute');
  const emptyHover = await day03.evaluate((el) => el.getBoundingClientRect().height);
  const emptyNeighbor = await day04.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(emptyHover)).toBe(Math.round(emptyRest));
  expect(Math.round(emptyHover)).toBe(Math.round(emptyNeighbor));
});

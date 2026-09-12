import { expect, test } from '@playwright/test';

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
  await page.getByTestId('new-session-title').fill('Meet day');
  await page.getByTestId('new-session-block').selectOption('__new__');
  await page.getByTestId('new-session-block-custom').fill('Hypertrophy');
  await page.getByTestId('new-session-week').selectOption('__new__');
  await page.getByTestId('new-session-week-custom').fill('Week1');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-empty-lifts')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
  await expect(page.getByTestId('session-labels')).toHaveText('Hypertrophy · Week1');
  await expect(page.getByTestId('edit-session-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  const reuseDay = page.getByTestId('calendar-day-2026-09-05');
  await reuseDay.hover();
  await page.getByTestId('calendar-new-session-2026-09-05').click();
  await expect(page.getByTestId('new-session-block').locator('option[value="Hypertrophy"]')).toHaveCount(1);
  await page.getByTestId('new-session-block').selectOption('Hypertrophy');
  await page.getByTestId('new-session-week').selectOption('Week1');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-labels')).toHaveText('Hypertrophy · Week1');
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
  await expect(page.getByTestId('session-labels')).toHaveText('Hypertrophy · Week1');
  await page.getByTestId('session-edit').click();
  await expect(page.getByTestId('edit-session-dialog')).toBeVisible();
  await page.getByTestId('session-block').selectOption('__new__');
  await page.getByTestId('session-block-custom').fill('Meet');
  await page.getByTestId('session-week').selectOption('__new__');
  await page.getByTestId('session-week-custom').fill('Week2');
  await page.getByTestId('edit-session-save').click();
  await expect(page.getByTestId('edit-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-labels')).toHaveText('Meet · Week2');
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
    await expect(page.getByTestId('coach-athlete-switcher')).toHaveValue(/.+/);
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

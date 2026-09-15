import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
}

async function registerAthlete(request: APIRequestContext, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();
  return email;
}

test('unlabeled sessions have day copy only; no week or block rows', async ({ page, request }) => {
  const email = await registerAthlete(request, 'copy-open');
  const open = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-14', title: 'Open' },
  });
  expect(open.ok()).toBeTruthy();
  const openId = (await open.json()).id as string;

  await signIn(page, email);
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByTestId(`sessions-card-${openId}`)).toBeVisible();
  await expect(page.getByTestId(`sessions-copy-to-${openId}`)).toBeVisible();
  await expect(page.locator('[data-testid^="sessions-week-row-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="sessions-block-row-"]')).toHaveCount(0);
  await expect(page.getByTestId('sessions-copy-days-Ungrouped')).toHaveCount(0);
  await expect(page.getByTestId('sessions-copy-lifts-Ungrouped')).toHaveCount(0);

  await page.getByTestId(`sessions-copy-to-${openId}`).click();
  await expect(page.getByTestId('copy-to-banner')).toBeVisible();
  await expect(page.getByTestId('copy-to-banner')).toContainText('click a day');
  await expect(page.getByTestId('copy-to-banner')).not.toContainText('Block');
  await page.getByTestId('calendar-day-2026-09-21').click();
  await expect(page.getByTestId('copy-to-banner')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-2026-09-21').locator('[data-testid^="workout-card-"]')).toHaveCount(1);
});

test('copy selected keeps relative dates and source week labels', async ({ page, request }) => {
  const email = await registerAthlete(request, 'copy-day');
  const squat = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-15', title: 'Squat', blockLabel: 'Block2', weekLabel: 'Week3' },
  });
  const bench = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-17', title: 'Bench', blockLabel: 'Block2', weekLabel: 'Week3' },
  });
  expect(squat.ok()).toBeTruthy();
  expect(bench.ok()).toBeTruthy();
  const squatId = (await squat.json()).id as string;
  const benchId = (await bench.json()).id as string;

  await signIn(page, email);
  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.getByTestId(`sessions-select-${squatId}`).check();
  await page.getByTestId(`sessions-select-${benchId}`).check();
  await page.getByTestId('sessions-copy-selected').click();
  await expect(page.getByTestId('copy-to-banner')).toContainText('click where D1 lands');
  await page.getByTestId('calendar-day-2026-09-22').click();
  await expect(page.getByTestId('copy-to-banner')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-2026-09-22').locator('[data-testid^="workout-card-"]')).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-2026-09-24').locator('[data-testid^="workout-card-"]')).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-2026-09-22')).toContainText('Block2 · Week3');
  await expect(page.getByTestId('calendar-day-2026-09-24')).toContainText('Block2 · Week3');
});

test('copy week lands D1 and increments the week label', async ({ page, request }) => {
  const email = await registerAthlete(request, 'copy-week');
  const squat = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-15', title: 'Squat', blockLabel: 'Block2', weekLabel: 'Week3' },
  });
  const bench = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-17', title: 'Bench', blockLabel: 'Block2', weekLabel: 'Week3' },
  });
  expect(squat.ok()).toBeTruthy();
  expect(bench.ok()).toBeTruthy();

  await signIn(page, email);
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByTestId('sessions-week-row-Block2::Week3')).toBeVisible();
  await page.getByTestId('sessions-copy-week-Block2::Week3').click();
  await expect(page.getByTestId('copy-to-banner')).toContainText('Copy week');
  await expect(page.getByTestId('copy-to-banner')).toContainText('click where D1 lands');
  await page.getByTestId('calendar-day-2026-09-22').click();
  await expect(page.getByTestId('copy-to-banner')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-2026-09-22')).toContainText('Block2 · Week4');
  await expect(page.getByTestId('calendar-day-2026-09-24')).toContainText('Block2 · Week4');
});

test('copy block keeps week labels and relative dates', async ({ page, request }) => {
  const email = await registerAthlete(request, 'copy-block');
  const squat = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-15', title: 'Squat', blockLabel: 'Block2', weekLabel: 'Week3' },
  });
  const bench = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-17', title: 'Bench', blockLabel: 'Block2', weekLabel: 'Week3' },
  });
  const accessory = await request.post('http://localhost:8000/api/sessions', {
    data: { date: '2026-09-18', title: 'Accessories', blockLabel: 'Block2', weekLabel: 'Week4' },
  });
  expect(squat.ok()).toBeTruthy();
  expect(bench.ok()).toBeTruthy();
  expect(accessory.ok()).toBeTruthy();

  await signIn(page, email);
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByTestId('sessions-block-row-Block2')).toBeVisible();
  await page.getByTestId('sessions-copy-block-Block2').click();
  await expect(page.getByTestId('copy-to-banner')).toContainText('Copy block');
  await page.getByTestId('calendar-day-2026-09-01').click();
  await expect(page.getByTestId('copy-to-banner')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-2026-09-01')).toContainText('Block2 · Week3');
  await expect(page.getByTestId('calendar-day-2026-09-03')).toContainText('Block2 · Week3');
  await expect(page.getByTestId('calendar-day-2026-09-04')).toContainText('Block2 · Week4');
});

test('offline disables copy; coach without an athlete has no copy', async ({ page, context, playwright }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const athleteEmail = `copy-off-${suffix}@example.com`;
  const coachEmail = `copy-coach-${suffix}@example.com`;
  const athleteApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const coachApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  try {
    const athleteReg = await athleteApi.post('/api/auth/register', {
      data: { email: athleteEmail, password: 'password123', role: 'ATHLETE' },
    });
    expect(athleteReg.ok()).toBeTruthy();
    await athleteApi.post('/api/sessions', {
      data: { date: '2026-09-15', title: 'Squat', blockLabel: 'Block2', weekLabel: 'Week3' },
    });

    await signIn(page, athleteEmail);
    await page.getByRole('button', { name: 'Sessions' }).click();
    await expect(page.getByTestId('sessions-copy-week-Block2::Week3')).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByTestId('copy-offline')).toBeVisible();
    await expect(page.getByTestId('sessions-copy-week-Block2::Week3')).toBeDisabled();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Sign out' }).click();

    const coachReg = await coachApi.post('/api/auth/register', {
      data: { email: coachEmail, password: 'password123', role: 'COACH' },
    });
    expect(coachReg.ok()).toBeTruthy();
    await signIn(page, coachEmail);
    await page.getByRole('button', { name: 'Sessions' }).click();
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
    await expect(page.getByText('Select an athlete')).toBeVisible();
    await expect(page.getByTestId('sessions-copy-selected')).toHaveCount(0);
    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByTestId('calendar-empty')).toBeVisible();
  } finally {
    await athleteApi.dispose();
    await coachApi.dispose();
  }
});

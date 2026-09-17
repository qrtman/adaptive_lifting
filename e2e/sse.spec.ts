import { expect, test, type Page } from '@playwright/test';
import { expectCellValue, typeCell } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('nav-security')).toBeVisible();
}

test('second client receives SSE set update on the open inspector', async ({ browser, playwright }) => {
  const suffix = Date.now();
  const coachEmail = `sse-coach-${suffix}@example.com`;
  const athleteEmail = `sse-ath-${suffix}@example.com`;
  const password = 'password123';
  const coachApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const athleteApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const coachPage = await browser.newPage();
  const athletePage = await browser.newPage();
  try {
    expect((await coachApi.post('/api/auth/register', { data: { email: coachEmail, password, role: 'COACH' } })).ok()).toBeTruthy();
    expect((await athleteApi.post('/api/auth/register', { data: { email: athleteEmail, password, role: 'ATHLETE' } })).ok()).toBeTruthy();
    const code = ((await (await coachApi.post('/api/auth/coach-code')).json()) as { code: string }).code;
    expect((await athleteApi.post('/api/auth/link-athlete', { data: { code } })).ok()).toBeTruthy();

    const created = await athleteApi.post('/api/sessions', {
      data: { date: '2026-09-14', title: 'SSE live', blockLabel: 'Hypertrophy', weekLabel: 'Week1' },
    });
    expect(created.ok()).toBeTruthy();
    const session = await created.json() as { id: string };
    const lift = await athleteApi.post(`/api/sessions/${session.id}/exercises`, {
      data: { title: 'Squat', liftCategory: 'Squat', movementPattern: 'Knee Dominant', plannedWeight: 100, plannedReps: 5, plannedRpe: 8 },
    });
    expect(lift.ok()).toBeTruthy();

    await signIn(athletePage, athleteEmail, password);
    await athletePage.goto(`/#/calendar?session=${session.id}`);
    await expect(athletePage.getByTestId('session-inspector')).toBeVisible();
    await expect(athletePage.getByTestId('rx-weight').first()).toBeVisible();

    await signIn(coachPage, coachEmail, password);
    await expect(coachPage.getByTestId('athlete-scope-selector')).toContainText(athleteEmail);
    await coachPage.goto(`/#/calendar?session=${session.id}`);
    await expect(coachPage.getByTestId('session-inspector')).toBeVisible();
    await expectCellValue(coachPage.getByTestId('rx-weight').first(), '100');

    await typeCell(athletePage.getByTestId('rx-weight').first(), '125');
    await expectCellValue(athletePage.getByTestId('rx-weight').first(), '125');
    await expect.poll(async () => coachPage.getByTestId('rx-weight').first().inputValue(), { timeout: 20_000 }).toBe('125');
  } finally {
    await coachPage.close();
    await athletePage.close();
    await coachApi.dispose();
    await athleteApi.dispose();
  }
});

import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('nav-security')).toBeVisible();
}

test('athlete sees sessions the linked coach created after reload', async ({ browser, playwright }) => {
  const suffix = Date.now();
  const coachEmail = `plan-coach-${suffix}@example.com`;
  const athleteEmail = `plan-ath-${suffix}@example.com`;
  const password = 'password123';
  const coachApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const athleteApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const athletePage = await browser.newPage();
  try {
    const coachReg = await coachApi.post('/api/auth/register', {
      data: { email: coachEmail, password, role: 'COACH' },
    });
    const athleteReg = await athleteApi.post('/api/auth/register', {
      data: { email: athleteEmail, password, role: 'ATHLETE' },
    });
    expect(coachReg.ok()).toBeTruthy();
    expect(athleteReg.ok()).toBeTruthy();
    const athleteBody = await athleteReg.json() as { user?: { id?: string }; id?: string };
    const athleteId = athleteBody.user?.id || athleteBody.id;
    expect(athleteId).toBeTruthy();

    const codeResp = await coachApi.post('/api/auth/coach-code');
    expect(codeResp.ok()).toBeTruthy();
    const code = (await codeResp.json()).code as string;
    const link = await athleteApi.post('/api/auth/link-athlete', { data: { code } });
    expect(link.ok()).toBeTruthy();

    const created = await coachApi.post('/api/sessions', {
      data: {
        date: '2026-09-04',
        title: 'Coach programmed squat',
        blockLabel: 'Block1',
        weekLabel: 'Week1',
        athleteId,
      },
    });
    expect(created.ok()).toBeTruthy();

    await signIn(athletePage, athleteEmail, password);
    await athletePage.getByRole('button', { name: 'Sessions' }).click();
    await expect(athletePage.getByText('Coach programmed squat')).toBeVisible();
    await athletePage.getByRole('button', { name: 'Calendar' }).click();
    const day = athletePage.getByTestId('calendar-day-2026-09-04').locator('[data-testid^="workout-card-"]');
    await expect(day).toHaveCount(1);
    await expect(day).toContainText('Coach programmed squat');

    const userId = await athletePage.evaluate(() => localStorage.getItem('al_user_id'));
    expect(userId).toBeTruthy();
    await athletePage.evaluate(async (ownerId) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('adaptive_lifting_db');
        open.onerror = () => reject(open.error);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('snapshots')) {
            db.createObjectStore('snapshots', { keyPath: 'id' });
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('snapshots', 'readwrite');
          tx.objectStore('snapshots').put({
            id: `microcycles:${ownerId}`,
            data: [],
            updated_at: new Date().toISOString(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    }, userId as string);

    await athletePage.reload();
    await athletePage.getByRole('button', { name: 'Calendar' }).click();
    await expect(athletePage.getByTestId('calendar-day-2026-09-04').locator('[data-testid^="workout-card-"]')).toHaveCount(1);
  } finally {
    await athletePage.close();
    await coachApi.dispose();
    await athleteApi.dispose();
  }
});

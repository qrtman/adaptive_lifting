import { expect, test } from '@playwright/test';
import {
  API_HEADERS, addDeadlift, cleanupRunSessions, expectQueueClean, hasCreds, logRunId, login, newPage, openSession,
  RUN_ID, selectMyTraining, sessionTitle,
} from './helpers';

// Session sheet phase 1: the week rail shows the other days of the same Block/Week, an
// unlabeled day inside the week's dates is shown as "no Week" until assigned, and the
// header leads with the Day.
const BLOCK = `E2E rail ${RUN_ID}`;

test.describe('week rail on the session screen', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('rail lists the week, switches days, assigns an inferred day', async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const { context, page } = await newPage(browser);
    try {
      await login(page);
      const me = await (await page.request.get('/api/auth/me', { headers: API_HEADERS })).json();
      const selfId = String(me?.user?.id ?? me?.id);
      const isCoach = String(me?.user?.role ?? me?.role).toUpperCase() === 'COACH';
      const create = async (date: string, title: string, slot: { day?: string; week?: string } = {}) => {
        const data = { date, title, dayLabel: slot.day, weekLabel: slot.week ?? null, blockLabel: slot.week ? BLOCK : null, ...(isCoach ? { athleteId: selfId } : {}) };
        // Staging answers a transient 503 now and then; retry that only.
        let res = await page.request.post('/api/sessions', { headers: API_HEADERS, data });
        for (let attempt = 1; res.status() === 503 && attempt < 4; attempt += 1) {
          await page.waitForTimeout(1_000 * attempt);
          res = await page.request.post('/api/sessions', { headers: API_HEADERS, data });
        }
        expect(res.ok(), `create ${title}: ${res.status()}`).toBeTruthy();
      };
      const d1 = sessionTitle('rail-d1');
      const loose = sessionTitle('rail-loose');
      await create('2026-12-07', d1, { day: '1', week: '3' });
      await create('2026-12-09', sessionTitle('rail-d2'), { day: '2', week: '3' });
      await create('2026-12-11', sessionTitle('rail-d3'), { day: '3', week: '3' });
      await create('2026-12-10', loose);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 25_000 });
      // The sessions are on the coach's own plan; the switcher may open on a linked athlete.
      if (isCoach) await selectMyTraining(page);
      // The unlabeled session is in Sessions › Unassigned; its dates sit inside Week 3.
      await openSession(page, loose);
      const rail = page.getByTestId('week-rail');
      await expect(rail).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('week-rail-title')).toHaveText('Week 3');
      await expect(rail.locator('[data-testid^="week-rail-day-"]')).toHaveCount(4);
      await expect(rail.locator('[aria-current="page"]')).toContainText('no Week');
      await expect(page.getByTestId('session-labels')).toHaveText('No block/week');

      // Switch to Day 1 from the rail; the header leads with the Day.
      await rail.locator('[data-testid^="week-rail-day-"]').filter({ hasText: 'Day 1' }).click();
      await expect(page.getByTestId('session-name')).toHaveText('Day 1');
      await expect(page.getByTestId('session-title-sub')).toHaveText(d1);
      await expect(page.getByTestId('session-labels')).toHaveText(`Week 3 · Block ${BLOCK}`);
      await expect(page.getByTestId('session-set-count')).toHaveText('0 sets');
      await expect(page.getByTestId('workout-tonnage')).toHaveCount(0);
      await addDeadlift(page);
      await expectQueueClean(page);
      await expect(rail.locator('[aria-current="page"]')).toContainText('Deadlift');
      await page.screenshot({ path: testInfo.outputPath('week-rail-desktop.png') });

      // Assign the inferred day to this week: it stops being "no Week".
      const assign = rail.locator('[data-testid^="week-rail-assign-"]');
      await expect(assign).toHaveCount(1);
      await expect(assign).toHaveText('Assign to Week 3');
      await assign.click();
      await expect(assign).toHaveCount(0, { timeout: 20_000 });
      await expect(rail.getByText('no Week')).toHaveCount(0);

      // Phone width: a strip of days above the lifts instead of the column.
      await page.setViewportSize({ width: 390, height: 844 });
      const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
      if (await collapse.isVisible().catch(() => false)) await collapse.click();
      await expect(rail).toBeHidden();
      const strip = page.getByTestId('week-rail-strip');
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('button')).toHaveCount(4);
      await page.screenshot({ path: testInfo.outputPath('week-rail-phone.png') });
    } finally {
      await context.close();
    }
  });
});

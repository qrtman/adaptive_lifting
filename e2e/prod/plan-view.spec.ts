import { expect, test } from '@playwright/test';
import {
  addDeadlift, cleanupRunSessions, createSession, expectQueueClean, hasCreds, logRunId, login, newPage, openSession,
  selectMyTraining, serverWorkouts, sessionTitle,
} from './helpers';
import { fillEditableCell } from '../helpers';

// Session sheet phase 3: Plan view groups identical sets ("3 sets", faint 2–4); the Sets cell
// adds sets; the change is saved per set and survives a reload in Both view.
const TITLE = sessionTitle('plan-view');

test.describe('Plan view on the session screen', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('group identical sets, change the count, see it saved per set', async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const { context, page } = await newPage(browser);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page);
      const role = String((await (await page.request.get('/api/auth/me')).json())?.user?.role ?? '').toUpperCase();
      if (role === 'COACH') await selectMyTraining(page);
      await createSession(page, TITLE, '2026-12-15');
      await openSession(page, TITLE, false);
      await addDeadlift(page);
      await page.getByTestId('session-view-both').click();

      // Program 3 identical sets in Both view (the familiar grid).
      const addSet = page.getByRole('button', { name: 'Add set' }).first();
      while ((await page.locator('[data-cell-id$=":plan:kg"]').count()) < 3) await addSet.click();
      const lift = (await page.locator('[data-cell-id$=":0:plan:kg"]').first().getAttribute('data-cell-id'))!.split(':')[0];
      for (const row of [0, 1, 2]) {
        for (const [field, value] of [['kg', 140], ['reps', 5], ['rpe', 7]] as const) {
          const cell = page.locator(`[data-cell-id="${lift}:${row}:plan:${field}"]`);
          await fillEditableCell(cell, value);
          await cell.press('Enter');
        }
      }
      await expectQueueClean(page);

      // Plan view: one row "3 sets", numbers 1–3; Log columns gone.
      await page.getByTestId('session-view-plan').click();
      await expect(page.getByTestId(`plan-group-grid-${lift}`)).toBeVisible();
      await expect(page.getByTestId(`plan-group-${lift}-0-index`)).toHaveText('1–3');
      await expect(page.getByTestId(`${lift}-g0-sets`)).toHaveText(/3\s*sets/);
      await expect(page.locator(`[data-cell-id^="${lift}:"][data-cell-id*=":log:"]`)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('plan-view.png') });

      // 3 → 4 sets from the Sets cell.
      const count = page.getByTestId(`${lift}-g0-sets`);
      await fillEditableCell(count, 4);
      await count.press('Enter');
      await expect(page.getByTestId(`plan-group-${lift}-0-index`)).toHaveText('1–4');
      await expectQueueClean(page);

      // Saved as 4 separate sets on the server.
      const workout = (await serverWorkouts(page)).find((w) => w.title === TITLE);
      const sets = (workout?.exercises?.[0]?.sets ?? []) as Array<Record<string, unknown>>;
      expect(sets.map((s) => [s.plannedWeight, s.plannedReps])).toEqual([[140, 5], [140, 5], [140, 5], [140, 5]]);

      // The choice of view is remembered; Both view shows the 4 rows after a reload.
      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 25_000 });
      if (role === 'COACH') await selectMyTraining(page);
      await openSession(page, TITLE);
      await expect(page.getByTestId('session-view-plan')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('session-view-both').click();
      await expect(page.locator(`[data-cell-id^="${lift}:"][data-cell-id$=":plan:kg"]`)).toHaveCount(4);

      // Log view hides the Plan columns.
      await page.getByTestId('session-view-log').click();
      await expect(page.getByTestId('set-grid-h-plan')).toBeHidden();
      await expect(page.locator(`[data-cell-id="${lift}:0:log:kg"]`)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('log-view.png') });
      await page.getByTestId('session-view-both').click();
    } finally {
      await context.close();
    }
  });
});

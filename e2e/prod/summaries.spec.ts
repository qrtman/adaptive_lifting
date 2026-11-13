import { expect, test } from '@playwright/test';
import {
  API_HEADERS, cleanupRunSessions, expectQueueClean, fill, hasCreds, logRunId, login, newPage, openSession,
  selectMyTraining, serverWorkouts, sessionTitle,
} from './helpers';

// Session sheet phase 7: per-lift summaries only. Both: "Plan … · Logged …" under the lift and
// "Logged x / y sets" in the header. Plan: NL · Volume · Int columns on the lift's first row.
test.describe('lift summaries', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('Both shows the Plan/Logged line and header count; Plan shows the totals columns', async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await newPage(browser);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page);
      const me = await (await page.request.get('/api/auth/me', { headers: API_HEADERS })).json();
      const selfId = String(me?.user?.id ?? me?.id);
      const isCoach = String(me?.user?.role ?? me?.role).toUpperCase() === 'COACH';
      const call = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => {
        let res = await page.request[method](path, { headers: API_HEADERS, data });
        for (let i = 1; res.status() === 503 && i < 4; i += 1) { await page.waitForTimeout(1000 * i); res = await page.request[method](path, { headers: API_HEADERS, data }); }
        expect(res.ok(), `${method} ${path}: ${res.status()}`).toBeTruthy();
        return res.json();
      };
      const title = sessionTitle('summaries');
      const session = await call('/api/sessions', { date: '2026-12-29', title, dayLabel: '1', ...(isCoach ? { athleteId: selfId } : {}) });
      const lift = await call(`/api/sessions/${session.id}/exercises`, {
        title: 'Barbell Row', variation: 'Barbell Row', tier: 'Accessory', liftCategory: 'Other', movementPattern: 'Horizontal Pull',
      });
      const revision = (await serverWorkouts(page)).find((w) => w.id === session.id)?.exercises?.find((e: any) => e.id === lift.id)?.revision ?? 0;
      await call(`/api/sessions/${session.id}/exercises/${lift.id}/sets`, {
        expected_revision: revision,
        sets: [
          { label: 'Set 1', scope: 'both', plannedWeight: 70, plannedReps: 10, intensityType: 'PERCENT', plannedRpe: 70, dropPercent: 0 },
          { label: 'Set 2', scope: 'both', plannedWeight: 70, plannedReps: 10, intensityType: 'PERCENT', plannedRpe: 70, dropPercent: 0 },
          { label: 'Set 3', scope: 'both', plannedWeight: 70, plannedReps: 10, intensityType: 'PERCENT', plannedRpe: 70, dropPercent: 0 },
        ],
      }, 'put');

      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 25_000 });
      if (isCoach) await selectMyTraining(page);
      await openSession(page, title);
      const expand = page.getByRole('button', { name: 'Expand Barbell Row', exact: true });
      if (await expand.isVisible({ timeout: 5_000 }).catch(() => false)) await expand.click();

      await page.getByTestId('session-view-both').click();
      await expect(page.getByTestId('session-set-count')).toHaveText('Logged 0 / 3 sets', { timeout: 20_000 });
      // Log set 1 in the grid (the sets route keeps Log values, so it can't seed them).
      const grid = page.locator(`[data-lift-grid-host="${lift.id}"]`);
      const kgId = (await grid.locator('[data-testid$="-actual-weight"]').first().getAttribute('id'))!;
      const repsId = (await grid.locator('[data-testid$="-reps"]').first().getAttribute('id'))!;
      await fill(page, kgId, 70);
      await fill(page, repsId, 10);
      await expectQueueClean(page);
      await expect(page.getByTestId('session-set-count')).toHaveText('Logged 1 / 3 sets');
      await expect(page.getByTestId(`lift-plan-summary-${lift.id}`)).toHaveText('3 sets · NL 30 · 2,100 kg · 70%');
      await expect(page.getByTestId(`lift-set-count-${lift.id}`)).toHaveText('1 / 3 · 700 kg');
      // No session tonnage anywhere.
      await expect(page.getByTestId('workout-tonnage')).toHaveCount(0);

      await page.getByTestId('session-view-plan').click();
      await expect(page.getByTestId('session-set-count')).toHaveText('3 sets');
      await expect(page.getByTestId(`plan-total-${lift.id}-nl`)).toHaveText('30');
      await expect(page.getByTestId(`plan-total-${lift.id}-volume`)).toHaveText('2,100 kg');
      await expect(page.getByTestId(`plan-total-${lift.id}-int`)).toHaveText('70%');
      await expect(page.getByTestId(`lift-plan-summary-${lift.id}`)).toHaveCount(0);
      await page.getByTestId('session-view-both').click();
    } finally {
      await context.close();
    }
  });
});

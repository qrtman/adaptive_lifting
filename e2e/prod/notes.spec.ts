import { expect, test } from '@playwright/test';
import {
  API_HEADERS, cleanupRunSessions, expectQueueClean, hasCreds, logRunId, login, newPage, openSession,
  selectMyTraining, serverWorkouts, sessionTitle,
} from './helpers';

// Session sheet phase 6: a set note saved from the grid syncs (Plan sync `{ sets }`) and
// survives a reload; the lift note shows under the lift's rows.
test.describe('set and lift notes', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('add a set note, reload, it is still there; the lift note sits under the rows', async ({ browser }) => {
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
      const title = sessionTitle('notes');
      const session = await call('/api/sessions', { date: '2026-12-28', title, dayLabel: '1', ...(isCoach ? { athleteId: selfId } : {}) });
      const lift = await call(`/api/sessions/${session.id}/exercises`, {
        title: 'Barbell Row', variation: 'Barbell Row', tier: 'Accessory', liftCategory: 'Other', movementPattern: 'Horizontal Pull', liftNote: 'Strict, no body english',
      });
      const revision = (await serverWorkouts(page)).find((w) => w.id === session.id)?.exercises?.find((e: any) => e.id === lift.id)?.revision ?? 0;
      await call(`/api/sessions/${session.id}/exercises/${lift.id}/sets`, {
        expected_revision: revision,
        sets: [1, 2, 3].map((i) => ({ label: `Set ${i}`, scope: 'both', plannedWeight: 70, plannedReps: 10, intensityType: 'RPE', dropPercent: 0 })),
      }, 'put');

      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 25_000 });
      if (isCoach) await selectMyTraining(page);
      await openSession(page, title);
      const expand = page.getByRole('button', { name: 'Expand Barbell Row', exact: true });
      if (await expand.isVisible({ timeout: 5_000 }).catch(() => false)) await expand.click();

      // The lift note is under the rows (below the grid), not beside it.
      const noteRow = page.getByTestId(`open-lift-note-${lift.id}`);
      await expect(noteRow).toContainText('Strict, no body english', { timeout: 20_000 });
      const gridBox = (await page.locator(`[data-lift-grid-host="${lift.id}"]`).boundingBox())!;
      const noteBox = (await noteRow.boundingBox())!;
      expect(noteBox.y).toBeGreaterThanOrEqual(gridBox.y + gridBox.height - 1);

      // Set 2: no dot yet; add a note from the set number.
      const number = page.getByTestId(`set-note-${lift.id}-2`);
      await expect(page.getByTestId(`set-note-${lift.id}-2-dot`)).toHaveCount(0);
      await number.click();
      await page.getByTestId(`set-note-${lift.id}-2-input`).fill('Last rep slow');
      await page.getByTestId(`set-note-${lift.id}-2-input`).press('Control+Enter');
      await expect(page.getByTestId(`set-note-${lift.id}-2-dot`)).toBeVisible();
      await expectQueueClean(page);

      const saved = (await serverWorkouts(page)).find((w) => w.id === session.id)?.exercises?.find((e: any) => e.id === lift.id);
      expect((saved?.sets ?? []).map((s: any) => s.note ?? null)).toEqual([null, 'Last rep slow', null]);

      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 25_000 });
      if (isCoach) await selectMyTraining(page);
      await openSession(page, title);
      if (await expand.isVisible({ timeout: 5_000 }).catch(() => false)) await expand.click();
      await expect(page.getByTestId(`set-note-${lift.id}-2-dot`)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`set-note-${lift.id}-2`)).toHaveAttribute('title', 'Last rep slow');

      // Clear removes it on the server too.
      await page.getByTestId(`set-note-${lift.id}-2`).click();
      await page.getByTestId(`set-note-${lift.id}-2-clear`).click();
      await expect(page.getByTestId(`set-note-${lift.id}-2-dot`)).toHaveCount(0);
      await expectQueueClean(page);
      const cleared = (await serverWorkouts(page)).find((w) => w.id === session.id)?.exercises?.find((e: any) => e.id === lift.id);
      expect((cleared?.sets ?? []).map((s: any) => s.note ?? null)).toEqual([null, null, null]);
    } finally {
      await context.close();
    }
  });
});

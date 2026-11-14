import { expect, test } from '@playwright/test';
import { API_HEADERS, cleanupRunSessions, expectQueueClean, hasCreds, logRunId, login, openSession, PROD_ORIGIN, serverWorkouts, sessionTitle } from './helpers';

// Phone program M1–M2 (.cursor/scopes/phone/PLAN.md): bottom tabs, portrait set table, set sheet, landscape = full table.

test.describe('phone session screen', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });
  test('portrait: tap to log, set sheet edits the Plan; landscape: full table', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ baseURL: PROD_ORIGIN, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await login(page);
      const me = await (await page.request.get('/api/auth/me', { headers: API_HEADERS })).json();
      const selfId = String(me?.user?.id ?? me?.id);
      const isCoach = String(me?.user?.role ?? me?.role).toUpperCase() === 'COACH';
      const call = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => (await page.request[method](path, { headers: API_HEADERS, data })).json();
      const title = sessionTitle('phone');
      const session = await call('/api/sessions', { date: '2026-12-30', title, dayLabel: '2', ...(isCoach ? { athleteId: selfId } : {}) });
      let squatId = '';
      for (const name of ['Squat', 'Barbell Row']) {
        const lift = await call(`/api/sessions/${session.id}/exercises`, { title: name, variation: name, tier: name === 'Squat' ? 'Comp' : 'Accessory', liftCategory: name === 'Squat' ? 'Squat' : 'Other', movementPattern: name === 'Squat' ? 'Knee Dominant' : 'Horizontal Pull' });
        if (name === 'Squat') squatId = lift.id;
        const revision = (await serverWorkouts(page)).find((w) => w.id === session.id)?.exercises?.find((e: any) => e.id === lift.id)?.revision ?? 0;
        await call(`/api/sessions/${session.id}/exercises/${lift.id}/sets`, { expected_revision: revision, sets: [1, 2, 3, 4].map((i) => ({ label: `Set ${i}`, scope: 'both', plannedWeight: i === 1 ? 150 : 130, plannedReps: i === 1 ? 3 : 5, intensityType: 'RPE', plannedRpe: i === 1 ? 8 : 7, dropPercent: 0 })) }, 'put');
      }
      await page.reload();
      await page.waitForTimeout(2500);
      if (isCoach) {
        await page.getByTestId('tab-more').click();
        const sel = page.getByTestId('more-sheet').getByTestId('athlete-scope-selector');
        await expect(sel).not.toHaveText('Select athlete…', { timeout: 20_000 });
        if ((await sel.textContent())?.trim() !== 'My training') { await sel.click(); await page.getByRole('option', { name: /My training/ }).click(); }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
      }
      await openSession(page, title);
      await page.waitForTimeout(2500);
      // Portrait: Plan as text, no Plan or metric columns, no sidebar.
      await expect(page.getByTestId('bottom-nav')).toBeVisible();
      await expect(page.getByTestId(`plan-brief-${squatId}-1`)).toHaveText('150×3 @8');
      await expect(page.locator(`[data-lift-grid-host="${squatId}"] [data-testid="set-grid-h-planKg"]`)).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // One tap on Log kg opens the editor (numeric keyboard on a real phone).
      const grid = page.locator(`[data-lift-grid-host="${squatId}"]`);
      await grid.locator('[data-testid$="-actual-weight"]').first().tap();
      await page.keyboard.type('150');
      await page.keyboard.press('Enter');
      await expectQueueClean(page);

      // Set sheet: change set 2's Plan kg.
      await page.getByTestId(`plan-brief-${squatId}-2`).tap();
      await expect(page.getByTestId('phone-set-sheet')).toBeVisible();
      await page.getByTestId('phone-set-kg').fill('135');
      await page.getByTestId('phone-set-save').tap();
      await expect(page.getByTestId(`plan-brief-${squatId}-2`)).toHaveText('135×5 @7');
      await expectQueueClean(page);
      const squat = (await serverWorkouts(page)).find((w) => w.id === session.id)?.exercises?.find((e: any) => e.id === squatId);
      expect(squat?.sets?.map((x: any) => [x.plannedWeight, x.actual ?? null])).toEqual([[150, 150], [135, null], [130, null], [130, null]]);

      // Landscape: the full table is back (Plan columns, metrics), the Plan text is gone.
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.getByTestId(`plan-brief-${squatId}-1`)).toBeHidden();
      await expect(page.locator(`[data-lift-grid-host="${squatId}"] [data-testid="set-grid-h-e1rm"]`)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

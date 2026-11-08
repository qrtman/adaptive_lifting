import { expect, test, type Page } from '@playwright/test';
import {
  API_HEADERS, RUN_ID, addDeadlift, cleanupRunSessions, createSession, expectQueueClean, hasCreds, logRunId,
  login, newPage, openSession, pendingMutations, sessionTitle,
} from './helpers';

// Regression: quick consecutive edits by one user on one lift must never surface a
// "Sync conflict needs review" (STALE_REVISION). Our own earlier save raises the lift
// revision; the client must recognise that and resend on top of it.
const TITLE = sessionTitle('self-conflict');

test.describe('production self-conflict', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('add a set and type into it before the previous save is acknowledged', async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await newPage(browser);
    try {
      await login(page);
      let conflicts = 0;
      await page.exposeFunction('__onConflicts', (n: number) => { conflicts += n || 1; });
      await page.evaluate(() => window.addEventListener('sync-conflicts', (e) => (window as any).__onConflicts((e as CustomEvent).detail?.length ?? 0)));

      await createSession(page, TITLE, '2026-11-11');
      await openSession(page, TITLE, false);
      await addDeadlift(page);
      await expect.poll(() => pendingMutations(page), { timeout: 30_000 }).toBe(0);

      const planKg = page.locator('[data-testid="rx-weight"]');
      const logKg = page.locator('[data-testid$="-actual-weight"]');
      const typeInto = async (cell: ReturnType<Page['locator']>, value: number) => {
        await cell.click();
        await page.keyboard.type(String(value));
        await page.keyboard.press('Enter');
      };
      // Reproduced on production 2026-11-08 with exactly this sequence.
      const planRows = await planKg.count();
      await page.locator('[data-testid^="add-plan-set-"]').first().click();
      await expect(planKg).toHaveCount(planRows + 1);
      await typeInto(planKg.nth(planRows), 100);
      await page.waitForTimeout(2_300); // the add-set save leaves (debounce) and is in flight
      const logRows = await logKg.count();
      await page.locator('[data-testid^="add-log-set-"]').first().click();
      await expect(logKg).toHaveCount(logRows + 1);
      await typeInto(logKg.nth(logRows), 102.5);
      await page.waitForTimeout(300);
      await typeInto(planKg.nth(0), 90);
      // Edits queued behind the first save must stay on screen after its reload.
      await page.waitForTimeout(6_000);
      await expect(planKg.nth(0)).toHaveText(/(^|\D)90(\D|$)/);

      await expectQueueClean(page);
      expect(conflicts, 'no sync conflict for our own edits').toBe(0);
      await expect(page.getByText('Sync conflict needs review')).toHaveCount(0);

      // Server read has every value.
      const res = await page.request.get('/api/microcycles', { headers: API_HEADERS });
      const cycles = (await res.json()) as any[];
      const workout = cycles.flatMap((c) => c.workouts ?? []).find((w: any) => (w.title ?? '').includes(RUN_ID) && w.title === TITLE);
      const sets: any[] = workout?.exercises?.[0]?.sets ?? [];
      expect(sets[0]?.plannedWeight, 'set 1 plan kg').toBe(90);
      expect(sets.some((s) => s.plannedWeight === 100 && s.actual === 102.5), 'new set has plan 100 and log 102.5').toBe(true);
    } finally {
      await context.close();
    }
  });
});

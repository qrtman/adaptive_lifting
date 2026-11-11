import { expect, test, type Page } from '@playwright/test';
import {
  addDeadlift, cleanupRunSessions, createSession, expectQueueClean, hasCreds, logRunId,
  login, newPage, openSession, pendingMutations, serverWorkouts, sessionTitle,
} from './helpers';
import { fillEditableCell } from '../helpers';

// Regression 2026-11-11: logging kg, then reps on the same set while the kg save was being
// re-sent (another lift's save had moved this lift's version) erased the kg or raised
// "Sync conflict needs review", so a set took several attempts to log.
const TITLE = sessionTitle('log-sets');

async function addSquat(page: Page) {
  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const expand = page.getByRole('button', { name: 'Expand Squat', exact: true });
  if (await expand.isVisible().catch(() => false)) await expand.click();
}

test.describe('log sets across two lifts without conflicts', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('kg then reps then RPE on one set while saves of another lift are in flight', async ({ browser }) => {
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
      await addSquat(page);
      await expect.poll(() => pendingMutations(page), { timeout: 30_000 }).toBe(0);

      const kgCells = page.locator('[data-testid$="-actual-weight"]');
      await expect(kgCells).toHaveCount(2, { timeout: 20_000 });
      const liftIds = await kgCells.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.replace(/-actual-weight$/, '')));
      const [liftA, liftB] = liftIds;
      const cell = (lift: string, field: string) => page.getByTestId(`${lift}-${field}`).first();
      const type = async (lift: string, field: string, value: number) => {
        await fillEditableCell(cell(lift, field), value);
        await cell(lift, field).press('Enter');
      };

      // Gym-phone network: every request takes ~1.5 s longer, so a save stays in flight
      // long enough for the next cell to be typed (that is when the bug bit).
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1_500, downloadThroughput: -1, uploadThroughput: -1 });
      const sentWith = (lift: string, pick: (s: any) => unknown, value: number) => page.waitForRequest((req) => {
        if (!req.url().includes('/sync') || req.method() !== 'POST') return false;
        const changes: any[] = req.postDataJSON?.()?.changes ?? [];
        return changes.some((c) => c.id === lift && pick(c.fields?.sets?.[0]) === value);
      }, { timeout: 30_000 });

      // Each round: log kg; type reps while the kg save is in flight (reps is then based on a
      // version that save makes stale); type RPE while the reps save is in flight and gets
      // rejected as stale. Then log the other lift too.
      for (const round of [0, 1, 2]) {
        const kg = 100 + round * 10, reps = 3 + round, rpe = 7 + round;
        const kgSent = sentWith(liftA, (s) => s?.actual, kg);
        await type(liftA, 'actual-weight', kg);
        await kgSent;
        const repsSent = sentWith(liftA, (s) => s?.reps, reps);
        await type(liftA, 'reps', reps);
        await repsSent;
        await type(liftA, 'executedRpe', rpe);
        await type(liftB, 'actual-weight', 60 + round * 10);
        await expectQueueClean(page);
        expect(conflicts, `no sync conflict (round ${round + 1})`).toBe(0);
        await expect(page.getByText('Sync conflict needs review')).toHaveCount(0);

        const workout = (await serverWorkouts(page)).find((w) => w.title === TITLE);
        const setOf = (lift: string) => workout?.exercises?.find((e: any) => e.id === lift)?.sets?.[0];
        expect(setOf(liftA), `lift A set 1 fully logged (round ${round + 1})`)
          .toMatchObject({ actual: 100 + round * 10, reps: 3 + round, executedRpe: 7 + round });
        expect(setOf(liftB)?.actual, `lift B kg (round ${round + 1})`).toBe(60 + round * 10);
      }

      // And it survives a reload.
      await page.reload();
      await openSession(page, TITLE);
      await expect(cell(liftA, 'actual-weight')).toHaveText(/(^|\D)120(\D|$)/, { timeout: 20_000 });
      // A logged value, not the faint Plan target an empty Log cell shows.
      for (const field of ['actual-weight', 'reps', 'executedRpe']) await expect(cell(liftA, field)).not.toHaveAttribute('data-ghost', 'true');
      await expect(cell(liftA, 'reps')).toHaveText(/(^|\D)5(\D|$)/);
      await expect(cell(liftA, 'executedRpe')).toHaveText(/(^|\D)9(\D|$)/);
    } finally {
      await context.close();
    }
  });
});

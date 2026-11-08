import { expect, test } from '@playwright/test';
import {
  addDeadlift, cleanupRunSessions, closeAll, createSession, exactNumber, expandDeadlift, expectQueueClean, fill,
  hasCreds, logRunId, login, mutationCounts, newPage, openSession, pendingMutations, sessionTitle,
} from './helpers';

const TITLE = sessionTitle('two-device');

test.describe('production two devices', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('same account: propagation, then a conflicting offline edit is surfaced or converges', async ({ browser }) => {
    test.setTimeout(240_000);
    const a = await newPage(browser);
    const b = await newPage(browser);
    const A = a.page, B = b.page;
    try {
      await login(A);
      await createSession(A, TITLE, '2026-11-10');
      await openSession(A, TITLE, false);
      await addDeadlift(A);
      const kgId = (await A.locator('[data-testid$="-actual-weight"]').first().getAttribute('id'))!;
      await fill(A, kgId, 100);
      await expectQueueClean(A);

      // Device B sees A's work.
      await login(B);
      await openSession(B, TITLE);
      await expandDeadlift(B);
      await expect(B.locator(`#${kgId}`)).toHaveText(exactNumber(100), { timeout: 20_000 });

      // A edits offline; B edits online first and lands on the server.
      await a.context.setOffline(true);
      await expect(A.getByTestId('sync-status')).toHaveAttribute('data-state', 'offline', { timeout: 15_000 });
      await fill(A, kgId, 110);
      await fill(B, kgId, 120);
      await expectQueueClean(B);

      // A reconnects. Acceptable outcomes: the conflict card (STALE_REVISION) with the
      // server value 120, or silent convergence with no card.
      await a.context.setOffline(false);
      const keepServer = A.getByRole('button', { name: /Keep Server/i }).first();
      let outcome = 'waiting' as 'waiting' | 'conflict' | 'converged';
      await expect.poll(async () => {
        if (await keepServer.isVisible().catch(() => false)) return (outcome = 'conflict');
        const c = await mutationCounts(A);
        outcome = (c.PENDING ?? 0) + (c.IN_FLIGHT ?? 0) === 0 && !c.CONFLICTED ? 'converged' : 'waiting';
        return outcome;
      }, { timeout: 60_000, message: 'A neither showed the conflict card nor drained its queue' }).not.toBe('waiting');

      if (outcome === 'conflict') {
        // SyncContext wraps each ConflictReviewCard in a .shadow-2xl div (no testid yet).
        const card = A.locator('div.shadow-2xl').filter({ has: keepServer }).first();
        await expect(card).toContainText(/Server ·/);
        await expect(card).toContainText(exactNumber(120));
        await keepServer.click();
        await expect(A.getByRole('button', { name: /Keep Server/i })).toHaveCount(0, { timeout: 15_000 });
      }

      // Queue reaches a terminal state on A: nothing pending, rejected, or unresolved.
      await expectQueueClean(A);
      expect(await pendingMutations(A)).toBe(0);

      await B.reload();
      await openSession(B, TITLE);
      await expandDeadlift(B);
      const expected = outcome === 'conflict' ? exactNumber(120) : exactNumber(110, 120);
      await expect(A.locator(`#${kgId}`)).toHaveText(expected, { timeout: 20_000 });
      await expect(B.locator(`#${kgId}`)).toHaveText(expected, { timeout: 20_000 });
      const aText = (await A.locator(`#${kgId}`).innerText()).match(/\d+(\.\d+)?/)?.[0];
      const bText = (await B.locator(`#${kgId}`).innerText()).match(/\d+(\.\d+)?/)?.[0];
      expect(aText, 'devices converge').toBe(bText);
    } finally {
      await a.context.setOffline(false).catch(() => {});
      await closeAll(a.context, b.context);
    }
  });
});

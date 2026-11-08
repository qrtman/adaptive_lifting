import { expect, test, type Response } from '@playwright/test';
import {
  PROD_ORIGIN, RUN_ID, addDeadlift, cleanupRunSessions, createSession, exactNumber, expandDeadlift, expectQueueClean,
  fill, hasCreds, logRunId, login, newPage, openSession, pendingMutations, sessionCards, sessionTitle,
} from './helpers';

const TITLE = sessionTitle('smoke');
const isSyncPost = (r: Response) => /\/api\/workouts\/.+\/sync/.test(r.url()) && r.request().method() === 'POST';

test.describe('production smoke', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('login, secure cookies, online + offline logging, persistence, logout', async ({ browser }) => {
    const { context, page } = await newPage(browser);
    const apiFailures: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 500) apiFailures.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    try {
      await login(page);
      // Names and domains only; never put cookie values into assertion output.
      const insecure = (await context.cookies()).filter((c) => !c.secure).map((c) => `${c.name}@${c.domain}`);
      expect(insecure, 'all cookies must be Secure').toEqual([]);

      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 20_000 });

      await createSession(page, TITLE, '2026-11-09');
      await openSession(page, TITLE, false);
      await addDeadlift(page);

      const kgId = (await page.locator('[data-testid$="-actual-weight"]').first().getAttribute('id'))!;
      const repsId = (await page.locator('[data-testid$="-reps"]').first().getAttribute('id'))!;
      const rpeId = (await page.locator('[data-testid$="-executedRpe"]').first().getAttribute('id'))!;
      expect(kgId && repsId && rpeId).toBeTruthy();

      // Let the add-lift writes settle so the waiter below catches the log's own sync.
      await expect.poll(() => pendingMutations(page), { timeout: 30_000 }).toBe(0);
      await page.waitForLoadState('networkidle').catch(() => {});

      // Online log: real sync request must succeed.
      const syncOk = page.waitForResponse(isSyncPost, { timeout: 30_000 });
      await fill(page, kgId, 100);
      await fill(page, repsId, 5);
      expect((await syncOk).status()).toBe(200);
      await expectQueueClean(page);

      // Offline log, then reconnect: real flush, no mocking.
      await page.waitForLoadState('networkidle').catch(() => {});
      await context.setOffline(true);
      await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'offline', { timeout: 15_000 });
      await fill(page, rpeId, 8);
      await expect.poll(() => pendingMutations(page)).toBeGreaterThan(0);
      const statuses: number[] = [];
      page.on('response', (r) => { if (isSyncPost(r)) statuses.push(r.status()); });
      let conflicts = 0;
      await page.exposeFunction('__onConflicts', (n: number) => { conflicts += n || 1; });
      await page.evaluate(() => window.addEventListener('sync-conflicts', (e) => (window as any).__onConflicts((e as CustomEvent).detail?.length ?? 0)));
      await context.setOffline(false);
      await expect.poll(() => statuses.includes(200), { timeout: 60_000 }).toBe(true);
      await expectQueueClean(page);
      expect(conflicts, 'no conflict surfaced to the user').toBe(0);

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByPlaceholder('Password')).toBeVisible({ timeout: 15_000 });
      expect(apiFailures, '5xx API responses').toEqual([]);

      // Server persistence: a fresh context has no IndexedDB, so values must come from the server.
      const fresh = await newPage(browser);
      try {
        await login(fresh.page);
        await openSession(fresh.page, TITLE);
        await expandDeadlift(fresh.page);
        await expect(fresh.page.locator(`#${kgId}`)).toHaveText(exactNumber(100), { timeout: 20_000 });
        await expect(fresh.page.locator(`#${repsId}`)).toHaveText(exactNumber(5));
        await expect(fresh.page.locator(`#${rpeId}`)).toHaveText(exactNumber(8));
      } finally {
        await fresh.context.close();
      }
    } finally {
      await context.close();
    }
  });

  test('no foreign-domain cookies from the proxy', async ({ browser }) => {
    const { context, page } = await newPage(browser);
    try {
      const pending: Promise<string[]>[] = [];
      page.on('response', (r) => {
        if (!r.url().includes('/api/')) return;
        pending.push(r.headersArray().then((hs) => hs
          .filter((h) => h.name.toLowerCase() === 'set-cookie')
          // Keep only the Domain attribute; values never leave this function.
          .map((h) => /;\s*domain=([^;]+)/i.exec(h.value)?.[1]?.trim().toLowerCase() ?? '(host-only)')).catch(() => []));
      });
      await login(page);
      await page.waitForLoadState('networkidle').catch(() => {});
      const domains = (await Promise.all(pending)).flat();
      expect(domains.filter((d) => /supabase\.co$/.test(d)), 'Set-Cookie domains').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('mobile 360: sidebar starts collapsed', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: PROD_ORIGIN, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await login(page);
      await expect(page.locator('[data-sidebar]').first()).toHaveAttribute('data-sidebar', 'collapsed');
    } finally {
      await context.close();
    }
  });

  test('session card menu Delete is reachable on a first-row card', async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await newPage(browser);
    try {
      await login(page);
      for (let i = 0; i < 4; i++) {
        await createSession(page, sessionTitle(`menu ${i}`), '2026-11-11');
        const back = page.getByRole('button', { name: 'Back' });
        if (await back.isVisible().catch(() => false)) await back.click();
      }
      const cards = sessionCards(page, new RegExp(`E2E prod menu \\d ${RUN_ID}`));
      await expect(cards).toHaveCount(4, { timeout: 15_000 });
      const id = ((await cards.first().getAttribute('data-testid')) ?? '').replace('sessions-card-', '');
      await cards.first().locator(`[data-testid="sessions-actions-${id}"]`).click();
      // Fails if the menu item is covered by another element.
      await page.getByTestId(`sessions-delete-${id}`).click({ trial: true, timeout: 5000 });
    } finally {
      await context.close();
    }
  });
});

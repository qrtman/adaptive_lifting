import { expect, test, type Page } from '@playwright/test';
import { hasCreds, logRunId, login, newPage } from './helpers';

/** The service worker controls this page and has finished activating. */
async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && reg.active.state === 'activated' && !!navigator.serviceWorker.controller;
  }, null, { timeout: 30_000 });
}

// Neither test writes data: sign-in and page loads only.
test.describe('production offline', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());

  test('offline reopen keeps the user signed in', async ({ browser }) => {
    const { context, page } = await newPage(browser, { serviceWorkers: 'allow' });
    try {
      await page.goto('/');
      await page.reload(); // first load installs; the reload is controlled
      await waitForServiceWorker(page);
      await login(page);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.close(); // "close the app"
      await context.setOffline(true); // gym with no signal
      const again = await context.newPage();
      await again.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(again.getByTestId('nav-sessions')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.setOffline(false).catch(() => {});
      await context.close();
    }
  });

  test('signed-out offline reopen after one online visit shows the sign-in screen', async ({ browser }) => {
    const { context, page } = await newPage(browser, { serviceWorkers: 'allow' });
    try {
      await page.goto('/');
      await page.reload();
      await waitForServiceWorker(page);
      await page.waitForLoadState('networkidle').catch(() => {}); // precache finished fetching
      await context.setOffline(true);
      const again = await context.newPage();
      await again.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(again.getByPlaceholder('Password')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.setOffline(false).catch(() => {});
      await context.close();
    }
  });
});

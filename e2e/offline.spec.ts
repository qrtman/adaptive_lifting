import { expect, test } from '@playwright/test';
import { typeCell } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

test('queues a set offline and flushes it when the network returns', async ({ page, context, request }) => {
  const email = `off-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.getByTestId('sessions-add').click();
  await page.getByTestId('new-session-date').fill('2026-09-12');
  await page.getByTestId('new-session-title').fill('Offline day');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('session-inspector')).toBeVisible();
  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Hip Dominant');
  await page.getByTestId('add-lift-exercise').selectOption('Deadlift');
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Deadlift', exact: true })).toBeVisible();

  const syncPosts: string[] = [];
  await page.route('**/api/workouts/**/sync', async (route) => {
    const payload = route.request().postDataJSON() as { changes?: { mutation_id: string }[] };
    const ids = (payload.changes || []).map((change) => change.mutation_id);
    syncPosts.push(...ids);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted_mutation_ids: ids,
        rejected_mutations: [],
        conflicts: [],
      }),
    });
  });

  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'offline');

  await typeCell(page.locator('[data-testid$="-reps"]').first(), '3');
  await typeCell(page.locator('[data-testid$="-executedRpe"]').first(), '8');
  await typeCell(page.locator('[data-testid$="-actual-weight"]').first(), '190');

  await expect.poll(async () => {
    return page.evaluate(async () => {
      const dbName = 'adaptive_lifting_db';
      return await new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('mutations')) {
            resolve(0);
            return;
          }
          const tx = db.transaction('mutations', 'readonly');
          const req = tx.objectStore('mutations').getAll();
          req.onsuccess = () => {
            const rows = (req.result || []).filter((row: { status: string }) =>
              row.status === 'PENDING' || row.status === 'IN_FLIGHT'
            );
            resolve(rows.length);
          };
          req.onerror = () => reject(req.error);
        };
      });
    });
  }).toBeGreaterThan(0);

  expect(syncPosts.length).toBe(0);

  await context.setOffline(false);
  await expect.poll(() => syncPosts.length).toBeGreaterThan(0);
  await expect(page.getByTestId('sync-status')).toHaveCount(0);
});

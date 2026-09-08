import { expect, test } from '@playwright/test';
import { fillLogCell, signInCoach } from './helpers';

test('queues a set offline and flushes it when the network returns', async ({ page, context }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_sessions_expanded_micro: 'micro-3',
    al_active_workout_id: 'w-3-2',
    al_active_microcycle_id: 'micro-3',
  });

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

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'D2 · Secondary Deadlift, Secondary Bench' })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'offline');

  await fillLogCell(page, 'cell-e-3-2-1-reps-0', 3);
  await fillLogCell(page, 'cell-e-3-2-1-executedRpe-0', 8);
  await fillLogCell(page, 'cell-e-3-2-1-actual-weight-0', 190);

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

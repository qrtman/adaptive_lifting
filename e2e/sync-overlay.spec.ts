import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { fillLogCell } from './helpers';

test.use({ baseURL: 'http://localhost:3000' });

async function openSession(page: Page, request: APIRequestContext, title: string) {
  const email = `sync-overlay-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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
  await page.getByTestId('new-session-title').fill(title);
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0, { timeout: 10_000 });
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();
  await expect(page.getByTestId('session-name')).toBeVisible();
  await expect(page.getByTestId('add-lift')).toBeVisible();
}

async function topOf(page: Page, testId: string) {
  return Math.round(await page.getByTestId(testId).evaluate((el) => el.getBoundingClientRect().top));
}

test('idle overlay is unmounted; offline chip is fixed and does not shift session chrome at 360px', async ({
  page,
  context,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openSession(page, request, 'Overlay layout');
  await expect(page.getByTestId('sync-status')).toHaveCount(0);

  const sessionNameTop = await topOf(page, 'session-name');
  const addLiftTop = await topOf(page, 'add-lift');

  await context.setOffline(true);
  const chip = page.getByTestId('sync-status');
  await expect(chip).toHaveAttribute('data-state', 'offline');
  await expect(chip).toHaveCSS('position', 'fixed');
  expect(await chip.evaluate((el) => Boolean(el.closest('[data-testid="app-main"]')))).toBe(false);
  expect(await topOf(page, 'session-name')).toBe(sessionNameTop);
  expect(await topOf(page, 'add-lift')).toBe(addLiftTop);

  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveCount(0);
  expect(await topOf(page, 'session-name')).toBe(sessionNameTop);
  expect(await topOf(page, 'add-lift')).toBe(addLiftTop);
});

test('flushing shows a fixed spinner then unmounts without shifting session-name', async ({
  page,
  context,
  request,
}) => {
  await openSession(page, request, 'Overlay flush');

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Hip Dominant');
  await page.getByTestId('add-lift-result-Deadlift').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Competition Deadlift', exact: true })).toBeVisible();

  const logReps = page.locator('[data-testid$="-reps"]').first();
  const logRpe = page.locator('[data-testid$="-executedRpe"]').first();
  const logKg = page.locator('[data-testid$="-actual-weight"]').first();
  const repsId = await logReps.getAttribute('id');
  const rpeId = await logRpe.getAttribute('id');
  const kgId = await logKg.getAttribute('id');
  expect(repsId).toBeTruthy();
  expect(rpeId).toBeTruthy();
  expect(kgId).toBeTruthy();

  let releaseSync: () => void = () => {};
  const holdSync = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await page.route('**/api/workouts/**/sync', async (route) => {
    await holdSync;
    const payload = route.request().postDataJSON() as { changes?: { mutation_id: string }[] };
    const ids = (payload.changes || []).map((change) => change.mutation_id);
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

  const sessionNameTop = await topOf(page, 'session-name');
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'offline');
  expect(await topOf(page, 'session-name')).toBe(sessionNameTop);

  await fillLogCell(page, repsId!, 3);
  await fillLogCell(page, rpeId!, 8);
  await fillLogCell(page, kgId!, 190);
  expect(await topOf(page, 'session-name')).toBe(sessionNameTop);

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

  await context.setOffline(false);
  const chip = page.getByTestId('sync-status');
  await expect(chip).toHaveAttribute('data-state', 'syncing');
  await expect(chip).toHaveCSS('position', 'fixed');
  expect(await topOf(page, 'session-name')).toBe(sessionNameTop);

  releaseSync();
  await expect(page.getByTestId('sync-status')).toHaveCount(0);
  expect(await topOf(page, 'session-name')).toBe(sessionNameTop);
});

test('REJECTED mutations show data-state=error', async ({ page, request }) => {
  await openSession(page, request, 'Overlay rejected');
  await expect(page.getByTestId('sync-status')).toHaveCount(0);

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('adaptive_lifting_db');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('mutations', 'readwrite');
      tx.objectStore('mutations').put({
        mutation_id: `mut-rejected-${Date.now()}`,
        client_device_id: 'dev-e2e',
        workout_id: 'workout-e2e',
        entity_type: 'ExerciseSet',
        entity_id: 'set-e2e',
        field_path: 'ALL',
        fields: {},
        updated_at: new Date().toISOString(),
        status: 'REJECTED',
        retry_count: 0,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });

  const chip = page.getByTestId('sync-status');
  await expect(chip).toHaveAttribute('data-state', 'error', { timeout: 3000 });
  await expect(chip).toHaveCSS('position', 'fixed');
  await expect(chip).not.toHaveAttribute('data-state', 'syncing');
});

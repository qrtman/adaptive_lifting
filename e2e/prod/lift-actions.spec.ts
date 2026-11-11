import { expect, test } from '@playwright/test';
import {
  API_HEADERS, cleanupRunSessions, expectQueueClean, hasCreds, logRunId, login, newPage, openSession,
  RUN_ID, selectMyTraining, serverWorkouts, sessionTitle,
} from './helpers';

// Session sheet phases 4–5: add a lift by typing, arrows cross lifts, Duplicate, drag a lift
// from the week rail (copies its Plan only).
const BLOCK = `E2E actions ${RUN_ID}`;

test.describe('lift actions on the session screen', () => {
  test.skip(!hasCreds, 'E2E_EMAIL / E2E_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => { if (hasCreds) await cleanupRunSessions(browser); });

  test('type to add, keyboard across lifts, duplicate, drag from the rail', async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await newPage(browser);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page);
      const me = await (await page.request.get('/api/auth/me', { headers: API_HEADERS })).json();
      const selfId = String(me?.user?.id ?? me?.id);
      const isCoach = String(me?.user?.role ?? me?.role).toUpperCase() === 'COACH';
      const post = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => {
        let res = await page.request[method](path, { headers: API_HEADERS, data });
        for (let i = 1; res.status() === 503 && i < 4; i += 1) { await page.waitForTimeout(1000 * i); res = await page.request[method](path, { headers: API_HEADERS, data }); }
        expect(res.ok(), `${method} ${path}: ${res.status()} ${res.ok() ? '' : (await res.text()).slice(0, 200)}`).toBeTruthy();
        return res.json();
      };
      const session = (date: string, title: string, day: string, labeled = true) => post('/api/sessions', {
        date, title, dayLabel: day, ...(labeled ? { weekLabel: '7', blockLabel: BLOCK } : {}), ...(isCoach ? { athleteId: selfId } : {}),
      });
      // Day 1 already has a Row with 2 Plan sets and one logged value (the log must not be copied).
      const day1 = await session('2026-12-21', sessionTitle('actions-d1'), '1');
      const row = await post(`/api/sessions/${day1.id}/exercises`, { title: 'Barbell Row', variation: 'Barbell Row', tier: 'Accessory', liftCategory: 'Other', movementPattern: 'Horizontal Pull' });
      // The create reply has no revision; read the lift's current one first.
      const rowRevision = (await serverWorkouts(page)).find((w) => w.id === day1.id)?.exercises?.find((e: any) => e.id === row.id)?.revision ?? 0;
      await post(`/api/sessions/${day1.id}/exercises/${row.id}/sets`, {
        expected_revision: rowRevision,
        sets: [
          { label: 'Set 1', scope: 'both', plannedWeight: 70, plannedReps: 10, intensityType: 'RPE', dropPercent: 0, actual: 70, reps: 10 },
          { label: 'Set 2', scope: 'both', plannedWeight: 70, plannedReps: 10, intensityType: 'RPE', dropPercent: 0 },
        ],
      }, 'put');
      // Day 3 closes the week's dates; Day 2 has no Week label, sits inside them (the rail shows
      // it with this week) and is easy to open from Sessions › Unassigned.
      await session('2026-12-25', sessionTitle('actions-d3'), '3');
      const d2Title = sessionTitle('actions-d2');
      await session('2026-12-23', d2Title, '2', false);

      await page.reload();
      await expect(page.getByTestId('nav-sessions')).toBeVisible({ timeout: 25_000 });
      if (isCoach) await selectMyTraining(page);
      await openSession(page, d2Title);
      await expect(page.getByTestId('session-name')).toHaveText('Day 2', { timeout: 20_000 });

      // An empty session shows the Add lift button; add Bench with it first, then type the rest.
      await page.getByTestId('add-lift').click();
      await page.getByTestId('add-lift-search').fill('Bench');
      await page.getByTestId('add-lift-result-Bench').click();
      await page.getByTestId('add-lift-confirm').click();
      const input = page.getByTestId('inline-add-lift-input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill('Squat');
      await expect(page.getByTestId('inline-add-lift-options')).toContainText('Squat');
      await input.press('Tab');
      // Tab added Squat and put the keyboard in its first Plan cell.
      await expect(page.locator('[data-cell-id$=":0:plan:kg"]')).toHaveCount(2, { timeout: 20_000 });
      await expect(page.locator(':focus')).toHaveAttribute('data-cell-id', /:0:plan:kg$/, { timeout: 10_000 });
      const liftIds = await page.locator('[data-lift-grid-host]').evaluateAll((els) => els.map((el) => el.getAttribute('data-lift-grid-host')!));
      expect(liftIds).toHaveLength(2);
      const [benchId, squatId] = liftIds;
      await expect(page.locator(':focus')).toHaveAttribute('data-cell-id', `${squatId}:0:plan:kg`);

      // Arrow up from Squat's first row lands on Bench's last row, same column.
      await page.keyboard.press('ArrowUp');
      await expect(page.locator(':focus')).toHaveAttribute('data-cell-id', new RegExp(`^${benchId}:\\d+:plan:kg$`));

      // Duplicate Bench from the ⋯ menu.
      await page.getByTestId(`lift-menu-${benchId}`).click();
      await page.getByTestId(`lift-duplicate-${benchId}`).click();
      await expect(page.locator('[data-lift-grid-host]')).toHaveCount(3, { timeout: 20_000 });

      // Drag Barbell Row from Day 1 in the rail into this session.
      await page.getByTestId(`week-rail-lift-${row.id}`).dragTo(page.getByTestId('session-lifts'));
      await expect(page.locator('[data-lift-grid-host]')).toHaveCount(4, { timeout: 20_000 });
      await expectQueueClean(page);

      const day2 = (await serverWorkouts(page)).find((w) => w.title === d2Title);
      const lifts = (day2?.exercises ?? []) as Array<{ title: string; sets: Array<Record<string, unknown>> }>;
      expect(lifts.map((l) => l.title).sort()).toEqual(['Barbell Row', 'Bench', 'Bench', 'Squat']);
      const copiedRow = lifts.find((l) => l.title === 'Barbell Row')!;
      expect(copiedRow.sets.map((s) => [s.plannedWeight, s.plannedReps, s.actual ?? null, s.reps ?? null])).toEqual([[70, 10, null, null], [70, 10, null, null]]);
    } finally {
      await context.close();
    }
  });
});

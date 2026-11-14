import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fillLogCell } from '../helpers';

export const PROD_ORIGIN = process.env.E2E_PROD_URL || 'https://app.goatedmethod.me';
/** Register and other mutating API calls made outside the UI must send this header. */
export const API_HEADERS = { Origin: PROD_ORIGIN };

export const creds = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
  coachEmail: process.env.E2E_COACH_EMAIL,
  coachPassword: process.env.E2E_COACH_PASSWORD,
};
export const hasCreds = Boolean(creds.email && creds.password);
export const hasCoachCreds = hasCreds && Boolean(creds.coachEmail && creds.coachPassword);

/** Unique per run so cleanup only ever touches rows this run created. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const TITLE_PREFIX = 'E2E prod';
export const sessionTitle = (label: string) => `${TITLE_PREFIX} ${label} ${RUN_ID}`;
let runIdLogged = false;
/** Print the run id once so leftovers can be found and removed by hand. */
export function logRunId() {
  if (runIdLogged) return;
  runIdLogged = true;
  console.log(`[prod e2e] RUN_ID=${RUN_ID} (session titles: "${TITLE_PREFIX} <label> ${RUN_ID}")`);
}

/** Matches a cell's text holding exactly this number (so 1110 never matches 110). */
export const exactNumber = (...values: number[]) => new RegExp(`(^|[^\\d.])(${values.join('|')})([^\\d.]|$)`);

export async function newPage(browser: Browser, opts: { serviceWorkers?: 'allow' | 'block' } = {}) {
  const context = await browser.newContext({ baseURL: PROD_ORIGIN, serviceWorkers: opts.serviceWorkers ?? 'block' });
  return { context, page: await context.newPage() };
}

export async function login(page: Page, email = creds.email!, password = creds.password!) {
  await page.goto('/');
  // Fill only after the app has hydrated; an early submit is silently dropped.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.locator('button[type=submit]').click();
  // Desktop shows the sidebar; phones (< 768px) show the bottom tab bar instead.
  await expect(page.locator('[data-testid="nav-sessions"]:visible, [data-testid="tab-sessions"]:visible').first()).toBeVisible({ timeout: 25_000 });
}

type MutationStatus = 'PENDING' | 'IN_FLIGHT' | 'ACKED' | 'REJECTED' | 'CONFLICTED' | 'RESOLVED_SERVER';

/** Count IndexedDB sync-queue rows by status. Empty object when no queue exists yet. */
export async function mutationCounts(page: Page): Promise<Partial<Record<MutationStatus, number>>> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const info = dbs.find((d) => d.name?.startsWith('adaptive_lifting'));
    if (!info?.name) return {};
    return await new Promise<Record<string, number>>((resolve, reject) => {
      const open = indexedDB.open(info.name!);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('mutations')) { resolve({}); return; }
        const req = db.transaction('mutations', 'readonly').objectStore('mutations').getAll();
        req.onsuccess = () => {
          const counts: Record<string, number> = {};
          for (const row of (req.result || []) as { status: string }[]) counts[row.status] = (counts[row.status] ?? 0) + 1;
          resolve(counts);
        };
        req.onerror = () => reject(req.error);
      };
    });
  });
}

export async function pendingMutations(page: Page) {
  const c = await mutationCounts(page);
  return (c.PENDING ?? 0) + (c.IN_FLIGHT ?? 0);
}

/** Queue is drained and nothing ended rejected or in unresolved conflict. */
export async function expectQueueClean(page: Page) {
  await expect.poll(() => pendingMutations(page), { timeout: 30_000 }).toBe(0);
  const c = await mutationCounts(page);
  expect({ rejected: c.REJECTED ?? 0, conflicted: c.CONFLICTED ?? 0 }, 'no rejected or conflicted sync rows').toEqual({ rejected: 0, conflicted: 0 });
}

export const sessionCards = (page: Page, title: string | RegExp) =>
  page.locator('[data-testid^="sessions-card-"]').filter({ hasText: title });

/** Sessions view finished loading: at least one card or the empty state. */
export async function waitForSessionsList(page: Page) {
  await expect(page.locator('[data-testid^="sessions-card-"]').or(page.getByTestId('sessions-empty')).first()).toBeVisible({ timeout: 20_000 });
}

export async function createSession(page: Page, title: string, date: string) {
  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.getByTestId('sessions-add').click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-date').fill(date);
  await page.getByTestId('new-session-title').fill(title);
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Test sessions carry no Block label. On an account that already uses Block labels the
 * Sessions view shows one block at a time, so switch to "Unassigned" when it exists.
 */
export async function showUnassigned(page: Page) {
  await waitForSessionsList(page);
  // Block tabs render only when there are 2+ choices; a just-created unlabeled session
  // adds the "Unassigned" tab a moment after the plan loads.
  const tab = page.getByTestId('sessions-block-tab-unassigned');
  await tab.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await tab.isVisible().catch(() => false)) {
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  }
}

export async function openSession(page: Page, title: string, navigate = true) {
  if (navigate) await page.getByRole('button', { name: 'Sessions' }).click();
  const card = sessionCards(page, title);
  // The block picker can reset to the first block while the plan finishes loading, so
  // select "Unassigned" and click the card as one retried step.
  await expect(async () => {
    await showUnassigned(page);
    await expect(card).toHaveCount(1, { timeout: 2_000 });
    await card.locator('button').first().click({ timeout: 2_000 });
  }).toPass({ timeout: 40_000 });
}

export async function expandDeadlift(page: Page) {
  // The session opens before its lifts render on a slow link; wait for the lift first.
  await expect(page.getByRole('heading', { name: 'Deadlift', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const expand = page.getByRole('button', { name: 'Expand Deadlift', exact: true });
  if (await expand.isVisible().catch(() => false)) await expand.click();
}

export async function addDeadlift(page: Page) {
  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-result-Deadlift').click();
  await page.getByTestId('add-lift-confirm').click();
  // Production add-lift is a save plus a full plan reload (several seconds from far regions).
  await expect(page.getByRole('heading', { name: 'Deadlift', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  // A just-added lift opens expanded; only older builds needed the click.
  const expand = page.getByRole('button', { name: 'Expand Deadlift', exact: true });
  if (await expand.isVisible().catch(() => false)) await expand.click();
}

export const fill = (page: Page, id: string, value: number) => fillLogCell(page, id, value);

/**
 * Coach accounts: switch the sidebar plan to the coach's own training. Waits for the
 * switcher to finish loading first; a pick made in the first moments after sign-in can be
 * reset while the account loads.
 */
export async function selectMyTraining(page: Page) {
  const selector = page.getByTestId('athlete-scope-selector');
  await expect(selector).toBeVisible({ timeout: 20_000 });
  await expect(selector).not.toHaveText('Select athlete…', { timeout: 20_000 });
  await expect(async () => {
    if ((await selector.textContent())?.trim() !== 'My training') {
      await selector.click();
      await page.getByRole('option', { name: /My training/ }).click({ timeout: 2_000 });
    }
    await expect(selector).toHaveText('My training', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

type ServerWorkout = { id: string; title?: string; deletedAt?: unknown; deleted_at?: unknown; exercises?: any[] };

/** Every workout this account can see on the server, its own plan included (a coach's too). */
export async function serverWorkouts(page: Page): Promise<ServerWorkout[]> {
  // Without athlete_id a coach gets only linked athletes' plans, so also read the account's own plan.
  const me = await page.request.get('/api/auth/me', { headers: API_HEADERS });
  const meBody = me.ok() ? await me.json() : {};
  const selfId = String(meBody?.user?.id ?? meBody?.id ?? '');
  const paths = ['/api/microcycles', ...(selfId ? [`/api/microcycles?athlete_id=${encodeURIComponent(selfId)}`] : [])];
  const byId = new Map<string, ServerWorkout>();
  for (const path of paths) {
    const res = await page.request.get(path, { headers: API_HEADERS });
    expect(res.ok(), `GET ${path} ${res.status()}`).toBeTruthy();
    const cycles = (await res.json()) as { workouts?: ServerWorkout[] }[];
    for (const w of (Array.isArray(cycles) ? cycles : []).flatMap((c) => c.workouts ?? [])) byId.set(w.id, w);
  }
  return [...byId.values()];
}

/** Server-side read: this account's sessions whose title carries this run id. */
export async function serverRunSessions(page: Page): Promise<string[]> {
  return (await serverWorkouts(page))
    .filter((w) => (w.title ?? '').includes(RUN_ID) && !w.deletedAt && !w.deleted_at)
    .map((w) => w.id);
}

/**
 * Delete every session whose title contains this run's id, then confirm from a
 * second fresh signed-in context (server read) that none survive.
 */
export async function cleanupRunSessions(browser: Browser, email = creds.email!, password = creds.password!) {
  const { context, page } = await newPage(browser);
  try {
    await login(page, email, password);
    // Let queued edits land first, so a late sync cannot recreate anything we delete.
    await expect.poll(() => pendingMutations(page), { timeout: 30_000 }).toBe(0);
    // Delete through the API by id. The Sessions view shows one Block at a time and loads
    // its picker asynchronously, so clicking cards silently missed sessions on real accounts.
    for (const id of await serverRunSessions(page)) {
      const res = await page.request.delete(`/api/sessions/${encodeURIComponent(id)}`, { headers: API_HEADERS });
      expect(res.ok(), `DELETE /api/sessions/${id} ${res.status()}`).toBeTruthy();
    }
  } finally {
    await context.close();
  }

  const verify = await newPage(browser);
  try {
    await login(verify.page, email, password);
    await expect.poll(() => serverRunSessions(verify.page).then((ids) => ids.length), {
      timeout: 30_000, message: `server still has sessions for RUN_ID=${RUN_ID}`,
    }).toBe(0);
  } finally {
    await verify.context.close();
  }
}

export async function closeAll(...contexts: BrowserContext[]) {
  for (const c of contexts) await c.close().catch(() => {});
}

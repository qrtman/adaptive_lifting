import { expect, test, type Page } from '@playwright/test';
import { API_HEADERS, closeAll, creds, hasCoachCreds, logRunId, login, newPage } from './helpers';

// Needs a dedicated test coach (E2E_COACH_EMAIL / E2E_COACH_PASSWORD) and the
// athlete account (E2E_EMAIL / E2E_PASSWORD).
//
// Safety: an athlete can have only one active coach (link returns already_linked
// otherwise), so this test never touches a pre-existing link. It skips when the
// athlete is already linked, and cleanup unlinks from the TEST COACH side for this
// one athlete id (DELETE /api/auth/link/{athleteId}), which can only end the
// test coach's own relationship. Emails are never printed or used as locators.

type RosterRow = { id: string; email: string };

async function roster(coach: Page): Promise<RosterRow[]> {
  const res = await coach.request.get('/api/coach/roster', { headers: API_HEADERS });
  expect(res.ok(), `GET /api/coach/roster ${res.status()}`).toBeTruthy();
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
const athleteIdIn = (rows: RosterRow[]) =>
  rows.find((r) => r.email?.toLowerCase() === creds.email!.toLowerCase())?.id ?? null;

test.describe('production coach link', () => {
  test.skip(!hasCoachCreds, 'E2E_EMAIL/E2E_PASSWORD and E2E_COACH_EMAIL/E2E_COACH_PASSWORD not all set');
  test.beforeAll(() => logRunId());

  test('coach code, athlete links, coach roster shows athlete, coach unlinks', async ({ browser }) => {
    test.setTimeout(240_000);
    const c = await newPage(browser);
    const a = await newPage(browser);
    const C = c.page, A = a.page;
    const security = (p: Page) => p.getByRole('button', { name: 'Security' }).click();
    let linkedAthleteId: string | null = null;
    try {
      await login(C, creds.coachEmail!, creds.coachPassword!);
      test.skip(athleteIdIn(await roster(C)) !== null, 'athlete is already linked to the test coach; leaving that link alone');

      await security(C);
      await expect(C.getByTestId('coach-link-panel').first()).toBeVisible({ timeout: 15_000 });
      if (!(await C.getByTestId('coach-code-value').isVisible().catch(() => false))) {
        await C.getByTestId('coach-code-generate').click();
      }
      await expect(C.getByTestId('coach-code-value')).toBeVisible({ timeout: 15_000 });
      const code = (await C.getByTestId('coach-code-value').innerText()).trim();
      expect(code.length).toBeGreaterThan(0);

      await login(A);
      await security(A);
      await A.getByTestId('athlete-link-input').fill(code);
      const linkResponse = A.waitForResponse((r) => /\/api\/auth\/link(-athlete)?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
      await A.getByTestId('athlete-link-submit').click();
      const res = await linkResponse;
      if (!res.ok()) {
        const body = await res.text().catch(() => '');
        test.skip(/already[_ ]linked/i.test(body), 'athlete already has an active coach; not touching that link');
        throw new Error(`link request failed with HTTP ${res.status()}`);
      }
      await expect(A.getByTestId('athlete-link-success')).toBeVisible({ timeout: 15_000 });

      // Linked flag is set only once the test coach's roster really shows this athlete.
      await expect.poll(async () => (linkedAthleteId = athleteIdIn(await roster(C))), { timeout: 20_000 }).not.toBeNull();

      await C.reload();
      await expect(C.getByTestId('nav-roster')).toBeVisible({ timeout: 25_000 });
      await C.getByTestId('nav-roster').click();
      await expect(C.getByTestId(`roster-athlete-${linkedAthleteId}`)).toBeVisible({ timeout: 15_000 });
    } finally {
      if (linkedAthleteId) {
        const res = await C.request.delete(`/api/auth/link/${encodeURIComponent(linkedAthleteId)}`, { headers: API_HEADERS });
        expect(res.ok(), `coach unlink HTTP ${res.status()}`).toBeTruthy();
        await expect.poll(async () => athleteIdIn(await roster(C)), { timeout: 20_000, message: 'athlete still on test coach roster' }).toBeNull();
      }
      await closeAll(c.context, a.context);
    }
  });
});

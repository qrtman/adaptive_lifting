import { expect, test } from '@playwright/test';
import {
  addDeadlift, cleanupRunSessions, createSession, creds, expectQueueClean, hasCoachCreds, logRunId,
  login, newPage, openSession, pendingMutations, selectMyTraining, sessionTitle,
} from './helpers';
import { fillEditableCell } from '../helpers';

// 2026-11-11: a coach account keeps its own training plan ("My training"). Before the fix the
// plan reads and writes only followed coaching links, so a promoted coach lost their own sessions.
// Run with a coach account that has NO coaching access grant: own training must not need one.
const TITLE = sessionTitle('coach-own-plan');

test.describe('coach trains on their own plan', () => {
  test.skip(!hasCoachCreds, 'E2E_COACH_EMAIL / E2E_COACH_PASSWORD not set');
  test.beforeAll(() => logRunId());
  test.afterAll(async ({ browser }) => {
    if (hasCoachCreds) await cleanupRunSessions(browser, creds.coachEmail!, creds.coachPassword!);
  });

  test('My training: create, plan, log, reload; Insights open', async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await newPage(browser);
    try {
      await login(page, creds.coachEmail!, creds.coachPassword!);
      await selectMyTraining(page);
      const selector = page.getByTestId('athlete-scope-selector');

      await createSession(page, TITLE, '2026-11-12');
      await openSession(page, TITLE, false);
      await addDeadlift(page);
      await expect.poll(() => pendingMutations(page), { timeout: 30_000 }).toBe(0);

      const kg = page.locator('[data-testid$="-actual-weight"]').first();
      const lift = (await kg.getAttribute('data-testid'))!.replace(/-actual-weight$/, '');
      await fillEditableCell(kg, 140);
      await kg.press('Enter');
      const reps = page.getByTestId(`${lift}-reps`).first();
      await fillEditableCell(reps, 4);
      await reps.press('Enter');
      await expectQueueClean(page);
      await expect(page.getByText('Sync conflict needs review')).toHaveCount(0);

      await page.reload();
      // The switcher does not remember the pick across a reload yet (it reopens on the first
      // linked athlete), so choose the coach's own plan again.
      await selectMyTraining(page);
      await expect(selector).toHaveText('My training', { timeout: 20_000 });
      await openSession(page, TITLE);
      await expect(page.getByTestId(`${lift}-actual-weight`).first()).toHaveText(/(^|\D)140(\D|$)/, { timeout: 20_000 });
      await expect(page.getByTestId(`${lift}-reps`).first()).toHaveText(/(^|\D)4(\D|$)/);
      await expect(page.getByTestId(`${lift}-actual-weight`).first()).not.toHaveAttribute('data-ghost', 'true');

      await page.getByTestId('nav-insights').click();
      await expect(page.getByTestId('insights-add-card')).toBeEnabled({ timeout: 20_000 });
      await expect(page.getByText('This coaching plan does not include analytics.')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

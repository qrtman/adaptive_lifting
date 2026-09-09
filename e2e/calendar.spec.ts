import { expect, test } from '@playwright/test';
import { cardOnDate, html5Drag, signInCoach } from './helpers';

test.describe('calendar week boards', () => {
  test.beforeEach(async ({ page }) => {
    await signInCoach(page, {
      al_dashboard_mode: 'calendar',
      al_app_view: 'dashboard',
    });
    await page.goto('/');
    await page.getByTestId('nav-calendar').click();
    await expect(page.getByTestId('athlete-switcher')).toBeVisible();
  });

  test('shows sessions as a list, not a month grid', async ({ page }) => {
    await expect(page.getByTestId('assign-micro-z-w3')).toBeVisible();
    await expect(page.getByTestId('week-board-z-w3')).toBeVisible();
    await expect(page.getByTestId('week-sessions-z-w3').locator('[data-testid^="workout-card-"]')).not.toHaveCount(0);
    await expect(page.locator('[data-testid^="calendar-day-"]')).toHaveCount(0);
    await expect(page.getByTestId('add-session-dialog')).toHaveCount(0);
    await expect(page.getByText('Click a day to add a session')).toHaveCount(0);
  });

  test('adds a session with a date field and moves it within the same week', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('add-session-date-z-w3').fill('2026-09-05');
    await page.getByTestId('add-session-week-z-w3').click();
    const added = await cardOnDate(page, '2026-09-05');
    expect(added).toBeTruthy();
    await added!.input.fill('2026-09-06');
    await expect(page.getByTestId(`calendar-session-date-${added!.workoutId}`)).toHaveValue('2026-09-06');
    await expect(page.getByTestId('calendar-boundary-lock')).toHaveCount(0);
  });

  test('rejects a drop onto another week', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('add-session-date-z-w3').fill('2026-09-05');
    await page.getByTestId('add-session-week-z-w3').click();
    const first = await cardOnDate(page, '2026-09-05');
    expect(first).toBeTruthy();

    await html5Drag(page, first!.cardTestId, 'week-board-z-w5');
    await expect(page.getByTestId('calendar-boundary-lock')).toBeVisible();
    await expect(page.getByTestId(`calendar-session-date-${first!.workoutId}`)).toHaveValue('2026-09-05');
    await expect(page.getByTestId('week-sessions-z-w5').locator(`[data-testid="${first!.cardTestId}"]`)).toHaveCount(0);
  });

  test('lets the coach widen week dates and move a session with the date field', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await expect(page.getByTestId('micro-bound-start-z-w3')).toHaveValue('2026-08-31');
    await expect(page.getByTestId('micro-bound-end-z-w3')).toHaveValue('2026-09-06');
    await page.getByTestId('micro-bound-end-z-w3').fill('2026-09-20');
    await page.getByTestId('add-session-date-z-w3').fill('2026-09-05');
    await page.getByTestId('add-session-week-z-w3').click();
    const card = await cardOnDate(page, '2026-09-05');
    expect(card).toBeTruthy();
    await card!.input.fill('2026-09-16');
    await expect(page.getByTestId('calendar-boundary-lock')).toHaveCount(0);
    await expect(page.getByTestId(`calendar-session-date-${card!.workoutId}`)).toHaveValue('2026-09-16');
  });

  test('copies the week onto a later week', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await expect(page.getByTestId('copy-microcycle-z-w3')).toBeVisible();
    await page.getByTestId('copy-microcycle-z-w3').click();
    await expect(page.getByRole('button', { name: 'Week 3 copy' })).toBeVisible();
  });

  test('deletes a session from the week board', async ({ page }) => {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('add-session-date-z-w3').fill('2026-09-05');
    await page.getByTestId('add-session-week-z-w3').click();
    const card = await cardOnDate(page, '2026-09-05');
    expect(card).toBeTruthy();
    await page.getByTestId(`delete-session-${card!.workoutId}`).click();
    await expect(page.getByTestId(card!.cardTestId)).toHaveCount(0);
  });
});

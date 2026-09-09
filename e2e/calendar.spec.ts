import { expect, test } from '@playwright/test';
import { html5Drag, signInCoach } from './helpers';

test.describe('calendar drag and drop', () => {
  test.beforeEach(async ({ page }) => {
    await signInCoach(page, {
      al_dashboard_mode: 'calendar',
      al_app_view: 'dashboard',
    });
    await page.goto('/');
    await page.getByTestId('nav-calendar').click();
    await expect(page.getByTestId('athlete-switcher')).toBeVisible();
  });

  test('places undated sessions on the month grid', async ({ page }) => {
    await expect(page.getByTestId('assign-micro-z-w3')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-09-01').locator('[data-testid^="workout-card-"]')).toBeVisible();
    await expect(page.getByTestId('add-session-dialog')).toHaveCount(0);
  });

  test('adds a session and moves it within the same week', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('calendar-day-2026-09-05').click();
    const card = page.getByTestId('calendar-day-2026-09-05').locator('[data-testid^="workout-card-"]');
    await expect(card).toBeVisible();
    const testId = await card.getAttribute('data-testid');
    expect(testId).toBeTruthy();
    await html5Drag(page, testId!, 'calendar-day-2026-09-06');
    await expect(page.getByTestId('calendar-day-2026-09-06').locator(`[data-testid="${testId}"]`)).toBeVisible();
  });

  test('rejects a drop across a microcycle week boundary', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('calendar-day-2026-09-05').click();
    const first = page.getByTestId('calendar-day-2026-09-05').locator('[data-testid^="workout-card-"]');
    await expect(first).toBeVisible();
    const firstId = await first.getAttribute('data-testid');

    await html5Drag(page, firstId!, 'calendar-day-2026-09-16');
    await expect(page.getByTestId('calendar-boundary-lock')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-09-05').locator(`[data-testid="${firstId}"]`)).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-09-16').locator(`[data-testid="${firstId}"]`)).toHaveCount(0);
  });
});

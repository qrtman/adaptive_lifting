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
    await expect(page.getByTestId('add-session-calendar')).toBeVisible();
  });

  test('adds a session and moves it within the same week', async ({ page }) => {
    await page.getByTestId('add-session-calendar').click();
    await expect(page.getByTestId('add-session-dialog')).toBeVisible();
    await page.getByTestId('session-day-2026-09-02').click();
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('create-session').click();

    const card = page.getByTestId('calendar-day-2026-09-02').locator('[data-testid^="workout-card-"]');
    await expect(card).toBeVisible();
    const testId = await card.getAttribute('data-testid');
    expect(testId).toBeTruthy();
    await html5Drag(page, testId!, 'calendar-day-2026-09-03');
    await expect(page.getByTestId('calendar-day-2026-09-03').locator(`[data-testid="${testId}"]`)).toBeVisible();
  });

  test('rejects a drop across a microcycle week boundary', async ({ page }) => {
    await page.getByTestId('add-session-calendar').click();
    await page.getByTestId('session-day-2026-09-02').click();
    await page.getByTestId('assign-micro-z-w3').click();
    await page.getByTestId('create-session').click();
    const first = page.getByTestId('calendar-day-2026-09-02').locator('[data-testid^="workout-card-"]');
    await expect(first).toBeVisible();
    const firstId = await first.getAttribute('data-testid');

    await page.getByTestId('add-session-calendar').click();
    await page.getByTestId('session-day-2026-09-16').click();
    await page.getByTestId('assign-micro-z-w4').click();
    await page.getByTestId('create-session').click();
    await expect(page.getByTestId('calendar-day-2026-09-16').locator('[data-testid^="workout-card-"]')).toBeVisible();

    await html5Drag(page, firstId!, 'calendar-day-2026-09-16');
    await expect(page.getByTestId('calendar-boundary-lock')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-09-02').locator(`[data-testid="${firstId}"]`)).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-09-16').locator(`[data-testid="${firstId}"]`)).toHaveCount(0);
  });
});

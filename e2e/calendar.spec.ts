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
    await expect(page.getByTestId('workout-card-w-1-1')).toBeVisible();
  });

  test('moves a workout within the same microcycle week', async ({ page }) => {
    await html5Drag(page, 'workout-card-w-1-1', 'calendar-day-2026-09-03');
    await expect(page.getByTestId('calendar-day-2026-09-03').getByTestId('workout-card-w-1-1')).toBeVisible();
  });

  test('rejects a drop across a microcycle week boundary', async ({ page }) => {
    await html5Drag(page, 'workout-card-w-1-1', 'calendar-day-2026-09-08');
    await expect(page.getByTestId('calendar-boundary-lock')).toBeVisible();
    await expect(page.getByTestId('calendar-boundary-lock')).toContainText('Periodization Boundary Lock');
    await expect(page.getByTestId('calendar-day-2026-09-02').getByTestId('workout-card-w-1-1')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-09-08').getByTestId('workout-card-w-1-1')).toHaveCount(0);
  });
});

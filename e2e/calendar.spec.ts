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

  test('lets the coach widen week dates and drag inside the new range', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await expect(page.getByTestId('micro-bound-start-z-w3')).toHaveValue('2026-08-31');
    await expect(page.getByTestId('micro-bound-end-z-w3')).toHaveValue('2026-09-06');
    await page.getByTestId('micro-bound-end-z-w3').fill('2026-09-20');
    await page.getByTestId('calendar-day-2026-09-05').click();
    const card = page.getByTestId('calendar-day-2026-09-05').locator('[data-testid^="workout-card-"]');
    await expect(card).toBeVisible();
    const testId = await card.getAttribute('data-testid');
    await html5Drag(page, testId!, 'calendar-day-2026-09-16');
    await expect(page.getByTestId('calendar-boundary-lock')).toHaveCount(0);
    await expect(page.getByTestId('calendar-day-2026-09-16').locator(`[data-testid="${testId}"]`)).toBeVisible();
  });

  test('copies the assigned microcycle onto a later week', async ({ page }) => {
    await page.getByTestId('assign-micro-z-w3').click();
    await expect(page.getByTestId('copy-microcycle-z-w3')).toBeVisible();
    await page.getByTestId('copy-microcycle-z-w3').click();
    await expect(page.getByRole('button', { name: 'Week 3 copy' })).toBeVisible();
  });
});

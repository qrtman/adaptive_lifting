import { expect, test } from '@playwright/test';
import { signInCoach } from './helpers';

test.describe('navigation consolidation', () => {
  test('redirects roster hash to calendar and focuses athlete scope', async ({ page }) => {
    await signInCoach(page, {
      al_app_view: 'dashboard',
      al_dashboard_mode: 'roster',
    });
    await page.goto('/#/roster');
    await expect(page.getByTestId('nav-calendar')).toBeVisible();
    await expect(page.getByTestId('athlete-scope-selector')).toBeVisible();
    await expect(page).toHaveURL(/#\/calendar/);
    await expect(page.getByTestId('nav-roster')).toHaveCount(0);
    await expect(page.getByTestId('nav-insights')).toBeVisible();
    await page.getByTestId('nav-insights').click();
    await expect(page).toHaveURL(/#\/insights/);
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  });

  test('persists sidebar collapse', async ({ page }) => {
    await signInCoach(page, { al_app_view: 'dashboard', al_dashboard_mode: 'calendar' });
    await page.goto('/');
    await page.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
  });
});

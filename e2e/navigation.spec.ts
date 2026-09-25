import { expect, test } from '@playwright/test';
import { signInCoach } from './helpers';

test.describe('navigation consolidation', () => {
  test('opens the coach Roster workspace and keeps the athlete switcher available', async ({ page }) => {
    await signInCoach(page, {
      al_app_view: 'dashboard',
      al_dashboard_mode: 'roster',
    });
    await page.route('**/api/coach/roster', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'ath-1', email: 'athlete1@example.test', activeMicrocycles: 0 },
        { id: 'ath-2', email: 'athlete2@example.test', activeMicrocycles: 0 },
        { id: 'ath-3', email: 'athlete3@example.test', activeMicrocycles: 0 },
      ]),
    }));
    await page.goto('/#/roster');
    await expect(page.getByTestId('nav-roster')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
    await expect(page.getByTestId('athlete-scope-selector')).toBeVisible();
    await expect(page.getByTestId('roster-list').getByRole('listitem')).toHaveCount(3);

    await page.getByTestId('roster-search').fill('athlete3');
    await expect(page.getByTestId('roster-list').getByRole('listitem')).toHaveCount(1);
    await page.getByTestId('roster-athlete-ath-3').focus();
    await page.getByTestId('roster-athlete-ath-3').press('Enter');
    await expect(page).toHaveURL(/#\/calendar\?athlete=ath-3/);
    await expect(page.getByTestId('nav-calendar')).toBeVisible();
  });

  test('routes the legacy athletes link to Roster', async ({ page }) => {
    await signInCoach(page, { al_app_view: 'dashboard', al_dashboard_mode: 'calendar' });
    await page.route('**/api/coach/roster', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }));
    await page.goto('/#/athletes');
    await expect(page.getByTestId('nav-roster')).toBeVisible();
    await expect(page.getByTestId('roster-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Open Security' }).click();
    await expect(page).toHaveURL(/#\/security/);
  });

  test('shows a permission-denied state to athletes and hides Roster navigation', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('al_role', 'ATHLETE');
      localStorage.setItem('al_role_mode', 'athlete');
      localStorage.setItem('al_app_view', 'dashboard');
    });
    await page.goto('/#/roster');
    await expect(page.getByTestId('roster-permission-denied')).toBeVisible();
    await expect(page.getByTestId('nav-roster')).toHaveCount(0);
    await page.getByRole('button', { name: 'Go to Calendar' }).click();
    await expect(page).toHaveURL(/#\/calendar/);
  });

  test('shows a recoverable roster load error', async ({ page }) => {
    await signInCoach(page, { al_app_view: 'dashboard', al_dashboard_mode: 'roster' });
    let requestCount = 0;
    await page.route('**/api/coach/roster', (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Temporarily unavailable"}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.goto('/#/roster');
    await expect(page.getByTestId('roster-error')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('roster-empty')).toBeVisible();
  });

  test('persists sidebar collapse', async ({ page }) => {
    await signInCoach(page, { al_app_view: 'dashboard', al_dashboard_mode: 'calendar' });
    await page.goto('/');
    await page.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
  });

  test('persists theme preference', async ({ page }) => {
    await signInCoach(page, { al_app_view: 'dashboard', al_dashboard_mode: 'calendar', al_theme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

import { expect, test } from '@playwright/test';
import { signInCoach } from './helpers';

test('roster lists Zahar as a local athlete identity', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'roster',
  });
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  const zahar = page.getByTestId('roster-athlete-athlete-zahar');
  await expect(zahar).toBeVisible();
  await expect(zahar).toContainText('Zahar');
  await expect(zahar).toContainText('Block 3.1');
  await zahar.click();
  await expect(page.getByText('SQ 191.1')).toBeVisible();
  await expect(page.getByText('BP 135.6')).toBeVisible();
  await expect(page.getByText('DL 231.5')).toBeVisible();
  await expect(page.getByTestId('open-athlete-block')).toBeVisible();
  await page.getByTestId('open-athlete-block').click();
  await expect(page.getByRole('heading', { name: 'D1 · Sumo deadlift, Paused bench press' })).toBeVisible();
  await expect(page.getByTestId('sessions-week-header-z-w6')).toContainText('Week 6');
  await expect(page.getByTestId('sessions-week-dates-z-w6')).toHaveText('—');
  await expect(page.getByTestId('exercise-card-z-w6-d1-e1')).toContainText('190');
  await page.getByTestId('sessions-expand-z-w3').click();
  await expect(page.getByTestId('exercise-card-z-w3-d1-e1')).toContainText('185');
});

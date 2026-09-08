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
  await expect(page.getByText('Sumo deadlift')).toBeVisible();
  await expect(page.getByText('Week 6')).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { signInCoach } from './helpers';

test('insights tab assembles KPI catalog, charts, and attempts', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'insights',
  });
  await page.goto('/');
  await expect(page.getByTestId('insights-root')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  await expect(page.getByTestId('insight-kpi-strip')).toBeVisible();
  await expect(page.getByTestId('insight-kpi-sq')).toBeVisible();
  await expect(page.getByTestId('insight-kpi-bp')).toBeVisible();
  await expect(page.getByTestId('insight-kpi-dl')).toBeVisible();
  await expect(page.getByTestId('insight-kpi-vol')).toBeVisible();
  await expect(page.getByTestId('insight-kpi-dots')).toBeVisible();
  await expect(page.getByTestId('insight-kpi-acwr')).toBeVisible();
  await expect(page.getByRole('button', { name: 'e1RM', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tonnage' }).click();
  await page.getByRole('button', { name: 'ACWR', exact: true }).click();
  await expect(page.getByTestId('insight-attempt-preview')).toContainText('2nd');
  await expect(page.getByTestId('insight-attempt-preview')).toContainText('3rd');
});

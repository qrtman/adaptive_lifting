import { expect, test } from '@playwright/test';

test('login screen shows Adaptive Lifting', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Adaptive Lifting' })).toBeVisible();
});

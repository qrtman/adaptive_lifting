import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('axe pass on calendar, grid, and inspector', async ({ page, request }) => {
  const email = `axe-${Date.now()}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Calendar' })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(page.getByTestId('month-calendar')).toBeVisible();

  const calendarScan = await new AxeBuilder({ page })
    .include('[data-testid="month-calendar"]')
    .disableRules(['color-contrast'])
    .analyze();
  expect(calendarScan.violations, JSON.stringify(calendarScan.violations, null, 2)).toEqual([]);

  await page.getByTestId('calendar-day-2026-09-14').click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-title').fill('Axe session');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-inspector')).toBeVisible();

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-exercise').selectOption('Squat');
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByTestId('set-grid')).toBeVisible();

  const inspectorScan = await new AxeBuilder({ page })
    .include('[data-testid="session-inspector"]')
    .disableRules(['color-contrast'])
    .analyze();
  expect(inspectorScan.violations, JSON.stringify(inspectorScan.violations, null, 2)).toEqual([]);

  const gridScan = await new AxeBuilder({ page })
    .include('[data-testid="set-grid"]')
    .disableRules(['color-contrast'])
    .analyze();
  expect(gridScan.violations, JSON.stringify(gridScan.violations, null, 2)).toEqual([]);
});

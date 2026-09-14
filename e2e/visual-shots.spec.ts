import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ARTIFACTS = fs.existsSync('/opt/cursor/artifacts')
  ? '/opt/cursor/artifacts'
  : path.join(process.cwd(), 'test-results', 'surface-shots');

test.use({ baseURL: 'http://localhost:3000' });

test('desktop and narrow calendar/grid/inspector screenshots', async ({ page, request }) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const email = `shot-${Date.now()}@example.com`;
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('calendar-day-2026-09-14').click();
  await expect(page.getByTestId('new-session-dialog')).toBeVisible();
  await page.getByTestId('new-session-title').fill('Meet prep');
  await page.getByTestId('new-session-block').selectOption('__new__');
  await page.getByTestId('new-session-block-custom').fill('Hypertrophy');
  await page.getByTestId('new-session-week').selectOption('__new__');
  await page.getByTestId('new-session-week-custom').fill('Week1');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-inspector')).toBeVisible();
  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-exercise').selectOption('Squat');
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Squat', exact: true })).toBeVisible();

  await page.screenshot({ path: path.join(ARTIFACTS, 'calendar_inspector_desktop.png'), fullPage: true });
  await page.getByTestId('set-grid').screenshot({ path: path.join(ARTIFACTS, 'set_grid_desktop.png') });

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('month-calendar')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, 'calendar_month_desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Insights' }).click();
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, 'insights_tokens_after.png'), fullPage: true });

  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.getByTestId('month-calendar')).toHaveAttribute('data-layout', 'week-strip');
  await page.screenshot({ path: path.join(ARTIFACTS, 'calendar_week_strip_narrow.png'), fullPage: true });

  const agenda = page.getByTestId(/^week-agenda-/).first();
  if (await agenda.count()) {
    await agenda.click();
  } else {
    await page.locator('[data-testid^="workout-card-"]').first().click({ force: true });
  }
  await expect(page.getByTestId('session-inspector')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, 'inspector_overlay_narrow.png'), fullPage: true });
});

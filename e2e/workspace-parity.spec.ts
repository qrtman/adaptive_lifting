import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ARTIFACTS = fs.existsSync('/opt/cursor/artifacts')
  ? '/opt/cursor/artifacts'
  : path.join(process.cwd(), 'test-results', 'surface-shots');

test.use({ baseURL: 'http://localhost:3000' });

test('three layout states: home month, notes card, main-surface set editor', async ({ page, request }) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const email = `parity-${Date.now()}@example.com`;
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

  const emptyDay = page.getByTestId('calendar-day-2026-09-03');
  await expect(emptyDay).not.toContainText('New session');
  await expect(page.getByTestId('calendar-new-session-2026-09-03')).toBeHidden();
  await emptyDay.screenshot({ path: path.join(ARTIFACTS, 'calendar_empty_day.png') });

  await emptyDay.click();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('day-notes-card')).toHaveCount(0);
  await expect(page.getByTestId('session-inspector')).toHaveCount(0);

  await emptyDay.hover();
  await expect(page.getByTestId('calendar-new-session-2026-09-03')).toBeVisible();
  await expect(page.getByTestId('calendar-day-note-2026-09-03')).toBeVisible();
  await emptyDay.screenshot({ path: path.join(ARTIFACTS, 'calendar_hovered_day.png') });

  await page.getByTestId('calendar-day-note-2026-09-03').click();
  await expect(page.getByTestId('day-notes-card')).toBeVisible();
  await expect(page.getByTestId('month-calendar')).toBeVisible();
  await expect(page.getByTestId('session-inspector')).toHaveCount(0);
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
  await expect(page.getByTestId('day-notes-text')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, 'calendar_notes_card.png') });
  await page.getByTestId('day-notes-close').click();
  await expect(page.getByTestId('day-notes-card')).toHaveCount(0);

  await emptyDay.hover();
  await page.getByTestId('calendar-new-session-2026-09-03').click();
  const create = page.getByTestId('new-session-dialog');
  await expect(create).toBeVisible();
  const box = await create.boundingBox();
  expect(box?.width || 0).toBeGreaterThanOrEqual(360);
  await expect(page.getByTestId('new-session-create')).toBeDisabled();
  await page.screenshot({ path: path.join(ARTIFACTS, 'calendar_create_popover.png') });
  await page.getByTestId('new-session-cancel').click();
  await expect(create).toHaveCount(0);

  await emptyDay.hover();
  await page.getByTestId('calendar-new-session-2026-09-03').click();
  await page.getByTestId('new-session-title').fill('Parity day');
  await page.getByTestId('new-session-create').click();
  await expect(page.getByTestId('session-inspector')).toBeVisible();
  await expect(page.getByTestId('month-calendar')).toHaveCount(0);
  await expect(page.getByTestId('day-notes-card')).toHaveCount(0);
  const inspectorBox = await page.getByTestId('session-inspector').boundingBox();
  expect(inspectorBox?.width || 0).toBeGreaterThan(800);

  await page.getByTestId('add-lift').click();
  await page.getByTestId('add-lift-category').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-exercise').selectOption('Squat');
  await page.getByTestId('add-lift-confirm').click();
  const pattern = page.locator('[data-testid^="movement-pattern-e-"]');
  await expect(pattern).toHaveAttribute('data-value', 'Knee Dominant');
  await expect(pattern).toHaveJSProperty('tagName', 'BUTTON');
  await expect(page.getByRole('columnheader', { name: /Actual load/ }).first()).toBeVisible();

  const load = page.getByTestId('rx-weight').first();
  await load.click();
  await expect(page.getByRole('listbox', { name: 'Movement pattern' })).toHaveCount(0);
  await page.screenshot({ path: path.join(ARTIFACTS, 'inspector_grid_editing.png') });

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('month-calendar')).toBeVisible();
  await expect(page.getByTestId('session-inspector')).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-2026-09-03').locator('[data-testid^="workout-card-"]')).toHaveCount(1);

  await page.getByTestId('calendar-day-2026-09-03').hover();
  await page.getByTestId('calendar-day-note-2026-09-03').click();
  await expect(page.getByTestId('day-notes-card')).toBeVisible();
  await expect(page.getByTestId('month-calendar')).toBeVisible();
  await expect(page.getByTestId('session-inspector')).toHaveCount(0);
  await expect(page.getByTestId('day-notes-text')).toBeVisible();
});

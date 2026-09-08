import { expect, test } from '@playwright/test';
import { fillLogCell, signInCoach } from './helpers';

test('maximized microcycle stacks session editors and logs weight, reps, and RPE', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_sessions_expanded_micro: 'micro-3',
    al_active_workout_id: 'w-3-2',
    al_active_microcycle_id: 'micro-3',
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'D2 · Secondary Deadlift, Secondary Bench' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /D1 ·/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /D3 ·/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Low Bar Competition' })).toBeVisible();
  await expect(page.getByText('Primary Squat').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Competition Paused' })).toBeVisible();
  await expect(page.getByText('Primary Bench').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leg Press' })).toBeVisible();

  await page.getByTestId('exercise-expand-e-3-1-1').click();
  await expect(page.getByText('3 sets · Maximize to open')).toBeVisible();
  await page.getByTestId('exercise-expand-e-3-1-1').click();

  await expect(page.getByRole('columnheader', { name: /Rx/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Log/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'e1RM' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'INOL' }).first()).toBeVisible();

  await fillLogCell(page, 'cell-e-3-2-1-reps-0', 3);
  await fillLogCell(page, 'cell-e-3-2-1-executedRpe-0', 8);
  await fillLogCell(page, 'cell-e-3-2-1-actual-weight-0', 190);

  await expect(page.getByTestId('set-e1rm-s-3-2-1a')).toHaveText('216');
  await expect(page.getByTestId('set-inol-s-3-2-1a')).toContainText('0.25');
  await expect(page.getByTestId('workout-tonnage')).toContainText('570');
});

test('percent prescriptions copy weight and reps without RPE', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_sessions_expanded_micro: 'micro-3',
    al_active_workout_id: 'w-3-2',
    al_active_microcycle_id: 'micro-3',
  });
  await page.goto('/');
  const session = page.getByTestId('sessions-card-w-3-2');
  await expect(session.getByRole('heading', { name: 'Spoto Press' })).toBeVisible();

  await session.getByTitle('Toggle RPE / %').nth(1).click();
  await session.getByTitle('Copy prescription to log').nth(1).click();

  await expect(page.getByTestId('log-rpe-s-3-2-2a')).toHaveText('—');
  await expect(page.locator('#cell-e-3-2-2-executedRpe-0')).toHaveCount(0);
  await expect(page.locator('#cell-e-3-2-2-actual-weight-0')).toContainText('90');
  await expect(page.locator('#cell-e-3-2-2-reps-0')).toContainText('5');
});

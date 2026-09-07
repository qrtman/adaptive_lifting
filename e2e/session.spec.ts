import { expect, test } from '@playwright/test';
import { fillLogCell, signInCoach } from './helpers';

test('logs weight, reps, and RPE then updates e1RM, INOL, and tonnage', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'session',
    al_dashboard_mode: 'sessions',
    al_active_workout_id: 'w-3-2',
    al_active_microcycle_id: 'micro-3',
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Secondary Deadlift, Secondary Bench' })).toBeVisible();
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

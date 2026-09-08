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
  const weekHeader = page.getByTestId('sessions-week-header-micro-3');
  await expect(weekHeader).toContainText('Microcycle 03');
  await expect(weekHeader).toContainText('ACTIVE');
  await expect(weekHeader.getByTestId('sessions-week-dates-micro-3')).toHaveText('2026-09-16 – 2026-09-20');
  await expect(weekHeader).not.toContainText(/36,?500/);
  await expect(weekHeader).not.toContainText('SQ 160');
  await expect(weekHeader).not.toContainText('BP 95');
  await expect(page.getByRole('heading', { name: 'D2 · Secondary Deadlift, Secondary Bench' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /D1 ·/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /D3 ·/ })).toBeVisible();
  await expect(page.getByTestId('session-date-w-3-1')).toHaveText('2026-09-16');
  await expect(page.getByTestId('session-date-w-3-2')).toHaveText('2026-09-18');
  await expect(page.getByTestId('session-date-w-3-3')).toHaveText('2026-09-20');
  await expect(page.getByTestId('session-end-w-3-1')).toContainText('End of D1');
  await expect(page.getByTestId('session-end-w-3-2')).toContainText('End of D2');
  await expect(page.getByTestId('session-end-w-3-3')).toContainText('End of D3');
  await expect(page.getByTestId('session-complete-w-3-1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Low Bar Competition' })).toBeVisible();
  await expect(page.getByText('Primary Squat').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Competition Paused' })).toBeVisible();
  await expect(page.getByText('Primary Bench').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leg Press' })).toBeVisible();

  await page.getByTestId('exercise-expand-e-3-1-1').click();
  await expect(page.getByText('3 sets · Maximize to open')).toBeVisible();
  await page.getByTestId('exercise-expand-e-3-1-1').click();

  await expect(page.getByRole('columnheader', { name: /Rx/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '%adj' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Log/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'e1RM' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'INOL' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Δ' })).toHaveCount(0);

  const squatCard = page.getByTestId('exercise-card-e-3-1-1');
  await expect(squatCard.getByTestId('set-delta-s-3-1-1a')).toHaveCount(0);
  await expect(squatCard.getByTestId('set-delta-s-3-1-1b')).toHaveText('+4.8%');
  await expect(squatCard.getByTestId('set-delta-s-3-1-1c')).toHaveText('-1.7%');
  await expect(squatCard.getByTestId('exercise-inol-e-3-1-1')).toHaveText('0.69');
  await expect(squatCard.getByTestId('set-inol-s-3-1-1a')).toHaveCount(0);
  const e1rmBox = await squatCard.getByTestId('set-e1rm-s-3-1-1b').boundingBox();
  const deltaBox = await squatCard.getByTestId('set-delta-s-3-1-1b').boundingBox();
  expect(e1rmBox).toBeTruthy();
  expect(deltaBox).toBeTruthy();
  expect(deltaBox!.x).toBeGreaterThan(e1rmBox!.x);

  await fillLogCell(page, 'cell-e-3-2-1-reps-0', 3);
  await fillLogCell(page, 'cell-e-3-2-1-executedRpe-0', 8);
  await fillLogCell(page, 'cell-e-3-2-1-actual-weight-0', 190);

  await expect(page.getByTestId('set-e1rm-s-3-2-1a')).toHaveText('216');
  await expect(page.getByTestId('exercise-inol-e-3-2-1')).toHaveText('0.25');
  await expect(page.getByTestId('set-inol-s-3-2-1a')).toHaveCount(0);
  await expect(page.getByTestId('workout-tonnage')).toContainText('570');
});

test('wide session pane places exercise name beside working sets', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_sessions_expanded_micro: 'micro-3',
    al_active_workout_id: 'w-3-1',
    al_active_microcycle_id: 'micro-3',
  });
  await page.goto('/');
  const session = page.getByTestId('sessions-card-w-3-1');
  const heading = session.getByRole('heading', { name: 'Low Bar Competition' });
  const table = session.locator('table').first();
  const toolbar = session.getByTestId('exercise-toolbar-e-3-1-1');
  await heading.scrollIntoViewIfNeeded();

  await page.setViewportSize({ width: 1440, height: 900 });
  const wideHeading = await heading.boundingBox();
  const wideTable = await table.boundingBox();
  const wideToolbar = await toolbar.boundingBox();
  const wideAnchor = await session.getByTestId('exercise-anchor-e1rm-e-3-1-1').boundingBox();
  expect(wideHeading).toBeTruthy();
  expect(wideTable).toBeTruthy();
  expect(wideToolbar).toBeTruthy();
  expect(wideAnchor).toBeTruthy();
  expect(wideHeading!.x).toBeLessThan(wideTable!.x - 40);
  expect(wideToolbar!.x).toBeGreaterThan(wideTable!.x);
  expect(wideAnchor!.x).toBeLessThan(wideTable!.x);
  expect(wideAnchor!.x).toBeLessThan(wideToolbar!.x);
  await expect(session.getByTestId('exercise-anchor-e1rm-e-3-1-1')).toBeVisible();
  await expect(page.locator('#cell-e-3-1-1-baseline_e1rm-0')).toHaveCount(0);
  await expect(session.getByTestId('exercise-card-e-3-1-1').locator('.text-amber-400')).toHaveCount(0);
  const adjHeader = session.getByTestId('exercise-card-e-3-1-1').getByRole('columnheader', { name: '%adj' });
  const copyBtn = session.getByTestId('exercise-card-e-3-1-1').getByTitle('Copy prescription to log').first();
  const adjBox = await adjHeader.boundingBox();
  const copyBox = await copyBtn.boundingBox();
  expect(adjBox).toBeTruthy();
  expect(copyBox).toBeTruthy();
  expect(adjBox!.x).toBeLessThan(copyBox!.x);
  expect(Math.abs(wideHeading!.y - wideTable!.y)).toBeLessThan(48);

  await page.setViewportSize({ width: 700, height: 900 });
  await heading.scrollIntoViewIfNeeded();
  const stackedHeading = await heading.boundingBox();
  const stackedTable = await table.boundingBox();
  expect(stackedHeading).toBeTruthy();
  expect(stackedTable).toBeTruthy();
  expect(stackedHeading!.y + stackedHeading!.height).toBeLessThan(stackedTable!.y + 8);
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

test('coach can add a session on any calendar day', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_sessions_expanded_micro: 'micro-3',
    al_active_workout_id: 'w-3-2',
    al_active_microcycle_id: 'micro-3',
  });
  await page.goto('/');
  await page.getByTestId('add-session-micro-3').click();
  await expect(page.getByTestId('add-session-dialog')).toBeVisible();
  await expect(page.getByText('Assign microcycle')).toBeVisible();
  await page.getByTestId('assign-micro-micro-3').click();
  await page.getByTestId('session-day-2026-09-17').click();
  await page.getByTestId('create-session').click();
  await expect(page.getByRole('heading', { name: 'D2', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'D1 · Primary Squat, Primary Bench' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'D3 · Secondary Deadlift, Secondary Bench' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'D4 · Secondary Squat, Tertiary Bench' })).toBeVisible();
});

test('coach can add a catalog exercise into a session', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_sessions_expanded_micro: 'micro-3',
    al_active_workout_id: 'w-3-2',
    al_active_microcycle_id: 'micro-3',
  });
  await page.goto('/');
  const session = page.getByTestId('sessions-card-w-3-2');
  await session.getByTestId('add-exercise-w-3-2').click();
  await expect(page.getByTestId('add-exercise-dialog')).toBeVisible();
  await page.getByTestId('catalog-ssb').click();
  await expect(page.getByTestId('add-exercise-dialog').getByText('RPE TARGET')).toHaveCount(0);
  await expect(page.getByTestId('add-exercise-dialog').getByText('TOP SET BACKDOWN')).toHaveCount(0);
  await page.getByTestId('add-exercise-confirm').click();
  await expect(session.getByRole('heading', { name: 'SSB Squat' })).toBeVisible();
  await expect(session.getByText('Secondary Squat').first()).toBeVisible();
});

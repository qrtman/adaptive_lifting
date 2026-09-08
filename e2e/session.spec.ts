import { expect, test } from '@playwright/test';
import { fillLogCell, signInCoach } from './helpers';

test('landing sessions belong to the selected athlete', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await expect(page.getByTestId('athlete-switcher')).toBeVisible();
  await expect(page.getByTestId('sessions-week-header-micro-3')).toHaveCount(0);
  await expect(page.getByTestId('sessions-week-header-z-w6')).toContainText('Week 6');
});

test('maximized microcycle stacks session editors and logs weight, reps, and RPE', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await page.getByTestId('sessions-expand-z-w3').click();

  const weekHeader = page.getByTestId('sessions-week-header-z-w3');
  await expect(weekHeader).toContainText('Week 3');
  await expect(weekHeader.getByTestId('sessions-week-dates-z-w3')).toHaveText('—');
  await expect(page.getByTestId('session-end-z-w3-d1')).toContainText('End of D1');
  await expect(page.getByRole('heading', { name: 'Sumo deadlift' }).first()).toBeVisible();

  await expect(page.getByRole('columnheader', { name: /Rx/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '%adj' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Log/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'e1RM' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'INOL' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Δ' })).toHaveCount(0);

  const deadlift = page.getByTestId('exercise-card-z-w3-d1-e1');
  await expect(deadlift.getByTestId('set-delta-z-w3-d1-e1-s1-1')).toHaveCount(0);
  await expect(deadlift.getByTestId('set-delta-z-w3-d1-e1-s2-1')).toHaveText(/^[+-]?\d+\.\d%$/);
  await expect(deadlift.getByTestId('exercise-inol-z-w3-d1-e1')).not.toHaveText('—');
  await expect(deadlift.getByTestId('set-inol-z-w3-d1-e1-s1-1')).toHaveCount(0);
  const e1rmBox = await deadlift.getByTestId('set-e1rm-z-w3-d1-e1-s2-1').boundingBox();
  const deltaBox = await deadlift.getByTestId('set-delta-z-w3-d1-e1-s2-1').boundingBox();
  expect(e1rmBox).toBeTruthy();
  expect(deltaBox).toBeTruthy();
  expect(deltaBox!.x).toBeGreaterThan(e1rmBox!.x);

  await fillLogCell(page, 'cell-z-w3-d2-e1-reps-0', 1);
  await fillLogCell(page, 'cell-z-w3-d2-e1-executedRpe-0', 8);
  await fillLogCell(page, 'cell-z-w3-d2-e1-actual-weight-0', 170);
  await expect(page.getByTestId('set-e1rm-z-w3-d2-e1-s1-1')).not.toHaveText('—');
});

test('wide session pane places exercise name beside working sets', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await page.getByTestId('sessions-expand-z-w3').click();
  const session = page.getByTestId('sessions-card-z-w3-d1');
  const heading = session.getByRole('heading', { name: 'Sumo deadlift' });
  const table = session.locator('table').first();
  const toolbar = session.getByTestId('exercise-toolbar-z-w3-d1-e1');
  await heading.scrollIntoViewIfNeeded();

  await page.setViewportSize({ width: 1440, height: 900 });
  const wideHeading = await heading.boundingBox();
  const wideTable = await table.boundingBox();
  const wideToolbar = await toolbar.boundingBox();
  const wideAnchor = await session.getByTestId('exercise-anchor-e1rm-z-w3-d1-e1').boundingBox();
  expect(wideHeading).toBeTruthy();
  expect(wideTable).toBeTruthy();
  expect(wideToolbar).toBeTruthy();
  expect(wideAnchor).toBeTruthy();
  expect(wideHeading!.x).toBeLessThan(wideTable!.x - 40);
  expect(wideToolbar!.x).toBeGreaterThan(wideTable!.x);
  expect(wideAnchor!.x).toBeLessThan(wideTable!.x);
  expect(wideAnchor!.x).toBeLessThan(wideToolbar!.x);
  const adjHeader = session.getByTestId('exercise-card-z-w3-d1-e1').getByRole('columnheader', { name: '%adj' });
  const copyBtn = session.getByTestId('exercise-card-z-w3-d1-e1').getByTitle('Copy prescription to log').first();
  const adjBox = await adjHeader.boundingBox();
  const copyBox = await copyBtn.boundingBox();
  expect(adjBox).toBeTruthy();
  expect(copyBox).toBeTruthy();
  expect(adjBox!.x).toBeLessThan(copyBox!.x);

  await page.setViewportSize({ width: 700, height: 900 });
  await heading.scrollIntoViewIfNeeded();
  const stackedHeading = await heading.boundingBox();
  const stackedTable = await table.boundingBox();
  expect(stackedHeading!.y + stackedHeading!.height).toBeLessThan(stackedTable!.y + 8);
});

test('percent prescriptions copy weight and reps without RPE', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await page.getByTestId('sessions-expand-z-w3').click();
  const session = page.getByTestId('sessions-card-z-w3-d1');
  await session.locator('[data-testid^="toggle-percent-"]').first().click();
  await session.getByTitle('Copy prescription to log').first().click();
  await expect(session.locator('[data-testid^="log-rpe-"]').first()).toHaveText('—');
});

test('coach can add a session on any calendar day', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await page.getByTestId('sessions-expand-z-w3').click();
  await expect(page.getByTestId('add-session-z-w3')).toBeVisible();
  await page.getByTestId('add-session-z-w3').click();
  await expect(page.getByTestId('add-session-dialog')).toBeVisible();
  await page.getByTestId('assign-micro-z-w3').click();
  await page.getByTestId('session-day-2026-09-17').click();
  await page.getByTestId('create-session').click();
  await expect(page.getByTestId('add-session-dialog')).toHaveCount(0);
  await expect(page.locator('[data-testid^="session-date-"]', { hasText: '2026-09-17' })).toBeVisible();
});

test('coach can add a catalog exercise into a session', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await page.getByTestId('sessions-expand-z-w3').click();
  const session = page.getByTestId('sessions-card-z-w3-d1');
  await session.getByTestId('session-complete-z-w3-d1').click();
  await expect(session.getByTestId('add-exercise-z-w3-d1')).toBeVisible();
  await session.getByTestId('add-exercise-z-w3-d1').click();
  await expect(page.getByTestId('add-exercise-dialog')).toBeVisible();
  await page.getByTestId('catalog-ssb').click();
  await expect(page.getByTestId('add-exercise-dialog').getByText('RPE TARGET')).toHaveCount(0);
  await page.getByTestId('add-exercise-confirm').click();
  await expect(session.getByRole('heading', { name: 'SSB Squat' })).toBeVisible();
});

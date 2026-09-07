import { expect, test } from '@playwright/test';
import { signInCoach } from './helpers';

test.describe('workout builder — exercise constructor', () => {
  test.beforeEach(async ({ page }) => {
    await signInCoach(page, {
      al_app_view: 'session',
      al_dashboard_mode: 'sessions',
      al_active_workout_id: 'w-3-2',
      al_active_microcycle_id: 'micro-3',
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Secondary Deadlift, Secondary Bench' })).toBeVisible();
  });

  test('adds a canonical exercise with structured prescription into the session', async ({ page }) => {
    await page.getByTestId('session-add-exercise').click();
    await expect(page.getByTestId('workout-builder')).toBeVisible();

    // Select a canonical movement from the database
    await page.getByTestId('builder-result-front-squat').click();
    await expect(page.getByTestId('builder-compiled-name')).toHaveText('Front Squat');

    // Apply a tempo modifier — the compiled name recomputes from structured params
    await page.getByTestId('builder-tempo-paused').click();
    await expect(page.getByTestId('builder-compiled-name')).toHaveText('Paused Front Squat (3-2-0)');

    // Structured prescription preview is present (never freeform)
    await expect(page.getByTestId('builder-preview')).toContainText('@ RPE');

    await page.getByTestId('builder-commit').click();
    await expect(page.getByTestId('workout-builder')).toHaveCount(0);

    // The new exercise card is injected into the session
    await expect(page.getByRole('heading', { name: 'Paused Front Squat (3-2-0)' })).toBeVisible();
  });

  test('creates a custom exercise with a top-set + backdown prescription', async ({ page }) => {
    await page.getByTestId('session-add-exercise').click();
    await page.getByTestId('workout-builder-search').fill('Board Press');
    await page.getByTestId('builder-create-custom').click();

    await page.getByTestId('builder-cat-Bench').click();
    await page.getByTestId('builder-mode-TOP_SET_BACKDOWN').click();
    await expect(page.getByTestId('builder-preview')).toContainText('Backdown:');

    await page.getByTestId('builder-commit').click();
    await expect(page.getByRole('heading', { name: 'Board Press' })).toBeVisible();
  });

  test('removes an exercise from the session', async ({ page }) => {
    // Seeded exercise e-3-2-1 (Secondary Deadlift) is present
    await expect(page.getByTestId('exercise-remove-e-3-2-1')).toBeVisible();
    await page.getByTestId('exercise-remove-e-3-2-1').click();
    await expect(page.getByTestId('exercise-remove-e-3-2-1')).toHaveCount(0);
  });
});

test('session constructor — creates a new empty session in a microcycle', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');

  await page.getByTestId('sessions-new-micro-3').click();

  // Navigates into the freshly created empty session
  await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible();
  await expect(page.getByTestId('session-empty')).toBeVisible();

  // The builder can then populate it
  await page.getByTestId('session-add-exercise').click();
  await page.getByTestId('builder-result-comp-squat').click();
  await page.getByTestId('builder-commit').click();
  await expect(page.getByRole('heading', { name: 'Competition Squat' })).toBeVisible();
  await expect(page.getByTestId('session-empty')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { readPlanSnapshot, signInCoach, writePlanSnapshot } from './helpers';

const ATHLETE = 'athlete-zahar';
const PLAN_SNAPSHOT = `plan:${ATHLETE}`;

test('roster opens an athlete block under its own name', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'roster',
  });
  await page.goto('/');
  await page.getByTestId('nav-roster').click();

  const athlete = page.getByTestId(`roster-athlete-${ATHLETE}`);
  await expect(athlete).toBeVisible();
  await athlete.click();

  // The action is labelled from the athlete's block, not a constant in the view.
  const open = page.getByTestId('open-athlete-block');
  await expect(open).toHaveText('Open Block 3.1');
  await open.click();

  await expect(page.getByTestId('sessions-week-header-z-w6')).toContainText('Week 6');
  await expect(page.getByTestId('exercise-card-z-w6-d1-e1')).toContainText('190');
});

test('an athlete without an imported block shows identity only', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'roster',
  });
  await page.goto('/');
  await page.getByTestId('nav-roster').click();

  await page.getByTestId('add-athlete-name').fill('Second Athlete');
  await page.getByTestId('add-athlete-submit').click();

  const added = page.getByTestId('roster-list').getByText('Second Athlete');
  await expect(added).toBeVisible();
  await added.click();
  await expect(page.getByTestId('open-athlete-block')).toHaveCount(0);
});

test('a changed import reconciles on reload without reopening the block', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_active_athlete_id: ATHLETE,
  });
  await page.goto('/');
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();

  // Stand in for the offline conversion changing under a cached plan: D1 is
  // edited here so it must survive, D2 is untouched so it must refresh, and
  // week 6 is missing from the cache so the import must restore it.
  const stored = await readPlanSnapshot(page, PLAN_SNAPSHOT);
  expect(stored).toBeTruthy();
  stored.planVersion = 'stale';
  stored.ownedWorkoutIds = ['z-w3-d1'];
  stored.microcycles = stored.microcycles.filter((micro: any) => micro.id !== 'z-w6');
  for (const micro of stored.microcycles) {
    for (const workout of micro.workouts) {
      if (workout.id === 'z-w3-d1') workout.exercises[0].sets[0].actual = 999;
      if (workout.id === 'z-w3-d2') workout.exercises[0].sets[0].actual = 888;
    }
  }
  await writePlanSnapshot(page, PLAN_SNAPSHOT, stored);

  await page.reload();
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();

  await page.getByTestId('sessions-expand-z-w3').click();
  await expect(page.getByTestId('exercise-card-z-w3-d1-e1')).toContainText('999');
  const untouched = page.getByTestId('exercise-card-z-w3-d2-e1');
  await expect(untouched).toContainText('165');
  await expect(untouched).not.toContainText('888');
});

test('each athlete keeps their own cached plan', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_active_athlete_id: ATHLETE,
  });
  await page.goto('/');
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();

  const stored = await readPlanSnapshot(page, PLAN_SNAPSHOT);
  expect(stored.athleteId).toBe(ATHLETE);
  expect(stored.source).toBe('imported');
  expect(stored.planVersion).toBeTruthy();
  expect(await readPlanSnapshot(page, 'microcycles')).toBeNull();
});

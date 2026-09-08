import { expect, test } from '@playwright/test';
import { readPlanSnapshot, signInCoach, writePlanSnapshot } from './helpers';

const ATHLETE = 'athlete-zahar';
const PLAN_SNAPSHOT = `plan:${ATHLETE}`;

test('roster click opens that athlete on Sessions', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'roster',
  });
  await page.goto('/');
  await page.getByTestId('nav-roster').click();

  const athlete = page.getByTestId(`roster-athlete-${ATHLETE}`);
  await expect(athlete).toBeVisible();
  await athlete.click();
  await expect(page.getByTestId('open-athlete-block')).toHaveCount(0);
  await expect(page.getByTestId('sessions-week-header-z-w6')).toContainText('Week 6');
  await expect(page.getByTestId('exercise-card-z-w6-d1-e1')).toContainText('190');
});

test('an athlete without a block opens an empty Sessions view', async ({ page }) => {
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
  await expect(page.getByTestId('sessions-empty')).toBeVisible();
});

test('switching athletes in the sidebar swaps sessions in place', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
  });
  await page.goto('/');
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();

  await page.getByTestId('nav-roster').click();
  await page.getByTestId('add-athlete-name').fill('Second Athlete');
  await page.getByTestId('add-athlete-submit').click();
  await expect(page.getByTestId('roster-list').getByText('Second Athlete')).toBeVisible();

  await page.getByTestId('nav-sessions').click();
  const switcher = page.getByTestId('athlete-switcher');
  await expect(switcher).toBeVisible();
  const optionValue = await switcher.locator('option', { hasText: 'Second Athlete' }).getAttribute('value');
  expect(optionValue).toBeTruthy();
  await switcher.selectOption(optionValue!);
  await expect(page.getByTestId('sessions-empty')).toBeVisible();

  await switcher.selectOption(ATHLETE);
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();
});

test('a changed import reconciles on reload without reopening the block', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_active_athlete_id: ATHLETE,
  });
  await page.goto('/');
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();

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

test('a leftover unowned week is stripped from an imported plan on reload', async ({ page }) => {
  await signInCoach(page, {
    al_app_view: 'dashboard',
    al_dashboard_mode: 'sessions',
    al_active_athlete_id: ATHLETE,
  });
  await page.goto('/');
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();

  const stored = await readPlanSnapshot(page, PLAN_SNAPSHOT);
  stored.microcycles = [
    ...stored.microcycles,
    {
      id: 'micro-1',
      weekName: 'Microcycle 01',
      focus: 'Leftover',
      status: 'ACTIVE',
      workouts: [
        {
          id: 'w-1-1',
          date: '2026-09-02',
          dayLabel: 'D1',
          title: 'Primary Squat',
          tonnage: 0,
          delta: 0,
          color: 'gray',
          status: 'PLANNED',
          exercises: [],
        },
      ],
    },
  ];
  await writePlanSnapshot(page, PLAN_SNAPSHOT, stored);

  await page.reload();
  await expect(page.getByTestId('sessions-week-header-z-w6')).toBeVisible();
  await expect(page.getByTestId('sessions-week-header-micro-1')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

async function openAddLift(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const email = `add-lift-search-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const register = await request.post('http://localhost:8000/api/auth/register', {
    data: { email, password: 'password123', role: 'ATHLETE' },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();

  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.getByTestId('sessions-add').click();
  await page.getByTestId('new-session-date').fill('2026-09-12');
  await page.getByTestId('new-session-title').fill('Add lift search');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]');
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.locator('button').first().click();
  await page.getByTestId('add-lift').click();
  await expect(page.getByTestId('add-lift-dialog')).toBeVisible();
}

test('empty search shows the catalog in a visible listbox', async ({ page, request }) => {
  await openAddLift(page, request);
  await expect(page.getByTestId('add-lift-search')).toBeFocused();
  await expect(page.getByTestId('add-lift-results')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Squat', exact: true })).toBeVisible();
  await expect(page.getByTestId('add-lift-confirm')).toBeDisabled();
});

test('typing bench shows Bench variants; click and Confirm adds the lift', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-search').fill('bench');
  await expect(page.getByTestId('add-lift-results')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Bench', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Close Grip Bench', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Incline Bench', exact: true })).toBeVisible();
  await expect(page.locator('select[data-testid="add-lift-exercise"]')).toHaveCount(0);
  await page.getByTestId('add-lift-result-Bench').click();
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Bench', exact: true })).toBeVisible();
  await expect(page.getByTestId('add-lift-results')).toHaveCount(0);
});

test('zzzz shows no catalog matches and disables Confirm', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-search').fill('zzzz');
  await expect(page.getByTestId('add-lift-no-results')).toBeVisible();
  await expect(page.getByTestId('add-lift-no-results')).toContainText('No catalog matches.');
  await expect(page.getByTestId('add-lift-results')).toBeVisible();
  await expect(page.getByTestId('add-lift-confirm')).toBeDisabled();
});

test('Knee Dominant plus press is Leg Press not Bench', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('movement-pattern-add-lift').selectOption('Knee Dominant');
  await page.getByTestId('add-lift-search').fill('press');
  await expect(page.getByTestId('add-lift-result-Leg Press')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Leg Press', exact: true })).toBeVisible();
  await expect(page.getByTestId('add-lift-result-Bench')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Bench', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Press', exact: true })).toHaveCount(0);
});

test('User Defined hides catalog results and ignores search', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-search').fill('bench');
  await expect(page.getByTestId('add-lift-results')).toBeVisible();
  await page.getByTestId('add-lift-category').selectOption('User Defined');
  await expect(page.getByTestId('add-lift-results')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-no-results')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-search')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-custom-name')).toBeVisible();
});

test('search results stay visible at 360px', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openAddLift(page, request);
  await page.getByTestId('add-lift-search').fill('bench');
  await expect(page.getByTestId('add-lift-results')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Bench', exact: true })).toBeVisible();
});

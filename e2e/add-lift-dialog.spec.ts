import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

async function openAddLift(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const email = `add-lift-dialog-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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
  await page.getByTestId('new-session-date').fill('2026-09-24');
  await page.getByTestId('new-session-title').fill('Exercise dialog checks');
  await page.getByTestId('new-session-create').click();
  const card = page.locator('[data-testid^="sessions-card-"]').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.locator('button').first().click();
  await page.getByTestId('add-lift').click();
  await expect(page.getByTestId('add-lift-dialog')).toBeVisible();
}

test('catalog search supports selection, filtering, and keyboard dismissal', async ({ page, request }) => {
  await openAddLift(page, request);
  const search = page.getByTestId('add-lift-search');
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('role', 'combobox');
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('option', { name: 'Squat', exact: true })).toBeVisible();

  await search.fill('bench');
  await expect(page.getByRole('option', { name: 'Bench', exact: true })).toBeVisible();
  await page.getByTestId('add-lift-result-Bench').click();
  await expect(page.getByTestId('add-lift-results')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-selected-exercise')).toContainText('Bench');
  await expect(page.getByTestId('add-lift-confirm')).toBeEnabled();

  await search.fill('close');
  await expect(page.getByTestId('add-lift-results')).toBeVisible();
  await page.getByTestId('movement-pattern-add-lift').selectOption('Knee Dominant');
  await search.fill('press');
  await expect(page.getByTestId('add-lift-result-Leg Press')).toBeVisible();
  await expect(page.getByTestId('add-lift-result-Bench')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-selected-exercise')).toContainText('Bench');

  await page.getByTestId('add-lift-search').press('Escape');
  await expect(page.getByTestId('add-lift-results')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-dialog')).toBeVisible();
  await page.getByTestId('add-lift-search').press('Escape');
  await expect(page.getByTestId('add-lift-dialog')).toHaveCount(0);
  await expect(page.getByTestId('add-lift')).toBeFocused();
});

test('keyboard arrows and Enter select a catalog exercise', async ({ page, request }) => {
  await openAddLift(page, request);
  const search = page.getByTestId('add-lift-search');
  await search.fill('squat');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'add-lift-option-Front Squat');
  await search.press('Enter');
  await expect(page.getByTestId('add-lift-results')).toHaveCount(0);
  await expect(page.getByTestId('add-lift-selected-exercise')).toContainText('Front Squat');
});

test('User Defined requires a name and stores its movement pattern', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-category').selectOption('User Defined');
  await expect(page.getByTestId('add-lift-custom-name')).toBeVisible();
  await page.getByTestId('add-lift-custom-name').fill('Cable Crunch');
  await page.getByTestId('movement-pattern-add-lift').selectOption('Vertical Pull');
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/sessions/') && response.url().endsWith('/exercises') && response.request().method() === 'POST');
  await page.getByTestId('add-lift-confirm').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({ title: 'Cable Crunch', movementPattern: 'Vertical Pull' });
  await expect(page.getByRole('button', { name: /Cable Crunch/ })).toBeVisible();
});

test('modifiers change the saved name and base lifts have no Competition modifier', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-result-Squat').click();
  await expect(page.getByTestId('lift-name-Squat')).toHaveText('Squat');
  await expect(page.getByRole('button', { name: 'Competition', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'High Bar', exact: true }).click();
  await page.getByLabel('Eccentric').fill('2');
  await page.getByRole('button', { name: 'Deficit', exact: true }).click();
  await page.getByRole('button', { name: 'Beltless', exact: true }).click();
  await expect(page.getByTestId('lift-name-Squat')).toHaveText('Beltless Deficit High Bar Squat (2-0-1)');
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByRole('heading', { name: 'Beltless Deficit High Bar Squat (2-0-1)', exact: true })).toBeVisible();
});

test('Edit keeps a blank User Defined name visible and prevents saving', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByTestId('add-lift-confirm').click();
  await page.getByTestId(/^edit-lift-/).first().click();
  await expect(page.getByTestId('edit-lift-dialog')).toBeVisible();
  await page.getByTestId(/^edit-lift-.*-category$/).selectOption('User Defined');
  const customName = page.getByTestId(/^edit-lift-.*-custom-name$/);
  await customName.fill('   ');
  await expect(page.getByTestId('edit-lift-name-error')).toBeVisible();
  await expect(page.getByTestId('edit-lift-done')).toBeDisabled();
  await customName.fill('Tempo Squat');
  await expect(page.getByTestId('edit-lift-done')).toBeEnabled();
  await page.getByTestId('edit-lift-done').click();
  await expect(page.getByRole('heading', { name: 'Tempo Squat', exact: true })).toBeVisible();
});

test('no results disable confirm and save errors stay in the dialog', async ({ page, request }) => {
  await openAddLift(page, request);
  await page.getByTestId('add-lift-search').fill('zzzz');
  await expect(page.getByTestId('add-lift-no-results')).toContainText('No catalog matches.');
  await expect(page.getByTestId('add-lift-confirm')).toBeDisabled();
  await page.getByTestId('add-lift-search').fill('squat');
  await page.getByTestId('add-lift-result-Squat').click();
  await page.route('**/api/sessions/*/exercises', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Save failed' }) }));
  await page.getByTestId('add-lift-confirm').click();
  await expect(page.getByTestId('add-lift-error')).toBeVisible();
  await expect(page.getByTestId('add-lift-dialog')).toBeVisible();
});

test('footer stays visible and actions remain reachable on a short mobile viewport', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 320 });
  await openAddLift(page, request);
  const dialog = page.getByTestId('add-lift-dialog');
  const confirm = page.getByTestId('add-lift-confirm');
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId('add-lift-search')).toBeFocused();
  await dialog.getByTestId('dialog-close').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('add-lift-cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByTestId('dialog-close')).toBeFocused();
  const dialogBox = await dialog.boundingBox();
  const confirmBox = await confirm.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(confirmBox).not.toBeNull();
  expect(confirmBox!.y + confirmBox!.height).toBeLessThanOrEqual(320);

  await page.getByTestId('add-lift-result-Squat').click();
  await page.getByRole('button', { name: 'High Bar', exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId('add-lift-dialog').locator('.overflow-y-auto').first()).toBeVisible();

  await page.getByTestId('add-lift-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('add-lift')).toBeFocused();
});

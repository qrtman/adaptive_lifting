import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('nav-security')).toBeVisible();
}

test('athlete enters coach code in Security to link', async ({ browser, playwright }) => {
  const suffix = Date.now();
  const coachEmail = `link-coach-${suffix}@example.com`;
  const athleteEmail = `link-ath-${suffix}@example.com`;
  const password = 'password123';
  const coachApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const athleteApi = await playwright.request.newContext({ baseURL: 'http://localhost:8000' });
  const coachPage = await browser.newPage();
  const athletePage = await browser.newPage();
  try {
    const coachReg = await coachApi.post('/api/auth/register', {
      data: { email: coachEmail, password, role: 'COACH' },
    });
    const athleteReg = await athleteApi.post('/api/auth/register', {
      data: { email: athleteEmail, password, role: 'ATHLETE' },
    });
    expect(coachReg.ok()).toBeTruthy();
    expect(athleteReg.ok()).toBeTruthy();

    await signIn(coachPage, coachEmail, password);
    await coachPage.getByTestId('nav-security').click();
    await expect(coachPage.getByTestId('coach-link-panel')).toBeVisible();
    await expect(coachPage.getByTestId('athlete-link-input')).toHaveCount(0);
    await expect(coachPage.getByTestId('coach-code-empty')).toBeVisible();
    await coachPage.getByTestId('coach-code-generate').click();
    const code = (await coachPage.getByTestId('coach-code-value').innerText()).trim();
    expect(code.length).toBeGreaterThan(0);
    await expect(coachPage.getByTestId('coach-code-success')).toBeVisible();

    await signIn(athletePage, athleteEmail, password);
    await athletePage.getByTestId('nav-security').click();
    await expect(athletePage.getByTestId('coach-link-panel')).toBeVisible();
    await expect(athletePage.getByTestId('coach-code-generate')).toHaveCount(0);
    await expect(athletePage.getByTestId('athlete-link-empty')).toBeVisible();
    await athletePage.getByTestId('athlete-link-input').fill('ZZZZZZ');
    await athletePage.getByTestId('athlete-link-submit').click();
    await expect(athletePage.getByTestId('athlete-link-error')).toBeVisible();
    await athletePage.getByTestId('athlete-link-input').fill(code);
    await athletePage.getByTestId('athlete-link-submit').click();
    await expect(athletePage.getByTestId('athlete-link-success')).toBeVisible();

    await coachPage.reload();
    await expect(coachPage.getByTestId('coach-athlete-switcher')).toContainText(athleteEmail);
  } finally {
    await coachPage.close();
    await athletePage.close();
    await coachApi.dispose();
    await athleteApi.dispose();
  }
});

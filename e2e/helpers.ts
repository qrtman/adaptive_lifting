import { Page } from '@playwright/test';

export async function signInCoach(page: Page, prefs: Record<string, string> = {}) {
  await page.addInitScript((extra: Record<string, string>) => {
    localStorage.setItem('al_role_mode', 'coach');
    for (const [key, value] of Object.entries(extra)) {
      localStorage.setItem(key, value);
    }
  }, prefs);
}

export async function fillLogCell(page: Page, cellId: string, value: string | number) {
  await page.locator(`#${cellId}`).click();
  const input = page.locator('input').last();
  await input.fill(String(value));
  await input.press('Enter');
}

export async function html5Drag(page: Page, sourceTestId: string, targetTestId: string) {
  const source = page.getByTestId(sourceTestId);
  const target = page.getByTestId(targetTestId);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ from, to }) => {
      const src = document.querySelector(`[data-testid="${from}"]`);
      const dst = document.querySelector(`[data-testid="${to}"]`);
      if (!src || !dst) {
        throw new Error(`Missing drag nodes ${from} -> ${to}`);
      }
      const dataTransfer = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    },
    { from: sourceTestId, to: targetTestId }
  );
}

import { expect, type Locator, type Page } from '@playwright/test';

export async function signInCoach(page: Page, prefs: Record<string, string> = {}) {
  await page.addInitScript((extra: Record<string, string>) => {
    localStorage.setItem('al_role_mode', 'coach');
    for (const [key, value] of Object.entries(extra)) {
      localStorage.setItem(key, value);
    }
  }, prefs);
}

export async function typeCell(cell: Locator, value: string) {
  await cell.page().keyboard.press('Escape');
  await cell.click();
  await expect(cell).toBeEditable();
  await cell.fill(value);
  await cell.blur();
}

export async function expectCellValue(cell: Locator, value: string) {
  if (value === '—') {
    await expect(cell).toHaveValue('');
    return;
  }
  await expect(cell).toHaveValue(value);
}

export async function fillLogCell(page: Page, cellId: string, value: string | number) {
  const byId = page.locator(`#${cellId}`);
  const cell = (await byId.count()) ? byId : page.getByTestId(cellId).first();
  await typeCell(cell, String(value));
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

import { Page, Locator } from '@playwright/test';

export async function signInCoach(page: Page, prefs: Record<string, string> = {}) {
  await page.addInitScript((extra: Record<string, string>) => {
    localStorage.setItem('al_role_mode', 'coach');
    for (const [key, value] of Object.entries(extra)) {
      localStorage.setItem(key, value);
    }
  }, prefs);
}

/** Click selects. Start insert-edit (F2) before fill/type. */
export async function startCellEdit(cell: Locator) {
  await cell.click();
  const tag = await cell.evaluate((el) => el.tagName.toLowerCase());
  if (tag !== 'input') {
    await cell.press('F2');
  }
}

export async function fillEditableCell(cell: Locator, value: string | number) {
  await startCellEdit(cell);
  await cell.fill(String(value));
}

export async function fillLogCell(page: Page, cellId: string, value: string | number) {
  const cell = page.locator(`#${cellId}`);
  await fillEditableCell(cell, value);
  await cell.press('Enter');
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

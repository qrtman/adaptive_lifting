import { Page } from '@playwright/test';

export async function signInCoach(page: Page, prefs: Record<string, string> = {}) {
  await page.addInitScript((extra: Record<string, string>) => {
    localStorage.setItem('al_role_mode', 'coach');
    for (const [key, value] of Object.entries(extra)) {
      localStorage.setItem(key, value);
    }
  }, prefs);
}

export async function readPlanSnapshot(page: Page, snapshotId: string): Promise<any> {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('adaptive_lifting_db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result
            .transaction('snapshots', 'readonly')
            .objectStore('snapshots')
            .get(id);
          request.onsuccess = () => resolve(request.result ? request.result.data : null);
          request.onerror = () => reject(request.error);
        };
      }),
    snapshotId,
  );
}

export async function writePlanSnapshot(page: Page, snapshotId: string, data: unknown): Promise<void> {
  await page.evaluate(
    ({ id, payload }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('adaptive_lifting_db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('snapshots', 'readwrite');
          tx.objectStore('snapshots').put({ id, data: payload, updated_at: new Date().toISOString() });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { id: snapshotId, payload: data },
  );
}

export async function fillLogCell(page: Page, cellId: string, value: string | number) {
  await page.locator(`#${cellId}`).click();
  const input = page.locator('input').last();
  await input.fill(String(value));
  await input.press('Enter');
}

export async function cardOnDate(page: Page, date: string) {
  const inputs = page.locator('[data-testid^="calendar-session-date-"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    if ((await input.inputValue()) === date) {
      const testId = await input.getAttribute('data-testid');
      const workoutId = testId!.replace('calendar-session-date-', '');
      return {
        workoutId,
        input,
        cardTestId: `workout-card-${workoutId}`,
      };
    }
  }
  return null;
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

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from './ExerciseCard';

// Session sheet phase 4: arrows and Enter cross from one lift to the next / previous one.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

const sets = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `${n}-${i}-${Math.random()}`, scope: 'both', plannedWeight: 100 + i, plannedReps: 5, intensity_type: 'RPE', target_value: 7,
}));

async function render(view: 'both' | 'plan' = 'both', middleCollapsed = false) {
  const card = (id: string, n: number, minimized = false) => (
    <ExerciseCard key={id} id={id} title={id} variation={id} tags={[]} initialMinimized={minimized}
      initialSets={sets(n)} onUpdateSets={vi.fn()} view={view} />
  );
  await act(async () => root.render(<div>{card('squat', 2)}{card('row', 1, middleCollapsed)}{card('bench', 3)}</div>));
}
const cell = (id: string) => container.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)!;
const press = async (el: HTMLElement, key: string) => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
};
const selected = () => [...container.querySelectorAll('[data-selected="true"]')].map((el) => el.getAttribute('data-cell-id'));

describe('one keyboard table for the session', () => {
  it('ArrowDown off the last row continues in the next lift, same column; ArrowUp comes back', async () => {
    await render();
    await act(async () => { cell('squat:1:log:reps').click(); });
    await press(cell('squat:1:log:reps'), 'ArrowDown');
    expect(selected()).toEqual(['row:0:log:reps']);
    await press(cell('row:0:log:reps'), 'ArrowDown');
    expect(selected()).toEqual(['bench:0:log:reps']);
    await press(cell('bench:0:log:reps'), 'ArrowUp');
    expect(selected()).toEqual(['row:0:log:reps']);
    await press(cell('row:0:log:reps'), 'ArrowUp');
    expect(selected()).toEqual(['squat:1:log:reps']);
  });

  it('stays put at the very first and last cell of the session', async () => {
    await render();
    await act(async () => { cell('squat:0:plan:kg').click(); });
    await press(cell('squat:0:plan:kg'), 'ArrowUp');
    expect(selected()).toEqual(['squat:0:plan:kg']);
    await act(async () => { cell('bench:2:plan:kg').click(); });
    await press(cell('bench:2:plan:kg'), 'ArrowDown');
    expect(selected().filter((c) => c!.startsWith('bench'))).toEqual(['bench:2:plan:kg']);
  });

  it('skips a collapsed lift', async () => {
    await render('both', true);
    await act(async () => { cell('squat:1:plan:reps').click(); });
    await press(cell('squat:1:plan:reps'), 'ArrowDown');
    expect(selected()).toEqual(['bench:0:plan:reps']);
  });

  it('works across lifts in Plan view too', async () => {
    await render('plan');
    const kg = (lift: string, row: number) => container.querySelector<HTMLElement>(`[data-cell-id="${lift}:g${row}:plan:kg"]`)!;
    await act(async () => { kg('squat', 1).click(); });
    await press(kg('squat', 1), 'ArrowDown');
    expect(selected()).toEqual(['row:g0:plan:kg']);
    await press(kg('row', 0), 'ArrowDown');
    await press(kg('bench', 0), 'ArrowUp');
    expect(selected()).toEqual(['row:g0:plan:kg']);
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from './ExerciseCard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const threeSets = () => [
  { id: 'a', scope: 'both', plannedWeight: 100, plannedReps: 5, intensity_type: 'RPE', target_value: 8, actual: 100, reps: 5, executedRpe: 8 },
  { id: 'b', scope: 'both', plannedWeight: 110, plannedReps: 4, intensity_type: 'RPE', target_value: 8 },
  { id: 'c', scope: 'both', plannedWeight: 120, plannedReps: 3, intensity_type: 'RPE', target_value: 9 },
];

const cell = (row: number, axis: 'plan' | 'log', field: string) =>
  container.querySelector<HTMLElement>(`[data-cell-id="lift-1:${row}:${axis}:${field}"]`)!;

async function press(el: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
  });
}

async function paste(el: HTMLElement, text: string) {
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    el.dispatchEvent(event);
  });
}

async function render(sets: Array<Record<string, unknown>> = threeSets(), onUpdateSets = vi.fn()) {
  await act(async () => root.render(<ExerciseCard
    id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
    canEditPlan initialSets={sets} onUpdateSets={onUpdateSets}
  />));
  return onUpdateSets;
}

const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as Array<Record<string, unknown>>;

describe('set grid range selection', () => {
  it('Shift+Arrows extend a range; Delete clears it; Ctrl+Z restores it', async () => {
    const spy = await render();
    await act(async () => { cell(0, 'plan', 'kg').click(); });
    await press(cell(0, 'plan', 'kg'), 'ArrowDown', { shiftKey: true });
    await press(cell(0, 'plan', 'kg'), 'ArrowRight', { shiftKey: true });
    expect(cell(1, 'plan', 'reps').getAttribute('data-in-range')).toBe('true');
    expect(cell(2, 'plan', 'kg').getAttribute('data-in-range')).toBeNull();

    await press(cell(0, 'plan', 'kg'), 'Delete');
    const cleared = last(spy);
    expect(cleared.map((s) => [s.plannedWeight, s.plannedReps])).toEqual([[null, null], [null, null], [120, 3]]);
    // Rows are never deleted by clearing.
    expect(cleared).toHaveLength(3);

    await press(cell(0, 'plan', 'kg'), 'z', { ctrlKey: true });
    expect(last(spy).map((s) => [s.plannedWeight, s.plannedReps])).toEqual([[100, 5], [110, 4], [120, 3]]);
    await press(cell(0, 'plan', 'kg'), 'y', { ctrlKey: true });
    expect(last(spy)[0].plannedWeight).toBeNull();
  });

  it('Esc collapses the range', async () => {
    await render();
    await act(async () => { cell(0, 'log', 'kg').click(); });
    await press(cell(0, 'log', 'kg'), 'ArrowRight', { shiftKey: true });
    expect(cell(0, 'log', 'reps').getAttribute('data-in-range')).toBe('true');
    await press(cell(0, 'log', 'kg'), 'Escape');
    expect(cell(0, 'log', 'reps').getAttribute('data-in-range')).toBeNull();
  });

  it('pastes a block from Sheets starting at the active cell, with decimal commas', async () => {
    const spy = await render();
    await act(async () => { cell(1, 'log', 'kg').click(); });
    await paste(cell(1, 'log', 'kg'), '105\t4\t8,5\r\n115\t3\t9\r\n');
    const after = last(spy);
    expect(after.map((s) => [s.actual, s.reps, s.executedRpe])).toEqual([[100, 5, 8], [105, 4, 8.5], [115, 3, 9]]);
    expect(container.querySelector('[data-testid="set-grid-notice-lift-1"]')).toBeNull();
  });

  it('a paste that runs past the last set is clipped and offers to add sets', async () => {
    const spy = await render();
    await act(async () => { cell(2, 'plan', 'kg').click(); });
    await paste(cell(2, 'plan', 'kg'), '130\t2\n140\t1');
    expect(last(spy)).toHaveLength(3);
    expect(container.querySelector('[data-testid="set-grid-notice-lift-1"]')!.textContent).toContain('Pasted 1 of 2 rows.');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="set-grid-notice-action-lift-1"]')!.click(); });
    const grown = last(spy);
    expect(grown).toHaveLength(4);
    expect([grown[3].plannedWeight, grown[3].plannedReps, grown[3].scope]).toEqual([140, 1, 'plan']);
  });

  it('Ctrl+D fills down from the first row of the range', async () => {
    const spy = await render();
    await act(async () => { cell(0, 'plan', 'reps').click(); });
    await press(cell(0, 'plan', 'reps'), 'ArrowDown', { shiftKey: true });
    await press(cell(0, 'plan', 'reps'), 'ArrowDown', { shiftKey: true });
    await press(cell(0, 'plan', 'reps'), 'd', { ctrlKey: true });
    expect(last(spy).map((s) => s.plannedReps)).toEqual([5, 5, 5]);
  });

  it('Ctrl+C copies the range as TSV', async () => {
    await render();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await act(async () => { cell(0, 'plan', 'kg').click(); });
    await press(cell(0, 'plan', 'kg'), 'ArrowDown', { shiftKey: true });
    await press(cell(0, 'plan', 'kg'), 'ArrowRight', { shiftKey: true });
    await press(cell(0, 'plan', 'kg'), 'c', { ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith('100\t5\n110\t4');
  });

  it('Ctrl+Enter writes suggested Plan kg only where there is an offer', async () => {
    const spy = await render([
      { id: 'a', scope: 'both', plannedWeight: 100, plannedReps: 5, intensity_type: 'RPE', target_value: 8, isTop: true },
      { id: 'b', scope: 'plan', plannedWeight: null, plannedReps: 5, intensity_type: 'RPE', target_value: 8 },
    ]);
    await act(async () => { cell(0, 'plan', 'kg').click(); });
    await press(cell(0, 'plan', 'kg'), 'ArrowDown', { shiftKey: true });
    await press(cell(0, 'plan', 'kg'), 'Enter', { ctrlKey: true });
    const after = last(spy);
    expect(after[0].plannedWeight).toBe(100);
    expect(after[1].plannedWeight).toBe(100);
  });

  it('refuses to undo over a change made elsewhere', async () => {
    const spy = await render();
    await act(async () => { cell(0, 'plan', 'kg').click(); });
    await press(cell(0, 'plan', 'kg'), 'Delete');
    const callsBefore = spy.mock.calls.length;
    // Someone else changes the lift (sync / coach edit).
    const external: Array<Record<string, unknown>> = threeSets();
    external[0].plannedWeight = 90;
    await render(external, spy);
    await press(cell(0, 'plan', 'kg'), 'z', { ctrlKey: true });
    expect(spy.mock.calls.length).toBe(callsBefore);
    expect(container.querySelector('[data-testid="set-grid-notice-lift-1"]')!.textContent).toContain("Can't undo");
  });

  it('undo still works after the parent feeds the saved sets back in (normal save round-trip)', async () => {
    const saved: Array<Array<Record<string, unknown>>> = [];
    function Host() {
      const [sets, setSets] = React.useState<any[]>(threeSets());
      return <ExerciseCard
        id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
        canEditPlan initialSets={sets} onUpdateSets={(next: any[]) => { saved.push(next); setSets(next); }}
      />;
    }
    await act(async () => root.render(<Host />));
    await act(async () => { cell(1, 'plan', 'kg').click(); });
    await press(cell(1, 'plan', 'kg'), 'Delete');
    expect(saved.at(-1)![1].plannedWeight).toBeNull();
    await press(cell(1, 'plan', 'kg'), 'z', { ctrlKey: true });
    expect(saved.at(-1)![1].plannedWeight).toBe(110);
    expect(container.querySelector('[data-testid="set-grid-notice-lift-1"]')).toBeNull();
  });

  it('clicking another cell commits the cell being edited, even after an earlier Enter commit there', async () => {
    const spy = await render();
    await act(async () => { cell(1, 'plan', 'kg').click(); });
    // First edit of this cell ends with Enter (the case that used to leak a "skip blur" flag).
    await press(cell(1, 'plan', 'kg'), 'F2');
    await press(container.querySelector<HTMLInputElement>('input[data-cell-id="lift-1:1:plan:kg"]')!, 'Enter');
    await act(async () => { cell(1, 'plan', 'kg').click(); });
    await press(cell(1, 'plan', 'kg'), 'F2');
    const input = container.querySelector<HTMLInputElement>('input[data-cell-id="lift-1:1:plan:kg"]')!;
    expect(document.activeElement).toBe(input);
    input.value = '1105';
    const target = cell(2, 'plan', 'reps');
    await act(async () => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
    await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
    expect(last(spy)[1].plannedWeight).toBe(1105);
    expect(document.activeElement?.getAttribute('data-cell-id')).toBe('lift-1:2:plan:reps');
  });

  it('one "Add set" adds a full plan + log row and selects its plan kg', async () => {
    const spy = await render();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="add-set-lift-1"]')!.click(); });
    const after = last(spy);
    expect(after).toHaveLength(4);
    expect(after[3].scope).toBe('both');
    expect(cell(3, 'plan', 'kg').getAttribute('data-selected')).toBe('true');
  });

  it('"Add set" first fills a row that is missing its log half', async () => {
    const spy = await render([
      { id: 'a', scope: 'both', plannedWeight: 100, plannedReps: 5, intensity_type: 'RPE', target_value: 8 },
      { id: 'b', scope: 'plan', plannedWeight: 110, plannedReps: 4, intensity_type: 'RPE', target_value: 8 },
    ]);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="add-set-lift-1"]')!.click(); });
    const after = last(spy);
    expect(after).toHaveLength(2);
    expect(after[1].scope).toBe('both');
    expect(after[1].plannedWeight).toBe(110);
  });

  it('without plan rights "Add set" adds a log set', async () => {
    const spy = vi.fn();
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan={false} initialSets={threeSets()} onUpdateSets={spy}
    />));
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="add-set-lift-1"]')!.click(); });
    expect(last(spy).at(-1)!.scope).toBe('log');
  });

  it('a % plan row compares the log against kg / pct (not "RPE 80")', async () => {
    await render([
      { id: 'a', scope: 'both', plannedWeight: 160, plannedReps: 5, intensity_type: 'PERCENT', target_value: 80, plannedRpe: 80, actual: 160, reps: 5, executedRpe: 8 },
    ]);
    // Plan e1RM 160 / 0.8 = 200; log e1RM 160×5 @8 = 195.12 → −2%.
    expect(container.querySelector('[data-testid="set-e1rm-delta-a"]')!.textContent).toBe('-2%');
  });

  it('a log without RPE gives no e1RM or Δ%, and INOL uses the % the plan implies', async () => {
    await render([
      { id: 'a', scope: 'both', isTop: true, plannedWeight: 100, plannedReps: 4, intensity_type: 'PERCENT', target_value: 60, plannedRpe: 60, actual: 100, reps: 4, executedRpe: null },
      { id: 'b', scope: 'plan', plannedWeight: 100, plannedReps: 4, intensity_type: 'PERCENT', target_value: 80, plannedRpe: 80 },
    ]);
    expect(container.querySelector('[data-testid="set-e1rm-a"]')!.textContent).toBe('—');
    expect(container.querySelector('[data-testid="set-e1rm-delta-a"]')!.textContent).toBe('—');
    // 100 kg on a 60% row → 60% of the implied max → 4 / (100 − 60) = 0.10.
    expect(container.querySelector('[data-testid="set-inol-a"]')!.textContent).toBe('0.10');
    // The lift e1RM falls back to the plan: 100 / 0.60.
    expect(container.querySelector('[data-testid="lift-e1rm-lift-1"]')!.textContent).toBe('167');
  });

  it('a locked session takes no range edits', async () => {
    const spy = vi.fn();
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan locked initialSets={threeSets()} onUpdateSets={spy}
    />));
    expect(container.querySelector('[data-cell-id]')).toBeNull();
  });
});

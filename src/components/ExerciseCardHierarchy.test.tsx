// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard, e1rmDeltaTone } from './ExerciseCard';

// Session sheet phase 2: faint Plan targets in empty Log cells, Ctrl/Cmd+Enter accepts
// them, current/done set states, quiet Δ.
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

const sets = () => [
  { id: 'a', scope: 'both', plannedWeight: 100, plannedReps: 5, intensity_type: 'RPE', target_value: 8, plannedRpe: 8, actual: 100, reps: 5, executedRpe: 8 },
  { id: 'b', scope: 'both', plannedWeight: 110, plannedReps: 4, intensity_type: 'RPE', target_value: 8, plannedRpe: 8, reps: 3 },
  { id: 'c', scope: 'both', plannedWeight: 120, plannedReps: 3, intensity_type: 'PERCENT', target_value: 85, plannedRpe: 85 },
];

const cell = (row: number, field: 'kg' | 'reps' | 'rpe') =>
  container.querySelector<HTMLElement>(`[data-cell-id="lift-1:${row}:log:${field}"]`)!;
const press = async (el: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}) => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })); });
};
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as Array<Record<string, unknown>>;

async function render(opts: { canEditPlan?: boolean; locked?: boolean } = {}) {
  const onUpdateSets = vi.fn();
  await act(async () => root.render(<ExerciseCard
    id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
    canEditPlan={opts.canEditPlan ?? true} locked={opts.locked} initialSets={sets()} onUpdateSets={onUpdateSets}
  />));
  return onUpdateSets;
}

describe('Plan targets in empty Log cells', () => {
  it('shows the Plan value faintly only while the Log cell is empty', async () => {
    await render();
    expect(cell(1, 'kg').textContent).toBe('110');
    expect(cell(1, 'kg').getAttribute('data-ghost')).toBe('true');
    expect(cell(1, 'reps').textContent).toBe('3');
    expect(cell(1, 'reps').getAttribute('data-ghost')).toBeNull();
    expect(cell(1, 'rpe').textContent).toBe('8');
    // A % row has no RPE target to suggest.
    expect(cell(2, 'kg').textContent).toBe('120');
    expect(cell(2, 'rpe').getAttribute('data-ghost')).toBeNull();
    expect(cell(0, 'kg').getAttribute('data-ghost')).toBeNull();
  });

  it('plain Enter does not fill; Ctrl/Cmd+Enter fills only the empty Log cells of that set', async () => {
    const spy = await render();
    await act(async () => { cell(1, 'kg').click(); });
    await press(cell(1, 'kg'), 'Enter');
    await press(cell(1, 'kg'), 'Escape');
    expect(spy).not.toHaveBeenCalled();
    await act(async () => { cell(1, 'rpe').click(); });
    await press(cell(1, 'rpe'), 'Enter', { metaKey: true });
    const b = last(spy).find((s) => s.id === 'b')!;
    // kg and RPE come from the Plan; the typed 3 reps stay.
    expect([b.actual, b.reps, b.executedRpe]).toEqual([110, 3, 8]);
    expect(last(spy).find((s) => s.id === 'a')).toMatchObject({ actual: 100, reps: 5, executedRpe: 8 });
  });

  it('is a Log action: works without plan rights', async () => {
    const spy = await render({ canEditPlan: false });
    await act(async () => { cell(2, 'kg').click(); });
    await press(cell(2, 'kg'), 'Enter', { ctrlKey: true });
    expect(last(spy).find((s) => s.id === 'c')).toMatchObject({ actual: 120, reps: 3 });
    expect(last(spy).find((s) => s.id === 'c')!.executedRpe ?? null).toBeNull();
  });
});

describe('set states and Δ', () => {
  it('tints the next set to do and marks logged sets', async () => {
    await render();
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0].getAttribute('data-current-set')).toBeNull();
    expect(rows[1].getAttribute('data-current-set')).toBe('true');
    expect(container.querySelector('[data-testid="set-done-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="set-done-2"]')).toBeNull();
  });

  it('keeps Δ quiet within ±3%', () => {
    expect(e1rmDeltaTone('0%')).toBe('quiet');
    expect(e1rmDeltaTone('+2%')).toBe('quiet');
    expect(e1rmDeltaTone('-2%')).toBe('quiet');
    expect(e1rmDeltaTone('+3%')).toBe('over');
    expect(e1rmDeltaTone('-8%')).toBe('under');
    expect(e1rmDeltaTone('—')).toBe('quiet');
  });
});

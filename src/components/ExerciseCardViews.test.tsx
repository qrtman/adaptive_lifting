// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from './ExerciseCard';

// Session sheet phase 3: Plan view groups identical sets; Log view hides Plan.
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

let n = 0;
const set = (kg: number, reps: number, rpe: number, extra: Record<string, unknown> = {}) =>
  ({ id: `s${++n}`, scope: 'both', plannedWeight: kg, plannedReps: reps, plannedRpe: rpe, target_value: rpe, intensity_type: 'RPE', dropPercent: 0, ...extra });
const program = () => [set(150, 3, 8), set(130, 5, 7), set(130, 5, 7), set(130, 5, 7), set(90, 6, 8)];

async function render(view: 'plan' | 'both' | 'log', sets: Array<Record<string, unknown>> = program(), opts: { canEditPlan?: boolean } = {}) {
  const onUpdateSets = vi.fn();
  await act(async () => root.render(<ExerciseCard
    id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
    canEditPlan={opts.canEditPlan ?? true} initialSets={sets} onUpdateSets={onUpdateSets} view={view}
  />));
  return onUpdateSets;
}
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const testId = (id: string) => q(`[data-testid="${id}"]`)!;
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as Array<Record<string, any>>;

async function edit(cell: HTMLElement, value: string) {
  await act(async () => { cell.click(); });
  await act(async () => { cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); });
  const input = q(`input[data-cell-id="${cell.getAttribute('data-cell-id')}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
}

describe('Plan view', () => {
  it('shows identical consecutive sets as one row with a set count and faint set numbers', async () => {
    await render('plan');
    expect(q('[data-testid="set-grid"]')).toBeNull();
    expect([0, 1, 2].map((row) => testId(`plan-group-lift-1-${row}-index`).textContent)).toEqual(['1', '2–4', '5']);
    expect(testId('lift-1-g1-sets').textContent).toBe('3sets');
    expect(testId('lift-1-g0-sets').textContent).toBe('1');
    expect(testId('lift-1-g1-kg').textContent).toBe('130');
  });

  it('editing a grouped row writes every set in it', async () => {
    const spy = await render('plan');
    await edit(testId('lift-1-g1-kg'), '135');
    expect(last(spy).map((s) => s.plannedWeight)).toEqual([150, 135, 135, 135, 90]);
  });

  it('the Sets cell adds or removes sets; a logged set keeps its log at the end', async () => {
    const spy = await render('plan');
    await edit(testId('lift-1-g1-sets'), '4');
    expect(last(spy).map((s) => s.plannedWeight)).toEqual([150, 130, 130, 130, 130, 90]);

    const logged: Array<Record<string, unknown>> = program();
    logged[3] = { ...logged[3], actual: 130, reps: 5, executedRpe: 8 };
    const spy2 = await render('plan', logged);
    await edit(testId('lift-1-g1-sets'), '2');
    expect(last(spy2).map((s) => [s.scope, s.plannedWeight ?? null, s.actual ?? null])).toEqual([
      ['both', 150, null], ['both', 130, null], ['both', 130, null], ['both', 90, null], ['log', null, 130],
    ]);
  });

  it('expands a group into single rows and back', async () => {
    await render('plan');
    await act(async () => { testId('plan-group-lift-1-1-toggle').click(); });
    expect([1, 2, 3].map((row) => testId(`plan-group-lift-1-${row}-index`).textContent)).toEqual(['2', '3', '4']);
    await act(async () => { testId('plan-group-lift-1-2-toggle').click(); });
    expect(testId('plan-group-lift-1-1-index').textContent).toBe('2–4');
  });

  it('is read-only without plan rights', async () => {
    const spy = await render('plan', program(), { canEditPlan: false });
    expect(q('[data-testid="plan-view-add-set-lift-1"]')).toBeNull();
    await act(async () => { testId('lift-1-g1-kg').click(); });
    await act(async () => { testId('lift-1-g1-kg').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); });
    expect(q('input[data-cell-id="lift-1:g1:plan:kg"]')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Log view', () => {
  it('hides the Plan columns and keeps the keyboard on Log cells', async () => {
    await render('log');
    const grid = testId('set-grid');
    expect(grid.className).toContain('sheet-grid--log-only');
    expect(testId('set-grid-h-plan').className).toContain('plan-col');
    const logKg = q('[data-cell-id="lift-1:0:log:kg"]')!;
    await act(async () => { logKg.click(); });
    await act(async () => { logKg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); });
    expect(logKg.getAttribute('data-selected')).toBe('true');
    expect(q('[data-cell-id="lift-1:0:plan:rpe"]')?.getAttribute('data-selected') ?? null).toBeNull();
  });
});

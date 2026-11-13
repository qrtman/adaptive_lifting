// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from './ExerciseCard';

// Session sheet phase 6: a dot by the set number marks a set note; the number opens its editor.
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

const set = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, scope: 'both', plannedWeight: 100, plannedReps: 5, plannedRpe: 7, target_value: 7, intensity_type: 'RPE', dropPercent: 0, ...extra });

async function render(sets: Array<Record<string, unknown>>, opts: { view?: 'plan' | 'both' | 'log'; locked?: boolean; canEditPlan?: boolean } = {}) {
  const onUpdateSets = vi.fn();
  await act(async () => root.render(<ExerciseCard
    id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
    initialSets={sets} onUpdateSets={onUpdateSets} view={opts.view ?? 'both'} locked={opts.locked} canEditPlan={opts.canEditPlan ?? true}
  />));
  return onUpdateSets;
}
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as Array<Record<string, any>>;

async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('set notes', () => {
  it('shows a dot only on sets with a note', async () => {
    await render([set('a'), set('b', { note: 'belt on' })]);
    expect(byId('set-note-lift-1-1-dot')).toBeNull();
    expect(byId('set-note-lift-1-2-dot')).not.toBeNull();
    expect(byId('set-note-lift-1-2')!.getAttribute('title')).toBe('belt on');
  });

  it('adds a note from the set number, saves with Ctrl+Enter, and clears it', async () => {
    const onUpdateSets = await render([set('a'), set('b')]);
    await act(async () => { byId('set-note-lift-1-2')!.click(); });
    const input = byId('set-note-lift-1-2-input') as HTMLTextAreaElement;
    await type(input, '  grindy last rep ');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(last(onUpdateSets).map((s) => s.note ?? null)).toEqual([null, 'grindy last rep']);
    expect(byId('set-note-lift-1-2-editor')).toBeNull();
    expect(byId('set-note-lift-1-2-dot')).not.toBeNull();

    await act(async () => { byId('set-note-lift-1-2')!.click(); });
    await act(async () => { byId('set-note-lift-1-2-clear')!.click(); });
    expect(last(onUpdateSets)[1].note).toBeNull();
  });

  it('Esc cancels without saving', async () => {
    const onUpdateSets = await render([set('a', { note: 'keep' })]);
    await act(async () => { byId('set-note-lift-1-1')!.click(); });
    const input = byId('set-note-lift-1-1-input') as HTMLTextAreaElement;
    await type(input, 'changed');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(onUpdateSets).not.toHaveBeenCalled();
  });

  it('writes the note to the Log record when Plan and Log are separate records', async () => {
    const onUpdateSets = await render([set('p', { scope: 'plan' }), { id: 'l', scope: 'log', actual: 100, reps: 5 }]);
    await act(async () => { byId('set-note-lift-1-1')!.click(); });
    await type(byId('set-note-lift-1-1-input') as HTMLTextAreaElement, 'easy');
    await act(async () => { byId('set-note-lift-1-1-save')!.click(); });
    const sets = last(onUpdateSets);
    expect(sets.find((s) => s.id === 'l')!.note).toBe('easy');
    expect(sets.find((s) => s.id === 'p')!.note ?? null).toBeNull();
  });

  it('an athlete without Plan rights can still note a set; a finished session only reads it', async () => {
    const onUpdateSets = await render([set('a')], { canEditPlan: false });
    await act(async () => { byId('set-note-lift-1-1')!.click(); });
    await type(byId('set-note-lift-1-1-input') as HTMLTextAreaElement, 'ok');
    await act(async () => { byId('set-note-lift-1-1-save')!.click(); });
    expect(last(onUpdateSets)[0].note).toBe('ok');

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render([set('a', { note: 'read me' }), set('b')], { locked: true });
    expect((byId('set-note-lift-1-2') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { byId('set-note-lift-1-1')!.click(); });
    expect((byId('set-note-lift-1-1-input') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(byId('set-note-lift-1-1-save')).toBeNull();
  });

  it('Plan view: a noted set is its own row with the dot and the editor', async () => {
    const onUpdateSets = await render([set('a'), set('b', { note: 'pause' }), set('c'), set('d')], { view: 'plan' });
    expect(byId('set-note-lift-1-2-dot')).not.toBeNull();
    expect(byId('plan-group-lift-1-2-index')!.textContent).toBe('3–4');
    await act(async () => { byId('set-note-lift-1-1')!.click(); });
    await type(byId('set-note-lift-1-1-input') as HTMLTextAreaElement, 'opener');
    await act(async () => { byId('set-note-lift-1-1-save')!.click(); });
    expect(last(onUpdateSets).map((s) => s.note ?? null)).toEqual(['opener', 'pause', null, null]);
  });
});

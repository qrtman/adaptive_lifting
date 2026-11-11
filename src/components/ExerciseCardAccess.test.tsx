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

describe('ExerciseCard coach plan access', () => {
  it('keeps log controls available while disabling plan mutations', async () => {
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan={false} initialSets={[
        { id: 'plan-1', scope: 'plan', plannedWeight: 100, plannedReps: 5 },
        { id: 'both-1', scope: 'both', actual: 90, reps: 5, plannedWeight: 95, plannedReps: 5 },
      ]} onUpdateSets={() => undefined}
    />));
    // One "Add set" stays available: without plan rights it adds a log set.
    expect(container.querySelector<HTMLButtonElement>('[data-testid="add-set-lift-1"]')?.disabled).toBe(false);
    // Rows with a plan can't be deleted without plan rights; the log cells can still be cleared.
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete set 1"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete set 2"]')?.disabled).toBe(true);
    expect(container.querySelector('[aria-label^="Delete plan set"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Delete log set"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Copy log set 1"]')?.disabled).toBe(false);
  });

  it('keeps log-only rows deletable without plan rights', async () => {
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan={false} initialSets={[
        { id: 'log-1', scope: 'log', actual: 90, reps: 5 },
      ]} onUpdateSets={() => undefined}
    />));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete set 1"]')?.disabled).toBe(false);
  });

  it('Delete set removes the whole row, including a separate log record', async () => {
    const onUpdateSets = vi.fn();
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan initialSets={[
        { id: 'plan-1', scope: 'plan', plannedWeight: 100, plannedReps: 5 },
        { id: 'plan-2', scope: 'plan', plannedWeight: 110, plannedReps: 5 },
        { id: 'log-1', scope: 'log', actual: 95, reps: 5 },
        { id: 'both-3', scope: 'both', plannedWeight: 120, plannedReps: 3, actual: 120, reps: 3 },
      ]} onUpdateSets={onUpdateSets}
    />));
    // Row 1 = plan-1 + log-1 (two records).
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Delete set 1"]')!.click(); });
    expect(onUpdateSets.mock.calls.at(-1)![0].map((s: { id: string }) => s.id)).toEqual(['plan-2', 'both-3']);
    // Now row 1 = plan-2 + log of both-3. Deleting it leaves both-3's plan (row 2) alone.
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Delete set 1"]')!.click(); });
    expect(onUpdateSets.mock.calls.at(-1)![0].map((s: { id: string; scope: string }) => [s.id, s.scope])).toEqual([['both-3', 'plan']]);
  });

  it('Delete set keeps the other half of a record that spans two rows', async () => {
    const onUpdateSets = vi.fn();
    // Row 1 = plan-1 + log of both-1; row 2 = plan of both-1, no log.
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan initialSets={[
        { id: 'plan-1', scope: 'plan', plannedWeight: 100, plannedReps: 5 },
        { id: 'both-1', scope: 'both', plannedWeight: 95, plannedReps: 5, actual: 90, reps: 5 },
      ]} onUpdateSets={onUpdateSets}
    />));
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Delete set 1"]')!.click(); });
    const after = onUpdateSets.mock.calls.at(-1)![0];
    expect(after.map((s: { id: string; scope: string }) => [s.id, s.scope])).toEqual([['both-1', 'plan']]);
    expect(after[0].actual).toBeNull();
    expect(after[0].plannedWeight).toBe(95);
  });

  it('renders a finished (locked) session read-only for plan and log', async () => {
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan locked initialSets={[
        { id: 'both-1', scope: 'both', actual: 90, reps: 5, plannedWeight: 95, plannedReps: 5 },
      ]} onUpdateSets={() => undefined} onUpdateMeta={() => undefined} onRemove={() => undefined}
    />));
    expect(container.querySelector('[data-testid="add-set-lift-1"]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete set 1"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Copy plan set 1 to log"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove Back Squat"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit Back Squat"]')?.disabled).toBe(true);
    // No note yet: the note editor stays closed and "+ Note" is disabled while locked.
    expect(container.querySelector('[data-testid="lift-note-lift-1"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="add-lift-note-lift-1"]')?.disabled).toBe(true);
  });

  it('shows readable stats and headers, and keeps the note out of the way until needed', async () => {
    const onUpdateMeta = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      tier="Comp" movementPattern="Knee Dominant"
      canEditPlan initialSets={[
        { id: 'both-1', scope: 'both', plannedWeight: 100, plannedReps: 5, intensity_type: 'RPE', target_value: 8 },
      ]} onUpdateSets={() => undefined} onUpdateMeta={onUpdateMeta}
    />));
    const text = container.textContent ?? '';
    expect(container.querySelector('[data-testid="lift-set-count-lift-1"]')!.textContent).toBe('1 planned · 0 logged');
    expect(text).toContain('Comp·Knee dominant');
    expect(container.querySelector('[data-testid="set-grid-h-pct"]')!.textContent).toBe('Drop %');
    expect(container.querySelector('[data-testid="set-grid-h-planReps"]')!.textContent).toBe('Reps');
    expect(container.querySelector('[data-testid="rx-intensity"]')!.textContent).toBe('RPE');

    // Note: closed by default, opens from "+ Note", saves on blur.
    expect(container.querySelector('[data-testid="lift-note-lift-1"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="add-lift-note-lift-1"]')!.click(); });
    const note = container.querySelector<HTMLTextAreaElement>('[data-testid="lift-note-lift-1"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(note, 'Belt from set 2');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { note.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onUpdateMeta).toHaveBeenCalledWith({ liftNote: 'Belt from set 2' });
    expect(container.querySelector('[data-testid="lift-note-lift-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="open-lift-note-lift-1"]')!.textContent).toContain('Belt from set 2');
  });
});

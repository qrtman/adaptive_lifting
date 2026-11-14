// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from './ExerciseCard';

// Phone tuning: tap a minimized row to open it, "Logged n / m", lift note on top, log-only Add set in Log.
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
const set = (extra: Record<string, unknown> = {}) =>
  ({ id: `s${++n}`, scope: 'both', plannedWeight: 80, plannedReps: 10, plannedRpe: 8, target_value: 8, intensity_type: 'RPE', dropPercent: 0, ...extra });
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

type Props = Partial<React.ComponentProps<typeof ExerciseCard>>;
async function render(props: Props = {}) {
  const onUpdateSets = vi.fn();
  const onMinimizedChange = vi.fn();
  const all = {
    id: 'lift-1', title: 'Barbell Row', variation: 'Barbell Row', tags: [], canEditPlan: true,
    initialSets: [set(), set(), set()], onUpdateSets, onMinimizedChange, ...props,
  } as React.ComponentProps<typeof ExerciseCard>;
  await act(async () => root.render(<ExerciseCard {...all} />));
  return { onUpdateSets, onMinimizedChange };
}

describe('minimized lift', () => {
  it('opens from a tap on its row, but not from a tap on the name button', async () => {
    const { onMinimizedChange } = await render({ minimized: true, onUpdateMeta: vi.fn() });
    const head = container.querySelector<HTMLElement>('.lift-head')!;
    expect(head.getAttribute('data-tap-to-open')).toBe('true');
    await act(async () => { q('variation-lift-1')!.click(); });
    expect(onMinimizedChange).not.toHaveBeenCalled();
    await act(async () => { q('lift-minimized-lift-1')!.click(); });
    expect(onMinimizedChange).toHaveBeenCalledWith(false);
  });

  it('reads "Logged n / m" like the session header', async () => {
    await render({ minimized: true, initialSets: [set({ actual: 80, reps: 10, executedRpe: 8 }), set(), set()] });
    expect(q('lift-logged-lift-1')!.textContent).toBe('1 / 3');
    expect(container.textContent).not.toContain('planned ·');
  });

  it('a lift planned only in its note shows "Logged n sets" and the note', async () => {
    await render({
      minimized: true,
      liftNote: '3x10 @ 80, last set AMRAP',
      initialSets: [set({ scope: 'log', plannedWeight: null, plannedReps: null, plannedRpe: null, target_value: null, actual: 80, reps: 10, executedRpe: 8 })],
    });
    expect(q('lift-logged-lift-1')!.textContent).toBe('1 set');
    expect(q('lift-minimized-note-lift-1')!.textContent).toBe('3x10 @ 80, last set AMRAP');
  });
});

describe('lift note on top', () => {
  it('sits above the set rows', async () => {
    await render({ minimized: false, liftNote: 'Belt from the top set', onUpdateMeta: vi.fn() });
    const note = q('lift-note-top-lift-1')!;
    const grid = container.querySelector('table')!;
    expect(note.textContent).toContain('Belt from the top set');
    expect(note.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is shown read-only to someone who cannot edit the lift', async () => {
    await render({ minimized: false, liftNote: '3x10 @ 80', canEditPlan: false });
    expect(q('lift-note-readonly-lift-1')!.textContent).toContain('3x10 @ 80');
    expect(q('open-lift-note-lift-1')).toBeNull();
  });
});

describe('Log view Add set', () => {
  it('adds a log-only set, not a Plan + Log row', async () => {
    const { onUpdateSets } = await render({ minimized: false, view: 'log', initialSets: [set({ actual: 80, reps: 10, executedRpe: 8 })] });
    await act(async () => { q('add-set-lift-1')!.click(); });
    const last = onUpdateSets.mock.calls.at(-1)![0] as Array<Record<string, unknown>>;
    expect(last).toHaveLength(2);
    expect(last[1].scope).toBe('log');
  });
});

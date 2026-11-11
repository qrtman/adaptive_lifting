// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from './ExerciseCard';
import { InlineAddLift } from './InlineAddLift';
import { LIFT_DRAG_MIME, WeekRail } from './WeekRail';
import { buildWeekRail } from '../features/plan/weekRail';

// Session sheet phase 5: lift ⋯ menu, variation title, "Type a lift name…", drag from the rail.
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
  vi.restoreAllMocks();
});
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const byTestId = (id: string) => q(`[data-testid="${id}"]`);
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };

describe('lift ⋯ menu', () => {
  const render = async (extra: Partial<React.ComponentProps<typeof ExerciseCard>> = {}) => {
    const props = {
      id: 'l1', title: 'Bench', variation: 'Bench · Paused', tags: [], initialMinimized: false,
      initialSets: [{ id: 'a', scope: 'both', plannedWeight: 90, plannedReps: 6 }],
      onUpdateSets: vi.fn(), onUpdateMeta: vi.fn(), onRemove: vi.fn(), onDuplicate: vi.fn(), ...extra,
    };
    await act(async () => root.render(<ExerciseCard {...props} />));
    return props;
  };

  it('Duplicate, Swap lift…, Add note and Delete', async () => {
    const props = await render();
    await click(byTestId('lift-menu-l1')!);
    expect([...byTestId('lift-menu-list-l1')!.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent))
      .toEqual(['Duplicate', 'Swap lift…', 'Add note', 'Delete']);
    await click(byTestId('lift-duplicate-l1')!);
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
    expect(byTestId('lift-menu-list-l1')).toBeNull();

    await click(byTestId('lift-menu-l1')!);
    await click(byTestId('lift-swap-l1')!);
    expect(document.querySelector('[data-testid="edit-lift-dialog"]')).not.toBeNull();
  });

  it('Add note opens the note editor; Delete asks first', async () => {
    const props = await render();
    await click(byTestId('lift-menu-l1')!);
    await click(byTestId('lift-add-note-l1')!);
    expect(byTestId('lift-note-l1')).not.toBeNull();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(byTestId('lift-menu-l1')!);
    await click(byTestId('lift-delete-l1')!);
    expect(props.onRemove).not.toHaveBeenCalled();
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await click(byTestId('lift-menu-l1')!);
    await click(byTestId('lift-delete-l1')!);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('Duplicate is disabled with a reason (offline); the variation title opens Edit', async () => {
    await render({ duplicateDisabledReason: 'Connect to duplicate lifts.' });
    await click(byTestId('lift-menu-l1')!);
    const dup = byTestId('lift-duplicate-l1') as HTMLButtonElement;
    expect(dup.disabled).toBe(true);
    expect(dup.title).toBe('Connect to duplicate lifts.');
    await click(byTestId('variation-l1')!);
    expect(document.querySelector('[data-testid="edit-lift-dialog"]')).not.toBeNull();
  });

  it('read-only lifts have no menu and a plain title', async () => {
    await render({ onUpdateMeta: undefined, onRemove: undefined, onDuplicate: undefined });
    expect(byTestId('lift-menu-l1')).toBeNull();
    expect(byTestId('variation-l1')).toBeNull();
  });
});

describe('Type a lift name…', () => {
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const key = async (el: HTMLElement, k: string) => {
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
  };

  it('Enter adds the highlighted catalog lift and keeps typing; Tab adds and jumps into it', async () => {
    const onAdd = vi.fn(async () => 'new-lift');
    const onFocusLift = vi.fn();
    await act(async () => root.render(<InlineAddLift onAdd={onAdd} onFocusLift={onFocusLift} />));
    const input = byTestId('inline-add-lift-input') as HTMLInputElement;
    await type(input, 'romanian');
    expect(byTestId('inline-add-lift-options')!.textContent).toContain('RDL');
    await key(input, 'Enter');
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'RDL' }));
    expect(input.value).toBe('');
    expect(onFocusLift).not.toHaveBeenCalled();

    await type(input, 'Sled push');
    await key(input, 'Tab');
    expect(onAdd).toHaveBeenLastCalledWith({ title: 'Sled push', variation: 'Sled push', tier: 'Accessory', liftCategory: 'Other', movementPattern: 'Misc' });
    expect(onFocusLift).toHaveBeenCalledWith('new-lift');
  });

  it('is disabled with a visible reason', async () => {
    await act(async () => root.render(<InlineAddLift disabledReason="Connect to add lifts" onAdd={vi.fn()} onFocusLift={vi.fn()} />));
    const input = byTestId('inline-add-lift-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Connect to add lifts');
  });
});

describe('drag a lift from the week rail', () => {
  it('lifts of other days are draggable and carry their ids', async () => {
    const w = (id: string, date: string, day: string) => ({
      id, date, dayLabel: day, title: 'Session', weekLabel: '3', blockLabel: null, tonnage: 0, delta: 0, color: 'gray',
      status: 'PLANNED', exercises: [{ id: `${id}-bench`, title: 'Bench', variation: 'Bench', tags: [], top: '', vol: '', sets: [] }],
    }) as any;
    const micro = [{ id: 'm', weekName: '', focus: '', status: 'ACTIVE', workouts: [w('d1', '2026-11-10', '1'), w('d2', '2026-11-12', '2')] }] as any;
    await act(async () => root.render(<WeekRail model={buildWeekRail(micro, 'd2')!} activeId="d2" notes={{}} onOpen={vi.fn()}
      canAssign onAssign={vi.fn()} onAssignWeek={vi.fn()} canDragLifts />));
    expect(byTestId('week-rail-lift-d1-bench')!.getAttribute('draggable')).toBe('true');
    expect(byTestId('week-rail-lift-d2-bench')!.getAttribute('draggable')).toBe('false');
    const data = new Map<string, string>();
    const event = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' } });
    await act(async () => { byTestId('week-rail-lift-d1-bench')!.dispatchEvent(event); });
    expect(JSON.parse(data.get(LIFT_DRAG_MIME)!)).toEqual({ workoutId: 'd1', exerciseId: 'd1-bench' });
  });
});

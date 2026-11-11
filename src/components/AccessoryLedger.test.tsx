// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessoryLedger } from './AccessoryLedger';
import { ExerciseCard } from './ExerciseCard';
import type { ExerciseData } from '../types';

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

const accessory = (id: string, title: string): ExerciseData => ({
  id, title, variation: title, tags: [], tier: 'Accessory', liftCategory: 'Other',
  sets: [{ id: `${id}-s1`, label: 'Set 1', scope: 'both', plannedWeight: 20, plannedReps: 12, plannedRpe: 8, intensity_type: 'RPE', target_value: 8, actual: null, reps: null, executedRpe: null }],
} as unknown as ExerciseData);

function Host() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <AccessoryLedger
      exercises={[accessory('acc-1', 'Lateral Raise'), accessory('acc-2', 'Leg Curl')]}
      onUpdateSets={() => undefined}
      isCollapsed={(id) => collapsed.has(id)}
      onCollapsedChange={(id, value) => setCollapsed((prev) => {
        const next = new Set(prev);
        if (value) next.add(id); else next.delete(id);
        return next;
      })}
    />
  );
}

const q = (sel: string) => container.querySelector<HTMLElement>(sel);

describe('Accessories use the same lift card as main lifts', () => {
  it('every accessory is open by default, and collapses to the standard minimized header', async () => {
    await act(async () => root.render(<Host />));
    expect(container.querySelectorAll('[data-testid="set-grid"]')).toHaveLength(2);
    // No old compact rows.
    expect(q('[data-testid^="accessory-row-"]')).toBeNull();

    await act(async () => { q('[data-testid="toggle-lift-acc-1"]')!.click(); });
    expect(q('[data-testid="lift-minimized-acc-1"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="set-grid"]')).toHaveLength(1);
    // Opening one accessory never closes another.
    expect(q('[data-testid="lift-meta-acc-2"]')).not.toBeNull();

    await act(async () => { q('[data-testid="toggle-lift-acc-1"]')!.click(); });
    expect(container.querySelectorAll('[data-testid="set-grid"]')).toHaveLength(2);
  });

  it('the Accessories heading hides and shows the whole group', async () => {
    await act(async () => root.render(<Host />));
    await act(async () => { q('[data-testid="accessory-ledger-toggle"]')!.click(); });
    expect(container.querySelectorAll('[data-testid^="toggle-lift-"]')).toHaveLength(0);
    await act(async () => { q('[data-testid="accessory-ledger-toggle"]')!.click(); });
    expect(container.querySelectorAll('[data-testid^="toggle-lift-"]')).toHaveLength(2);
  });
});

describe('ExerciseCard controlled minimized', () => {
  it('follows the prop and reports toggles without changing on its own', async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialSets={[]}
      onUpdateSets={() => undefined} minimized onMinimizedChange={onChange}
    />));
    expect(q('[data-testid="lift-minimized-lift-1"]')).not.toBeNull();
    await act(async () => { q('[data-testid="toggle-lift-lift-1"]')!.click(); });
    expect(onChange).toHaveBeenCalledWith(false);
    // Still minimized: the parent owns the state.
    expect(q('[data-testid="lift-minimized-lift-1"]')).not.toBeNull();
  });
});

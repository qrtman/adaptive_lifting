// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(container.querySelector<HTMLButtonElement>('[data-testid="add-plan-set-lift-1"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="add-log-set-lift-1"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Delete plan set 1"]')?.disabled).toBe(true);
    const logDelete = container.querySelector<HTMLButtonElement>('[aria-label^="Delete log set"]');
    expect(logDelete).toBeTruthy();
    expect(logDelete?.disabled).toBe(false);
  });

  it('renders a finished (locked) session read-only for plan and log', async () => {
    await act(async () => root.render(<ExerciseCard
      id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
      canEditPlan locked initialSets={[
        { id: 'both-1', scope: 'both', actual: 90, reps: 5, plannedWeight: 95, plannedReps: 5 },
      ]} onUpdateSets={() => undefined} onUpdateMeta={() => undefined} onRemove={() => undefined}
    />));
    expect(container.querySelector('[data-testid="add-plan-set-lift-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-log-set-lift-1"]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label^="Delete log set"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Copy plan set 1 to log"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove Back Squat"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit Back Squat"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="lift-note-lift-1"]')?.disabled).toBe(true);
  });
});

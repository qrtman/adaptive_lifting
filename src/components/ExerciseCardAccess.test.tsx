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
});

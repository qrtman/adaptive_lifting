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

type Row = { id: string; scope: string; plannedWeight?: number | null; plannedReps?: number | null; actual?: number | null; reps?: number | null };

/** What the grid shows: row N = Nth plan record (plan half) beside Nth log record (log half). */
function rows(sets: Row[]) {
  const plans = sets.filter((s) => s.scope !== 'log');
  const logs = sets.filter((s) => s.scope !== 'plan');
  return Array.from({ length: Math.max(plans.length, logs.length) }, (_, i) => ({
    plan: plans[i] ? [plans[i].plannedWeight ?? null, plans[i].plannedReps ?? null] : null,
    log: logs[i] ? [logs[i].actual ?? null, logs[i].reps ?? null] : null,
  }));
}

async function render(initialSets: Row[], opts: { canEditPlan?: boolean } = {}) {
  const onUpdateSets = vi.fn();
  await act(async () => root.render(<ExerciseCard
    id="lift-1" title="Squat" variation="Back Squat" tags={[]} initialMinimized={false}
    canEditPlan={opts.canEditPlan ?? true} initialSets={initialSets} onUpdateSets={onUpdateSets}
  />));
  const copy = async (row: number) => {
    await act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="Copy plan set ${row} to log"]`)!.click(); });
    return onUpdateSets.mock.calls.at(-1)![0] as Row[];
  };
  return { copy, onUpdateSets };
}

describe('Copy plan to log', () => {
  it('fills the log of the same row when the plan and log are one record', async () => {
    const { copy } = await render([
      { id: 'a', scope: 'both', plannedWeight: 100, plannedReps: 5 },
      { id: 'b', scope: 'both', plannedWeight: 110, plannedReps: 3 },
    ]);
    expect(rows(await copy(2))).toEqual([
      { plan: [100, 5], log: [null, null] },
      { plan: [110, 3], log: [110, 3] },
    ]);
  });

  it('fills a separate log record without adding a plan row', async () => {
    const { copy } = await render([
      { id: 'p1', scope: 'plan', plannedWeight: 100, plannedReps: 5 },
      { id: 'p2', scope: 'plan', plannedWeight: 110, plannedReps: 3 },
      { id: 'l1', scope: 'log', actual: null, reps: null },
    ]);
    expect(rows(await copy(1))).toEqual([
      { plan: [100, 5], log: [100, 5] },
      { plan: [110, 3], log: null },
    ]);
  });

  it('puts the log on the row that was copied when earlier rows have no log yet', async () => {
    const { copy } = await render([
      { id: 'p1', scope: 'plan', plannedWeight: 100, plannedReps: 5 },
      { id: 'p2', scope: 'plan', plannedWeight: 110, plannedReps: 3 },
      { id: 'p3', scope: 'plan', plannedWeight: 120, plannedReps: 1 },
    ]);
    const after = rows(await copy(3));
    expect(after.map((r) => r.plan)).toEqual([[100, 5], [110, 3], [120, 1]]);
    expect(after[2].log).toEqual([120, 1]);
    expect(after[0].log ?? [null, null]).toEqual([null, null]);
    expect(after[1].log ?? [null, null]).toEqual([null, null]);
  });

  it('copies rows in order on a plan-only lift', async () => {
    const { copy } = await render([
      { id: 'p1', scope: 'plan', plannedWeight: 100, plannedReps: 5 },
      { id: 'p2', scope: 'plan', plannedWeight: 110, plannedReps: 3 },
    ]);
    await copy(1);
    expect(rows(await copy(2))).toEqual([
      { plan: [100, 5], log: [100, 5] },
      { plan: [110, 3], log: [110, 3] },
    ]);
  });

  it('is a log action: allowed without plan rights, blocked only when the session is locked', async () => {
    await render([{ id: 'a', scope: 'both', plannedWeight: 100, plannedReps: 5 }], { canEditPlan: false });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Copy plan set 1 to log"]')?.disabled).toBe(false);
  });
});

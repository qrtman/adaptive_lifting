// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConflictReviewCard } from './ConflictReviewCard';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;

beforeEach(() => {
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

// Real server shapes: ExerciseSet conflicts carry to_jsonb(exercise_sets row);
// Exercise conflicts carry { sets: al_exercise_sets_snapshot(...) } in camelCase.
const setRow = {
  id: 'set-1', revision: 4, exercise_id: 'ex-1', lexo_rank: 'a', deleted_at: null, created_at: '2026-11-01T00:00:00Z',
  plannedWeight: 100, plannedReps: 5, plannedRpe: 8, actual: 105, reps: 5, executedRpe: 8.5, note: 'moved well',
};

function changeLines() {
  return [...node.querySelectorAll('[data-testid="conflict-changes"] p')].map(p => p.textContent);
}

it('shows only the changed set fields with coach labels and invokes explicit resolution actions', async () => {
  const keepServer = vi.fn();
  const exportEdit = vi.fn();
  await act(async () => root.render(
    <ConflictReviewCard
      mutationId="mutation-1" entityType="ExerciseSet" entityId="set-1" reason="STALE_REVISION"
      serverFields={setRow}
      clientFields={{ actual: 100, reps: 5, executedRpe: 9 }}
      target={{ sessionDate: '2026-11-03', sessionTitle: 'Heavy squat', liftName: 'Back Squat', setNumber: 2 }}
      onKeepServer={keepServer} onExport={exportEdit}
    />,
  ));
  const text = node.textContent || '';
  expect(text).toContain('2026-11-03 · Heavy squat — Back Squat — Set 2');
  expect(text).toContain('Logged weightServer has105Your edit100');
  expect(text).toContain('Logged RPEServer has8.5Your edit9');
  expect(text).not.toContain('Logged reps'); // equal on both sides
  expect(node.querySelector('[data-testid="conflict-changes"]')?.textContent).not.toMatch(/revision|exercise|lexo|deleted|created|id/i);
  expect(text).toContain('changed elsewhere');
  expect(text).toContain('Code: STALE_REVISION');
  const buttons = [...node.querySelectorAll('button')];
  await act(async () => buttons[0].click());
  await act(async () => buttons[1].click());
  expect(keepServer).toHaveBeenCalledOnce();
  expect(exportEdit).toHaveBeenCalledOnce();
});

it('renders Exercise set lists one per line in coach language', async () => {
  const serverSets = [
    { ...setRow },
    { id: 'set-2', revision: 1, plannedWeight: 110, plannedReps: 3, plannedRpe: 9, actual: null, reps: null, executedRpe: null },
  ];
  const clientSets = [{ ...setRow }, { ...serverSets[1], plannedWeight: 112.5 }];
  await act(async () => root.render(
    <ConflictReviewCard mutationId="m2" entityType="Exercise" entityId="ex-1" reason="BASELINE_REQUIRED"
      serverFields={{ sets: serverSets }} clientFields={{ sets: clientSets }}
      onKeepServer={vi.fn()} onExport={vi.fn()} />,
  ));
  expect(changeLines()).toEqual([
    'Set 1: Plan 100 kg × 5 @ RPE 8 · Log 105 × 5 @ RPE 8.5',
    'Set 2: Plan 110 kg × 3 @ RPE 9',
    'Set 1: Plan 100 kg × 5 @ RPE 8 · Log 105 × 5 @ RPE 8.5',
    'Set 2: Plan 112.5 kg × 3 @ RPE 9',
  ]);
  expect(node.textContent).toContain('latest copy');
  expect(node.textContent).not.toContain('changed elsewhere');
  expect(node.textContent).toContain('Lift ex-1');
  expect(node.querySelector('pre')).toBeNull();
});

it('gives each conflict reason its own wording', async () => {
  const copy: Record<string, string> = {};
  for (const reason of ['STALE_REVISION', 'BASELINE_REQUIRED', 'OVERLAPPING_BATCH_PATCH', 'TOMBSTONE_CONFLICT', 'server revision changed']) {
    await act(async () => root.render(
      <ConflictReviewCard mutationId="m" entityType="ExerciseSet" entityId="s" reason={reason}
        serverFields={{ actual: 1 }} clientFields={{ actual: 2 }} onKeepServer={vi.fn()} onExport={vi.fn()} />,
    ));
    copy[reason] = node.querySelector('[data-testid="conflict-reason"]')?.textContent || '';
    expect(node.textContent).toContain(`Code: ${reason}`);
  }
  expect(new Set(Object.values(copy)).size).toBe(5);
});

it('never renders different values the same way', async () => {
  const pairs: [unknown, unknown][] = [
    [null, ''], [undefined, ''], [[1, 2, 3], [[1, 2], 3]], [5, '5'], [[], null], ['a', ' a'],
  ];
  for (const [server, client] of pairs) {
    await act(async () => root.render(
      <ConflictReviewCard mutationId="m" entityType="Workout" entityId="w" reason="STALE_REVISION"
        serverFields={{ note: server }} clientFields={{ note: client }} onKeepServer={vi.fn()} onExport={vi.fn()} />,
    ));
    const [left, right] = changeLines();
    expect(left, `${JSON.stringify(server)} vs ${JSON.stringify(client)}`).not.toBe(right);
  }
  await act(async () => root.render(
    <ConflictReviewCard mutationId="m" entityType="Workout" entityId="w" reason="STALE_REVISION"
      serverFields={{ note: {} }} clientFields={{ note: 'x' }} onKeepServer={vi.fn()} onExport={vi.fn()} />,
  ));
  expect(changeLines()[0]).toBe('not set');
});

it('names each of two simultaneous conflicts so Keep server targets the right one', async () => {
  const keepA = vi.fn(); const keepB = vi.fn();
  await act(async () => root.render(<>
    <ConflictReviewCard mutationId="a" entityType="ExerciseSet" entityId="set-a" reason="STALE_REVISION"
      serverFields={{ actual: 100 }} clientFields={{ actual: 102.5 }}
      target={{ sessionDate: '2026-11-03', sessionTitle: 'Squat day', liftName: 'Back Squat', setNumber: 1 }}
      onKeepServer={keepA} onExport={vi.fn()} />
    <ConflictReviewCard mutationId="b" entityType="ExerciseSet" entityId="set-b" reason="STALE_REVISION"
      serverFields={{ actual: 100 }} clientFields={{ actual: 102.5 }}
      target={{ sessionDate: '2026-11-05', sessionTitle: 'Bench day', liftName: 'Bench Press', setNumber: 3 }}
      onKeepServer={keepB} onExport={vi.fn()} />
  </>));
  const targets = [...node.querySelectorAll('[data-testid="conflict-target"]')].map(el => el.textContent);
  expect(targets).toEqual(['2026-11-03 · Squat day — Back Squat — Set 1', '2026-11-05 · Bench day — Bench Press — Set 3']);
  const keepBench = node.querySelector('button[aria-label="Keep server version for 2026-11-05 · Bench day — Bench Press — Set 3"]') as HTMLButtonElement;
  await act(async () => keepBench.click());
  expect(keepB).toHaveBeenCalledOnce();
  expect(keepA).not.toHaveBeenCalled();
});

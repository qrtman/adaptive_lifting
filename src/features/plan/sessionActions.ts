import type { SetData } from '../../types';
import type { GridCommit } from '../../surface/grid/gridTypes';

export function applyCommits(sets: SetData[], commits: GridCommit[]): SetData[] {
  return sets.map((set) => {
    const hits = commits.filter((c) => c.setId === set.id);
    if (!hits.length) return set;
    const next = { ...set };
    for (const hit of hits) {
      if (hit.field === 'plannedWeight') next.plannedWeight = typeof hit.value === 'number' ? hit.value : null;
      else if (hit.field === 'plannedReps') next.plannedReps = typeof hit.value === 'number' ? hit.value : null;
      else if (hit.field === 'plannedRpe') {
        next.plannedRpe = typeof hit.value === 'number' ? hit.value : null;
        next.target_value = next.plannedRpe ?? undefined;
      } else if (hit.field === 'actual') next.actual = typeof hit.value === 'number' ? hit.value : null;
      else if (hit.field === 'reps') next.reps = typeof hit.value === 'number' ? hit.value : null;
      else if (hit.field === 'executedRpe') next.executedRpe = typeof hit.value === 'number' ? hit.value : null;
      else if (hit.field === 'note') next.note = typeof hit.value === 'string' ? hit.value : '';
    }
    return next;
  });
}

export function addSetBelow(sets: SetData[]): SetData[] {
  const previous = sets[sets.length - 1];
  return [
    ...sets,
    {
      id: `s-${Math.random().toString(36).slice(2, 12)}`,
      label: `Set ${sets.length + 1}`,
      plannedWeight: null,
      plannedReps: previous?.plannedReps ?? null,
      plannedRpe: previous?.plannedRpe ?? previous?.target_value ?? null,
      intensity_type: previous?.intensity_type || 'RPE',
      target_value: previous?.target_value ?? previous?.plannedRpe ?? undefined,
      isTop: false,
      isAuto: false,
      actual: null,
      reps: null,
      executedRpe: null,
    },
  ];
}

export function flattenSessions(microcycles: Array<{ id: string; workouts: Array<{ id: string }> }>) {
  return microcycles.flatMap((micro) => micro.workouts.map((workout) => ({ workout, microId: micro.id })));
}

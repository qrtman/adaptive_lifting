import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ExerciseCard } from './ExerciseCard';
import { ExerciseData, LiftMetaPatch } from '../types';

export const AccessoryLedger = ({
  exercises,
  onUpdateSets,
  onUpdateMeta,
  onRemove,
  locked = false,
  roleMode = 'athlete'
}: {
  exercises: ExerciseData[],
  onUpdateSets: (exerciseId: string, sets: ExerciseData['sets']) => void,
  onUpdateMeta?: (exerciseId: string, patch: LiftMetaPatch) => void | Promise<void>,
  onRemove?: (exerciseId: string) => void | Promise<void>,
  locked?: boolean,
  roleMode?: 'coach' | 'athlete'
}) => {
  const [open, setOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (activeId && !exercises.some((exercise) => exercise.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, exercises]);

  if (exercises.length === 0) return null;

  const summary = exercises.reduce(
    (acc, exercise) => {
      acc.plan += exercise.sets.filter((set) => set.scope !== 'log').length;
      acc.logged += exercise.sets.filter((set) => set.scope !== 'plan' && set.actual != null).length;
      return acc;
    },
    { plan: 0, logged: 0 }
  );

  const labelFor = (exercise: ExerciseData) => (
    exercise.variation && exercise.variation !== 'Accessory' ? exercise.variation : exercise.title
  );

  return (
    <div className="cal-nested-card cal-nested-flush mx-2 mb-2 overflow-hidden" data-testid="accessory-ledger">
      <button
        type="button"
        data-testid="accessory-ledger-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (open) setActiveId(null);
        }}
        className="flex min-h-8 w-full items-center justify-between gap-3 px-2 py-1 text-left text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[var(--cal-muted)]">
            {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
          </span>
          <span className="text-sm font-semibold tracking-tight">Accessories</span>
        </span>
        <span className="tnum min-w-0 truncate text-[11px] text-[var(--cal-muted)]">
          {exercises.length} lift{exercises.length === 1 ? '' : 's'} &middot; {summary.plan} plan set{summary.plan === 1 ? '' : 's'} &middot; {summary.logged} logged
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--cal-hairline-soft)]">
          {exercises.map((exercise) => {
            const isActive = activeId === exercise.id;
            const plannedCount = exercise.sets.filter((set) => set.scope !== 'log').length;
            const loggedCount = exercise.sets.filter((set) => set.scope !== 'plan' && set.actual != null).length;

            if (isActive) {
              return (
                <ExerciseCard
                  key={exercise.id}
                  id={exercise.id}
                  title={exercise.title}
                  variation={labelFor(exercise)}
                  tags={exercise.tags}
                  tier={exercise.tier}
                  liftCategory={exercise.liftCategory}
                  movementPattern={exercise.movementPattern}
                  liftNote={exercise.liftNote}
                  initialSets={exercise.sets}
                  onUpdateSets={(updatedSets) => onUpdateSets(exercise.id, updatedSets)}
                  onUpdateMeta={onUpdateMeta ? (patch) => onUpdateMeta(exercise.id, patch) : undefined}
                  onRemove={onRemove ? () => onRemove(exercise.id) : undefined}
                  locked={locked}
                  roleMode={roleMode}
                  initialMinimized={false}
                />
              );
            }

            return (
              <button
                key={exercise.id}
                type="button"
                data-testid={`accessory-row-${exercise.id}`}
                onClick={() => setActiveId(exercise.id)}
                className="flex min-h-7 w-full items-center justify-between gap-3 border-b border-[var(--cal-hairline-soft)] px-3 py-0.5 text-left text-[var(--cal-ink)] last:border-b-0 hover:bg-[var(--cal-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cal-accent)]"
              >
                <span className="min-w-0 truncate text-sm font-medium">{labelFor(exercise)}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--cal-muted)]">
                  <span className="tnum whitespace-nowrap">{plannedCount} plan</span>
                  <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">&middot;</span>
                  <span className="tnum whitespace-nowrap">{loggedCount} logged</span>
                  <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">&middot;</span>
                  <span className="max-w-28 truncate">{exercise.movementPattern ?? exercise.liftCategory ?? 'Accessory'}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

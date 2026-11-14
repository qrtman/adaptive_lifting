import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ExerciseCard } from './ExerciseCard';
import { ExerciseData, LiftMetaPatch } from '../types';

/**
 * "Accessories" group: a plain heading (not a card around cards) followed by the same lift card
 * every main lift uses, so an accessory looks the same open or collapsed as Squat does.
 */
export const AccessoryLedger = ({
  exercises,
  onUpdateSets,
  onUpdateMeta,
  onRemove,
  isCollapsed = () => false,
  onCollapsedChange,
  locked = false,
  canEditPlan = true,
  view = 'both',
  onDuplicate,
  duplicateDisabledReason,
  roleMode = 'athlete'
}: {
  exercises: ExerciseData[],
  onUpdateSets: (exerciseId: string, sets: ExerciseData['sets']) => void,
  onUpdateMeta?: (exerciseId: string, patch: LiftMetaPatch) => void | Promise<void>,
  onRemove?: (exerciseId: string) => void | Promise<void>,
  /** Per-lift collapse state shared with the main lifts (remembered per device). */
  isCollapsed?: (exerciseId: string) => boolean,
  onCollapsedChange?: (exerciseId: string, collapsed: boolean) => void,
  locked?: boolean,
  canEditPlan?: boolean,
  view?: 'plan' | 'both' | 'log',
  onDuplicate?: (exerciseId: string) => void | Promise<void>,
  duplicateDisabledReason?: string,
  roleMode?: 'coach' | 'athlete'
}) => {
  const [open, setOpen] = useState(true);

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
    <section data-testid="accessory-ledger" aria-label="Accessories">
      <button
        type="button"
        data-testid="accessory-ledger-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mb-1 mt-4 flex min-h-8 w-full items-center justify-between gap-3 rounded-[var(--cal-radius-md)] px-2 py-1 text-left text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--cal-muted)]">
            {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
          </span>
          <span className="text-sm font-semibold tracking-tight">Accessories</span>
        </span>
        <span className="tnum min-w-0 truncate text-[11px] text-[var(--cal-muted)]">
          {summary.plan > 0 ? <>Logged {summary.logged} / {summary.plan}</> : <>Logged {summary.logged} set{summary.logged === 1 ? '' : 's'}</>}
        </span>
      </button>
      {open ? exercises.map((exercise) => (
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
          canEditPlan={canEditPlan}
          view={view}
          onDuplicate={onDuplicate ? () => onDuplicate(exercise.id) : undefined}
          duplicateDisabledReason={duplicateDisabledReason}
          roleMode={roleMode}
          minimized={isCollapsed(exercise.id)}
          onMinimizedChange={(value) => onCollapsedChange?.(exercise.id, value)}
        />
      )) : null}
    </section>
  );
};

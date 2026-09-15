import { useEffect, useState } from 'react';
import type { WorkoutData, WorkoutStatus } from '../../types';
import type { MovementPattern } from '../../services/exerciseCatalog';
import { WorkoutLockBanner } from '../../components/WorkoutLockBanner';
import { EditSessionDialog } from '../../components/EditSessionDialog';
import { CenteredDialog } from '../../components/CenteredDialog';
import { LiftVariationPicker } from '../../components/LiftVariationPicker';
import { compileVariation, defaultModifiers } from '../../services/liftVariation';
import { ExercisePicker } from '../grid/ExercisePicker';
import { SetGrid } from '../grid/SetGrid';
import type { GridCommit, GridRole } from '../grid/gridTypes';

export function SessionInspector({
  workout,
  role,
  locked,
  lockMessage,
  gridFocus,
  conflicts,
  onClose,
  onNotes,
  onStatus,
  onCommit,
  onAddSet,
  onPattern,
  onMoveExercise,
  onRemoveExercise,
  onUpdateMeta,
  onSaved,
  onDeleted,
  onReload,
}: {
  workout: WorkoutData;
  role: GridRole;
  locked: boolean;
  lockMessage?: string;
  overlay?: boolean;
  width?: number;
  gridFocus?: boolean;
  focusNotes?: boolean;
  conflicts?: Array<{ field: string; server: string; client: string }>;
  onWidth?: (width: number) => void;
  onClose: () => void;
  onNotes: (notes: string) => void;
  onStatus: (status: WorkoutStatus) => void;
  onCommit: (commits: GridCommit[]) => void;
  onAddSet: (exerciseId: string) => void;
  onPattern: (exerciseId: string, value: MovementPattern) => void;
  onMoveExercise: (exerciseId: string, move: 'up' | 'down') => void;
  onRemoveExercise: (exerciseId: string) => void;
  onUpdateMeta: (exerciseId: string, patch: { variation?: string; tier?: 'Comp' | 'Variation' | 'Accessory'; movementPattern?: string }) => void;
  onSaved: () => void;
  onDeleted: () => void;
  onReload: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editLiftId, setEditLiftId] = useState<string | null>(null);
  const [notes, setNotes] = useState(workout.notes || '');
  const summary = workout.summary;
  const editLift = workout.exercises.find((ex) => ex.id === editLiftId);

  useEffect(() => {
    setNotes(workout.notes || '');
  }, [workout.notes, workout.id]);

  useEffect(() => {
    if (!gridFocus) return;
    document.querySelector<HTMLElement>('[data-testid="set-grid"]')?.focus();
  }, [gridFocus, workout.id]);

  return (
    <section
      data-testid="session-inspector"
      aria-label="Session editor"
      className="flex-1 flex flex-col bg-canvas h-full w-full min-w-0"
    >
      <div className="flex items-center justify-between gap-2 px-2 h-8 border-b border-border shrink-0">
        <button type="button" onClick={onClose} className="text-caption text-fg-muted hover:text-fg-strong">
          Back
        </button>
        <h2 data-testid="session-name" className="text-ui text-fg-strong truncate">{workout.title}</h2>
        <p data-testid="workout-tonnage" className="text-mini font-mono text-fg-muted shrink-0">{workout.tonnage}kg</p>
      </div>
      <div className="px-2 py-2 flex flex-wrap items-center gap-2 border-b border-border">
        <p data-testid="session-labels" className="text-mini text-fg-muted">
          {[workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ') || 'No block/week'}
        </p>
        <span className="text-mini font-mono text-fg-subtle">{workout.date} · {workout.status}</span>
        <button type="button" data-testid="session-edit" onClick={() => setEditOpen(true)} className="h-7 px-2 text-mini text-fg-muted hover:text-fg-strong">
          Edit
        </button>
        <button
          type="button"
          data-testid="session-complete"
          onClick={(event) => {
            event.preventDefault();
            onStatus('COMPLETED');
          }}
          className="h-7 px-2 text-mini bg-ok text-canvas rounded ml-auto"
        >
          Complete
        </button>
      </div>
      {locked ? <div className="px-2 pt-2"><WorkoutLockBanner message={lockMessage} /></div> : null}
      {conflicts?.map((conflict) => (
        <p key={conflict.field} className="px-2 py-1 text-caption text-error" data-testid="inspector-conflict">
          Lost edit on {conflict.field}: kept {conflict.server} (yours was {conflict.client})
        </p>
      ))}
      <div className="px-2 py-2 grid grid-cols-4 gap-2 text-mini font-mono border-b border-border">
        <div><span className="block text-micro text-fg-subtle uppercase">Tonnage</span>{summary?.tonnage ?? workout.tonnage}</div>
        <div><span className="block text-micro text-fg-subtle uppercase">Sets</span>{summary?.setCount ?? '—'}</div>
        <div><span className="block text-micro text-fg-subtle uppercase">INOL</span>{summary?.inol ?? '—'}</div>
        <div><span className="block text-micro text-fg-subtle uppercase">Avg int</span>{summary?.avgIntensity ?? '—'}</div>
      </div>
      <div className="flex-1 overflow-auto flex flex-col min-h-0">
          <SetGrid
            key={workout.id}
            workout={workout}
          role={role}
          locked={locked}
          onCommit={onCommit}
          onAddSet={onAddSet}
          onPattern={onPattern}
          onEditExercise={(id) => setEditLiftId(id)}
          onMoveExercise={onMoveExercise}
          onRemoveExercise={onRemoveExercise}
        />
        {!locked ? <ExercisePicker sessionId={workout.id} onAdded={onReload} /> : null}
      </div>
      <label className="px-2 py-2 border-t border-border flex flex-col gap-1 shrink-0">
        <span className="text-micro uppercase tracking-wider text-fg-subtle">Notes</span>
        <textarea
          data-testid="session-notes"
          value={notes}
          disabled={locked}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => onNotes(notes)}
          className="min-h-16 bg-canvas border border-border rounded p-1 text-caption text-fg resize-y"
        />
      </label>
      {editOpen ? (
        <EditSessionDialog
          session={workout}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            await onSaved();
            setEditOpen(false);
          }}
          onDeleted={async () => {
            await onDeleted();
            setEditOpen(false);
          }}
        />
      ) : null}
      {editLift ? (
        <CenteredDialog
          title={`Edit ${editLift.title}`}
          onClose={() => setEditLiftId(null)}
          testId="edit-lift-dialog"
          footer={(
            <button type="button" data-testid="edit-lift-done" onClick={() => setEditLiftId(null)} className="h-8 px-3 text-caption text-fg-strong bg-accent rounded">
              Done
            </button>
          )}
        >
          <LiftVariationPicker
            title={editLift.title}
            variation={editLift.variation || compileVariation(editLift.title, defaultModifiers(editLift.liftCategory || 'Other'))}
            liftCategory={editLift.liftCategory || 'Other'}
            onChange={(patch) => onUpdateMeta(editLift.id, patch)}
          />
        </CenteredDialog>
      ) : null}
    </section>
  );
}

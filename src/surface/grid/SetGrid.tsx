import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import type { MovementPattern } from '../../services/exerciseCatalog';
import type { WorkoutData } from '../../types';
import { rowsFromWorkout } from './buildRows';
import { ExerciseHeaderRow } from './ExerciseHeaderRow';
import { GridCell } from './GridCell';
import { cellKind, gridReducer, initialGridState, tsvFromClipboard } from './gridReducer';
import {
  visibleCols,
  type GridColKey,
  type GridCommit,
  type GridRole,
  type SetValues,
} from './gridTypes';

const COL_LABEL: Record<GridColKey, string> = {
  exercise: 'Exercise',
  set: 'Set',
  plannedWeight: 'Planned load',
  plannedReps: 'Planned reps',
  plannedRpe: 'Planned RPE',
  plannedPct: 'Planned % of e1RM',
  actual: 'Actual load',
  reps: 'Actual reps',
  executedRpe: 'Actual RPE',
  e1rm: 'e1RM',
  note: 'Notes',
};

function testIdFor(col: GridColKey, exerciseId: string, _setId: string): string {
  if (col === 'plannedWeight') return 'rx-weight';
  if (col === 'actual') return `${exerciseId}-actual-weight`;
  if (col === 'reps') return `${exerciseId}-reps`;
  if (col === 'executedRpe') return `${exerciseId}-executedRpe`;
  if (col === 'e1rm') return `set-e1rm-${_setId}`;
  return `grid-${col}-${_setId}`;
}

function rawValue(values: SetValues, col: GridColKey): string {
  if (col === 'note') return values.note;
  if (col === 'e1rm') {
    const n = values.e1rmServer ?? values.e1rmPreview;
    return n == null ? '' : String(n);
  }
  if (col === 'plannedPct') return values.plannedPct == null ? '' : String(values.plannedPct);
  const map: Record<string, number | null> = {
    plannedWeight: values.plannedWeight,
    plannedReps: values.plannedReps,
    plannedRpe: values.plannedRpe,
    actual: values.actual,
    reps: values.reps,
    executedRpe: values.executedRpe,
  };
  const n = map[col];
  return n == null ? '' : String(n);
}

function createGridState(input: { rows: ReturnType<typeof rowsFromWorkout>; role: GridRole; locked: boolean }) {
  return gridReducer(initialGridState(), { type: 'hydrate', rows: input.rows, role: input.role, locked: input.locked });
}

export function SetGrid({
  workout,
  role,
  locked,
  liveMessage,
  onCommit,
  onAddSet,
  onPattern,
  onEditExercise,
  onMoveExercise,
  onRemoveExercise,
  onAnnounce,
}: {
  workout: WorkoutData;
  role: GridRole;
  locked: boolean;
  liveMessage?: string;
  onCommit: (commits: GridCommit[]) => void;
  onAddSet: (exerciseId: string) => void;
  onPattern: (exerciseId: string, value: MovementPattern) => void;
  onEditExercise: (exerciseId: string) => void;
  onMoveExercise: (exerciseId: string, move: 'up' | 'down') => void;
  onRemoveExercise: (exerciseId: string) => void;
  onAnnounce?: (message: string) => void;
}) {
  const liveRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => rowsFromWorkout(workout), [workout]);
  const [state, dispatch] = useReducer(gridReducer, { rows, role, locked }, createGridState);
  const cols = visibleCols(state.hiddenCols);
  const exerciseIds = workout.exercises.map((ex) => ex.id);

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onAnnounceRef = useRef(onAnnounce);
  onAnnounceRef.current = onAnnounce;

  useEffect(() => {
    dispatch({ type: 'hydrate', rows, role, locked });
  }, [workout.id, role, locked]);

  useEffect(() => {
    dispatch({ type: 'syncRows', rows });
  }, [rows]);

  useEffect(() => {
    if (!state.committed?.length) return;
    const commits = state.committed;
    dispatch({ type: 'clearCommitted' });
    onCommitRef.current(commits);
    onAnnounceRef.current?.(commits.length === 1 ? 'Cell saved' : `${commits.length} cells saved`);
  }, [state.committed]);

  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (state.editing) return;
    const key = event.key;
    if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      const row = state.rows[state.selection.focus.row];
      const exerciseId = row ? row.exerciseId : null;
      if (exerciseId) onMoveExercise(exerciseId, key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (key === 'ArrowUp') { event.preventDefault(); dispatch({ type: 'move', dir: 'up', extend: event.shiftKey }); }
    else if (key === 'ArrowDown') { event.preventDefault(); dispatch({ type: 'move', dir: 'down', extend: event.shiftKey }); }
    else if (key === 'ArrowLeft') { event.preventDefault(); dispatch({ type: 'move', dir: 'left', extend: event.shiftKey }); }
    else if (key === 'ArrowRight') { event.preventDefault(); dispatch({ type: 'move', dir: 'right', extend: event.shiftKey }); }
    else if (key === 'Enter') { event.preventDefault(); dispatch({ type: 'startEdit' }); }
    else if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); dispatch({ type: 'delete' }); }
    else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'd') { event.preventDefault(); dispatch({ type: 'fillDown' }); }
    else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'c') {
      event.preventDefault();
      dispatch({ type: 'copy' });
      const text = tsvFromClipboard(state.clipboard);
      if (text) void navigator.clipboard?.writeText(text);
    } else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'v') {
      event.preventDefault();
      void navigator.clipboard?.readText().then((text) => dispatch({ type: 'paste', text }));
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      dispatch({ type: 'typeStart', char: key });
    }
  };

  const editKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'cancel' }); }
    else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); dispatch({ type: 'commit', move: 'up' }); }
    else if (event.key === 'Enter') { event.preventDefault(); dispatch({ type: 'commit', move: 'down' }); }
    else if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); dispatch({ type: 'commit', move: 'left' }); }
    else if (event.key === 'Tab') { event.preventDefault(); dispatch({ type: 'commit', move: 'right' }); }
  };

  return (
    <div
      data-testid="set-grid"
      tabIndex={0}
      onKeyDown={onGridKey}
      className="overflow-auto border border-border rounded bg-cell"
    >
      <div ref={liveRef} className="sr-only" aria-live="polite" data-testid="grid-live">
        {liveMessage || state.invalid?.reason || ''}
      </div>
      {workout.exercises.length === 0 ? (
        <p className="px-2 py-6 text-caption text-fg-muted" data-testid="session-empty-lifts">
          No lifts yet. Add squat, bench, or deadlift.
        </p>
      ) : (
        <table role="grid" aria-label="Set grid" className="min-w-full border-collapse">
          <thead>
            <tr>
              {cols.map((col, index) => (
                <th
                  key={col}
                  role="columnheader"
                  aria-colindex={index + 1}
                  className={`h-[var(--header-height)] px-1 text-left text-micro uppercase tracking-wider text-fg-subtle sticky top-0 bg-card ${col === 'exercise' || col === 'set' ? 'shadow-[var(--sticky-shadow)]' : ''}`}
                >
                  {COL_LABEL[col]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, rowIndex) => {
              if (row.kind === 'header') {
                const idx = exerciseIds.indexOf(row.exerciseId);
                return (
                  <ExerciseHeaderRow
                    key={`h-${row.exerciseId}`}
                    exerciseId={row.exerciseId}
                    title={row.title}
                    variation={row.variation}
                    movementPattern={row.movementPattern}
                    colSpan={cols.length}
                    locked={locked}
                    canMoveUp={idx > 0}
                    canMoveDown={idx >= 0 && idx < exerciseIds.length - 1}
                    onPattern={(value) => onPattern(row.exerciseId, value)}
                    onEdit={() => onEditExercise(row.exerciseId)}
                    onAddSet={() => onAddSet(row.exerciseId)}
                    onMoveUp={idx > 0 ? () => onMoveExercise(row.exerciseId, 'up') : undefined}
                    onMoveDown={idx >= 0 && idx < exerciseIds.length - 1 ? () => onMoveExercise(row.exerciseId, 'down') : undefined}
                    onRemove={() => onRemoveExercise(row.exerciseId)}
                  />
                );
              }
              return (
                <tr key={row.setId} className="border-b border-border">
                  {cols.map((col, colIndex) => {
                    const pos = { row: rowIndex, col: colIndex };
                    const kind = cellKind(state, pos, row.setId, col);
                    const isE1rmPreview = col === 'e1rm' && row.values.e1rmServer == null && row.values.e1rmPreview != null;
                    let display = rawValue(row.values, col);
                    if (col === 'exercise') display = row.exerciseTitle || '';
                    if (col === 'set') display = String(row.setIndex + 1);
                    const editing = state.editing && state.editing.pos.row === rowIndex && state.editing.pos.col === colIndex;
                    return (
                      <GridCell
                        key={`${row.setId}-${col}`}
                        kind={kind}
                        value={display}
                        col={col}
                        testId={testIdFor(col, row.exerciseId, row.setId)}
                        ariaCol={colIndex + 1}
                        ariaRow={rowIndex + 2}
                        pending={Boolean(state.pending[`${row.setId}:${col}`])}
                        preview={isE1rmPreview}
                        invalidReason={kind === 'invalid' ? state.invalid?.reason : undefined}
                        suggested={col === 'plannedWeight' ? row.values.suggestedWeight : null}
                        onSuggested={() => {
                          if (row.values.suggestedWeight == null) return;
                          onCommit([{
                            exerciseId: row.exerciseId,
                            setId: row.setId,
                            field: 'plannedWeight',
                            value: row.values.suggestedWeight,
                          }]);
                        }}
                        onMouseDown={(event) => {
                          dispatch({ type: 'select', pos, extend: event.shiftKey });
                          if (!event.shiftKey) dispatch({ type: 'startEdit' });
                        }}
                        onDoubleClick={() => {
                          dispatch({ type: 'select', pos, extend: false });
                          dispatch({ type: 'startEdit' });
                        }}
                        editingBuffer={editing ? state.editing?.buffer : undefined}
                        onBuffer={(buffer) => dispatch({ type: 'editBuffer', buffer })}
                        onKeyDown={editKey}
                        onBlur={() => dispatch({ type: 'commit' })}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

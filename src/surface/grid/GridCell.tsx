import type { KeyboardEvent, MouseEvent } from 'react';
import type { CellKind, GridColKey } from './gridTypes';
import { isEditableCol } from './gridTypes';
import { displayValue } from './gridValidation';

const COL_MIN: Record<GridColKey, string> = {
  exercise: 'var(--col-exercise-min)',
  set: 'var(--col-set-min)',
  plannedWeight: 'var(--col-num-min)',
  plannedReps: 'var(--col-num-min)',
  plannedRpe: 'var(--col-num-min)',
  plannedPct: 'var(--col-num-min)',
  actual: 'var(--col-num-min)',
  reps: 'var(--col-num-min)',
  executedRpe: 'var(--col-num-min)',
  e1rm: 'var(--col-num-min)',
  note: 'var(--col-notes-min)',
};

export function GridCell({
  kind,
  value,
  col,
  testId,
  ariaCol,
  ariaRow,
  pending,
  preview,
  invalidReason,
  suggested,
  onSuggested,
  onMouseDown,
  onDoubleClick,
  editingBuffer,
  onBuffer,
  onKeyDown,
  onBlur,
}: {
  kind: CellKind;
  value: string;
  col: GridColKey;
  testId: string;
  ariaCol: number;
  ariaRow: number;
  pending?: boolean;
  preview?: boolean;
  invalidReason?: string;
  suggested?: number | null;
  onSuggested?: () => void;
  onMouseDown: (event: MouseEvent) => void;
  onDoubleClick: () => void;
  editingBuffer?: string;
  onBuffer?: (next: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  key?: string;
}) {
  const numeric = col !== 'exercise' && col !== 'note';
  const editable = isEditableCol(col);
  const locked = kind === 'locked';
  const editing = kind === 'editing' || kind === 'invalid';
  const stateClass =
    kind === 'editing' ? 'bg-cell-editing ring-1 ring-accent'
      : kind === 'selected' ? 'bg-cell-selected'
        : kind === 'invalid' ? 'bg-cell-editing ring-1 ring-error'
          : kind === 'locked' ? 'opacity-60'
            : 'hover:bg-cell-hover';
  const shown = displayValue(value) || '—';
  const inputValue = editing ? (editingBuffer ?? '') : (value || '');
  const sticky = col === 'exercise' || col === 'set';

  return (
    <td
      role="gridcell"
      aria-colindex={ariaCol}
      aria-rowindex={ariaRow}
      aria-readonly={!editable || locked}
      data-kind={kind}
      data-pending={pending ? 'true' : 'false'}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{ minWidth: COL_MIN[col] }}
      className={`h-[var(--row-height)] px-1 border-b border-border ${stateClass} ${
        sticky ? 'sticky bg-cell shadow-[var(--sticky-shadow)]' : ''
      } ${col === 'exercise' ? 'left-0' : ''} ${col === 'set' ? 'left-[var(--col-exercise-min)]' : ''} ${
        pending ? 'text-syncing' : 'text-fg'
      }`}
    >
      {editable ? (
        <>
          <input
            data-testid={testId}
            aria-invalid={Boolean(invalidReason)}
            aria-label={invalidReason || undefined}
            readOnly={locked}
            autoComplete="off"
            inputMode={numeric ? 'decimal' : 'text'}
            placeholder="—"
            value={inputValue}
            onChange={(event) => onBuffer?.(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            onMouseDown={(event) => {
              event.stopPropagation();
              onMouseDown(event);
            }}
            className={`w-full h-6 bg-transparent text-caption outline-none ${numeric ? 'font-mono tabular-nums' : ''} text-fg-strong`}
          />
          {invalidReason ? <span className="block text-micro text-error">{invalidReason}</span> : null}
          {suggested != null && !value ? (
            <button
              type="button"
              data-testid="plan-suggest"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={onSuggested}
              className="ml-1 text-micro text-fg-muted hover:text-fg-strong"
            >
              use {suggested}
            </button>
          ) : null}
        </>
      ) : (
        <span data-testid={testId} className={`text-caption ${numeric ? 'font-mono tabular-nums' : ''} ${preview ? 'italic text-stale' : ''}`}>
          {shown}
          {preview ? <span className="ml-1 text-micro text-stale">preview</span> : null}
        </span>
      )}
    </td>
  );
}

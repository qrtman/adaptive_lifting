import type { KeyboardEvent, MouseEvent } from 'react';
import type { CellKind, GridColKey } from './gridTypes';
import { displayValue } from './gridValidation';

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
  const stateClass =
    kind === 'editing' ? 'bg-cell-editing ring-1 ring-accent'
      : kind === 'selected' ? 'bg-cell-selected'
        : kind === 'invalid' ? 'bg-cell-editing ring-1 ring-error'
          : kind === 'locked' ? 'opacity-60'
            : 'hover:bg-cell-hover';
  const shown = displayValue(value) || '—';

  if (kind === 'editing') {
    return (
      <td
        role="gridcell"
        aria-colindex={ariaCol}
        className={`h-[var(--row-height)] px-1 border-b border-border ${stateClass}`}
      >
        <input
          autoFocus
          data-testid={testId}
          aria-invalid={Boolean(invalidReason)}
          aria-label={invalidReason}
          value={editingBuffer ?? ''}
          onChange={(event) => onBuffer?.(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={`w-full h-6 bg-transparent text-caption ${numeric ? 'font-mono tabular-nums' : ''} text-fg-strong outline-none`}
        />
        {invalidReason ? <span className="block text-micro text-error">{invalidReason}</span> : null}
      </td>
    );
  }

  return (
    <td
      role="gridcell"
      aria-colindex={ariaCol}
      aria-rowindex={ariaRow}
      data-testid={testId}
      tabIndex={kind === 'selected' ? 0 : -1}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={`h-[var(--row-height)] px-1 border-b border-border text-caption ${numeric ? 'font-mono tabular-nums' : ''} ${stateClass} ${pending ? 'text-syncing' : 'text-fg'}`}
    >
      <span className={preview ? 'italic text-stale' : ''}>{shown}</span>
      {preview ? <span className="ml-1 text-micro text-stale">preview</span> : null}
      {suggested != null && !value ? (
        <button type="button" data-testid="plan-suggest" onClick={onSuggested} className="ml-1 text-micro text-fg-muted hover:text-fg-strong">
          use {suggested}
        </button>
      ) : null}
    </td>
  );
}

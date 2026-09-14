import { MovementPatternSelect } from './MovementPatternSelect';
import type { MovementPattern } from '../../services/exerciseCatalog';

export function ExerciseHeaderRow({
  exerciseId,
  title,
  variation,
  movementPattern,
  colSpan,
  locked,
  canMoveUp,
  canMoveDown,
  onPattern,
  onEdit,
  onAddSet,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  exerciseId: string;
  title: string;
  variation: string;
  movementPattern: string;
  colSpan: number;
  locked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPattern: (value: MovementPattern) => void;
  onEdit: () => void;
  onAddSet: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  key?: string;
}) {
  return (
    <tr className="border-b border-border bg-card" data-testid={`exercise-header-${exerciseId}`}>
      <td colSpan={colSpan} className="px-2 py-1">
        <div className="flex flex-wrap items-center gap-2 min-h-[var(--header-height)]">
          <h4 className="text-title text-fg-strong truncate">{title}</h4>
          <span className="text-caption text-fg-muted truncate">{variation}</span>
          <MovementPatternSelect
            id={exerciseId}
            value={movementPattern}
            locked={locked}
            onChange={onPattern}
          />
          <button type="button" data-testid={`edit-lift-${exerciseId}`} onClick={onEdit} className="h-6 px-1.5 text-caption text-fg-muted hover:text-fg-strong">
            Edit
          </button>
          {!locked ? (
            <button type="button" onClick={onAddSet} className="h-6 px-1.5 text-caption text-fg-muted hover:text-fg-strong">
              + Set
            </button>
          ) : null}
          {canMoveUp ? (
            <button type="button" data-testid={`move-lift-up-${exerciseId}`} disabled={locked} onClick={onMoveUp} className="h-6 px-1.5 text-caption text-fg-muted hover:text-fg-strong disabled:opacity-40">
              Up
            </button>
          ) : null}
          {canMoveDown ? (
            <button type="button" data-testid={`move-lift-down-${exerciseId}`} disabled={locked} onClick={onMoveDown} className="h-6 px-1.5 text-caption text-fg-muted hover:text-fg-strong disabled:opacity-40">
              Down
            </button>
          ) : null}
          {onRemove ? (
            <button type="button" data-testid={`remove-lift-${exerciseId}`} disabled={locked} onClick={onRemove} className="h-6 px-1.5 text-caption text-fg-muted hover:text-error disabled:opacity-40">
              Remove
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

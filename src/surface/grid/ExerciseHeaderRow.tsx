import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { MovementPatternSelect } from './MovementPatternSelect';
import type { MovementPattern } from '../../services/exerciseCatalog';

const ICON = 'h-6 w-6 flex items-center justify-center text-fg-muted hover:text-fg-strong disabled:opacity-40';

export function ExerciseHeaderRow({
  exerciseId,
  title,
  variation,
  movementPattern,
  colSpan,
  locked,
  canMoveUp,
  canMoveDown,
  collapsed,
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
  collapsed?: boolean;
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
        <div className="flex items-center gap-1 min-h-[var(--header-height)] flex-nowrap">
          <h3 className="text-title text-fg-strong truncate min-w-0">{title}</h3>
          <span className="text-caption text-fg-muted truncate min-w-0 max-w-[7rem]">{variation}</span>
          <MovementPatternSelect
            id={exerciseId}
            value={movementPattern}
            locked={locked}
            collapsed={collapsed}
            onChange={onPattern}
          />
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <button type="button" data-testid={`edit-lift-${exerciseId}`} aria-label="Edit" onClick={onEdit} className={ICON}>
              <Pencil size={14} />
            </button>
            {!locked ? (
              <button type="button" data-testid={`add-set-${exerciseId}`} aria-label="+ Set" onClick={onAddSet} className={ICON}>
                <Plus size={14} />
              </button>
            ) : null}
            {canMoveUp ? (
              <button type="button" data-testid={`move-lift-up-${exerciseId}`} aria-label="Up" disabled={locked} onClick={onMoveUp} className={ICON}>
                <ChevronUp size={14} />
              </button>
            ) : null}
            {canMoveDown ? (
              <button type="button" data-testid={`move-lift-down-${exerciseId}`} aria-label="Down" disabled={locked} onClick={onMoveDown} className={ICON}>
                <ChevronDown size={14} />
              </button>
            ) : null}
            {onRemove ? (
              <button type="button" data-testid={`remove-lift-${exerciseId}`} aria-label="Remove" disabled={locked} onClick={onRemove} className={`${ICON} hover:text-error`}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}

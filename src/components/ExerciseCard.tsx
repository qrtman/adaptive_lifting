import { useState, useEffect } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, GripVertical, Trash2, Copy, Plus } from 'lucide-react';
import type { DragControls } from 'motion/react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor } from './PrescriptionEditor';
import { LiftVariationPicker } from './LiftVariationPicker';
import { CenteredDialog, NestedCard } from './CenteredDialog';
import { 
  calculateE1RM, 
  calculateINOL,
} from '../services/mathEngine';
import { displayTrainingValue, trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from '../services/numericTraining';
import {
  addressFrom,
  colOf,
  makeCellId,
  neighbor,
  GRID_COL_COUNT,
  type CellMode,
  type MoveKind,
  type NeighborDir,
  type SetGridBind,
} from '../services/sheetsCellKeyboard';
import {
  applySetDropPercent,
  parseDropPercent,
  planKgOfferKg,
  refreshSetAnchors,
} from '../services/setPrescription';
import type { LiftMetaPatch } from '../types';
import type { MovementPattern } from '../services/exerciseCatalog';
import { compileVariation, defaultModifiers, parseModifiers } from '../services/liftVariation';
import { catalogExercise, LiftCatalogChoice } from './LiftCatalogChoice';

function formatE1rmDeltaPct(planE1rm: number, logE1rm: number): string {
  if (!(planE1rm > 0) || !(logE1rm > 0)) return '—';
  const pct = Math.round(((logE1rm - planE1rm) / planE1rm) * 100);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `${pct}%`;
  return '0%';
}

export const ExerciseCard = ({ 
  id,
  title, 
  variation, 
  tags: _tags, 
  tier,
  liftCategory = 'Other',
  movementPattern,
  liftNote,
  initialSets,
  onUpdateSets,
  onUpdateMeta,
  onRemove,
  onMoveUp,
  onMoveDown,
  dragControls,
  locked = false,
  roleMode: _roleMode = 'coach',
  initialMinimized = true
}: { 
  id: string,
  title: string, 
  variation: string, 
  tags: string[], 
  tier?: 'Comp' | 'Variation' | 'Accessory',
  liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other',
  movementPattern?: MovementPattern,
  liftNote?: string | null,
  initialSets: any[],
  onUpdateSets: (sets: any[]) => void,
  onUpdateMeta?: (patch: LiftMetaPatch) => void | Promise<void>,
  onRemove?: () => void | Promise<void>,
  onMoveUp?: () => void | Promise<void>,
  onMoveDown?: () => void | Promise<void>,
  dragControls?: DragControls,
  locked?: boolean,
  roleMode?: 'coach' | 'athlete',
  initialMinimized?: boolean,
  key?: string,
}) => {
  const recalculatePresetsAndSugs = (setArray: any[]) => refreshSetAnchors(setArray);

  const mapInitialSets = (setsList: any[]) => {
    const mapped = setsList.map((s) => {
      const plannedReps = trainingInt(s.plannedReps);
      const plannedRpe = trainingNumber(s.plannedRpe ?? s.rpe);
      const plannedWeight = trainingNumber(s.plannedWeight);

      const intensity_type = s.intensity_type || s.intensityType || "RPE";
      const target_value = s.target_value !== undefined 
        ? s.target_value 
        : plannedRpe;

      return {
        ...s,
        id: s.id,
        plannedWeight,
        scope: s.scope === 'plan' || s.scope === 'log' ? s.scope : 'both',
        plannedReps,
        plannedRpe: intensity_type === "RPE" ? (target_value ?? plannedRpe) : plannedRpe,
        intensity_type,
        target_value,
        dropPercent: trainingInt(s.dropPercent) ?? 0,
        isAuto: false,
        actual: trainingNumber(s.actual),
        reps: trainingInt(s.reps),
        executedRpe: trainingNumber(s.executedRpe)
      };
    });
    
    return recalculatePresetsAndSugs(mapped);
  };

  const [sets, setSets] = useState(() => mapInitialSets(initialSets));
  const [removing, setRemoving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editVariation, setEditVariation] = useState(variation);
  const [editTier, setEditTier] = useState<'Comp' | 'Variation' | 'Accessory'>(tier ?? 'Accessory');
  const [editLiftCategory, setEditLiftCategory] = useState(liftCategory);
  const [editMovementPattern, setEditMovementPattern] = useState<MovementPattern>(movementPattern ?? 'Misc');
  const [editCategory, setEditCategory] = useState<'User Defined' | ''>('');
  const [editSearch, setEditSearch] = useState('');
  const [editExerciseName, setEditExerciseName] = useState('');
  const [editCustomName, setEditCustomName] = useState('');
  const [noteDraft, setNoteDraft] = useState(liftNote ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteStatus, setNoteStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [minimized, setMinimized] = useState(initialMinimized);
  const [grid, setGrid] = useState<{
    row: number;
    col: number;
    mode: CellMode;
    overwrite: boolean;
    seed?: string;
  } | null>(null);

  useEffect(() => {
    if (!editOpen) return;
    const catalog = catalogExercise(title);
    setEditTitle(title);
    setEditVariation(variation);
    setEditTier(tier ?? 'Accessory');
    setEditLiftCategory(liftCategory);
    setEditMovementPattern(movementPattern ?? 'Misc');
    setEditCategory(catalog ? '' : 'User Defined');
    setEditExerciseName(catalog?.name ?? '');
    setEditCustomName(catalog ? '' : title);
    setEditSearch('');
  }, [editOpen, title, variation, tier, liftCategory, movementPattern]);

  useEffect(() => {
    setNoteDraft(liftNote ?? '');
  }, [liftNote]);

  const saveLiftNote = async () => {
    if (!onUpdateMeta || locked || noteSaving) return;
    setNoteSaving(true);
    setNoteStatus('idle');
    try {
      await onUpdateMeta({ liftNote: noteDraft.trim() });
      setNoteStatus('saved');
    } catch {
      setNoteStatus('error');
    } finally {
      setNoteSaving(false);
    }
  };

  useEffect(() => {
    if (!grid) return;
    if (grid.row >= sets.length) setGrid(null);
  }, [sets.length, grid]);

  // Keep state in sync when workout changes
  useEffect(() => {
    setSets(mapInitialSets(initialSets));
  }, [initialSets]);

  const updateAndPropagate = (newSets: any[]) => {
    const recalculated = recalculatePresetsAndSugs(newSets);
    setSets(recalculated);
    onUpdateSets(recalculated);
  };

  const updateSet = (index: number, updates: any) => {
    const newSets = [...sets];
    newSets[index] = { ...newSets[index], ...updates };
    updateAndPropagate(newSets);
  };

  const duplicateSet = (index: number, target: 'plan' | 'log') => {
    const set = sets[index];
    const newSets = [...sets];
    newSets.splice(index + 1, 0, {
      ...set,
      id: `s-${Math.random().toString(36).slice(2, 12)}`,
      scope: target,
      isTop: false,
      ...(target === 'plan' ? {
        actual: null,
        reps: null,
        executedRpe: null,
      } : {
        plannedWeight: null,
        plannedReps: null,
        plannedRpe: null,
        target_value: null,
        suggestedWeight: null,
        dropPercent: 0,
      }),
      dropPercent: 0,
      isAuto: false,
    });
    updateAndPropagate(newSets);
  };

  const deleteSet = (index: number, target: 'plan' | 'log') => {
    const set = sets[index];
    if (set.scope === 'both') {
      updateSet(index, target === 'plan'
        ? { scope: 'log', plannedWeight: null, plannedReps: null, plannedRpe: null, target_value: null, dropPercent: 0 }
        : { scope: 'plan', actual: null, reps: null, executedRpe: null });
      return;
    }
    updateAndPropagate(sets.filter((_, i) => i !== index));
  };

  const syncTarget = (index: number) => {
    if (locked) return;
    const set = sets[index];
    const kg = trainingNumber(set.plannedWeight);
    updateSet(index, {
      scope: 'both',
      actual: kg,
      reps: trainingInt(set.plannedReps),
      executedRpe: set.intensity_type === 'PERCENT' ? null : trainingNumber(set.plannedRpe),
      isAuto: false
    });
  };

  const totalVolume = sets.reduce((acc, s) => acc + (trainingOrZero(s.actual) * trainingIntOrZero(s.reps)), 0);
  const plannedCount = sets.filter((set) => set.scope !== 'log').length;
  const loggedCount = sets.filter((set) => set.scope !== 'plan' && trainingNumber(set.actual) != null).length;

  const addSet = (target: 'plan' | 'log') => {
    const nextRow = sets.filter((set) => target === 'plan' ? set.scope !== 'log' : set.scope !== 'plan').length;
    updateAndPropagate([...sets, {
      id: `s-${Math.random().toString(36).slice(2, 12)}`,
      label: `Set ${sets.length + 1}`,
      scope: target,
      plannedWeight: null,
      plannedReps: null,
      plannedRpe: null,
      intensity_type: 'RPE',
      target_value: null,
      dropPercent: 0,
      isTop: false,
      isAuto: false,
      actual: null,
      reps: null,
      executedRpe: null
    }]);
    setGrid({
      row: nextRow,
      col: target === 'plan' ? (nextRow === 0 ? 1 : 0) : 4,
      mode: 'selected',
      overwrite: false,
    });
  };

  const bindGrid = (row: number, col: number): SetGridBind => ({
    cellId: makeCellId(id, row, col),
    row,
    col,
    isActive: grid?.row === row && grid?.col === col,
    mode: grid?.row === row && grid?.col === col ? grid.mode : 'selected',
    editOverwrite: grid?.overwrite ?? false,
    editSeed: grid?.seed,
    tabStop: (grid == null && row === 0 && col === 1) || (grid?.row === row && grid?.col === col),
    onSelect: (nextRow, nextCol) => {
      setGrid({ row: nextRow, col: nextCol, mode: 'selected', overwrite: false });
    },
    onBeginEdit: (nextRow, nextCol, overwrite, seed) => {
      setGrid({ row: nextRow, col: nextCol, mode: 'editing', overwrite, seed });
    },
    onCommit: (nextRow, nextCol, _value, move, kind) => {
      if (move && kind) {
        if (kind === 'tab' && move === 'right') {
          const next = nextTabCell(nextRow, nextCol);
          if (!next) {
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="add-plan-set-${id}"]`)?.focus());
            setGrid(null);
            return;
          }
          setGrid({ row: next.row, col: next.col, mode: 'selected', overwrite: false });
          return;
        }
        const next = neighbor(addressFrom(id, nextRow, nextCol), move, kind, Math.max(planRows.length, logRows.length));
        setGrid({ row: next.row, col: colOf(next), mode: 'selected', overwrite: false });
        return;
      }
      setGrid({ row: nextRow, col: nextCol, mode: 'selected', overwrite: false });
    },
    onCancel: (nextRow, nextCol) => {
      setGrid({ row: nextRow, col: nextCol, mode: 'selected', overwrite: false });
    },
    onMove: (nextRow, nextCol, direction: NeighborDir, kind: MoveKind) => {
      if (kind === 'tab' && direction === 'right') {
        const next = nextTabCell(nextRow, nextCol);
        if (!next) {
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="add-plan-set-${id}"]`)?.focus());
          setGrid(null);
          return;
        }
        setGrid({ row: next.row, col: next.col, mode: 'selected', overwrite: false });
        return;
      }
      const next = neighbor(addressFrom(id, nextRow, nextCol), direction, kind, Math.max(planRows.length, logRows.length));
      setGrid({ row: next.row, col: colOf(next), mode: 'selected', overwrite: false });
    },
  });

  const td = "px-0.5 py-0.5 align-middle whitespace-nowrap";
  const th = "px-0.5 py-1 text-center text-[10px] font-medium uppercase tracking-wider text-[var(--cal-muted)] whitespace-nowrap";
  const thField = `${th} normal-case tracking-normal`;
  const actionCell = "w-10 px-0 py-0.5 align-middle whitespace-nowrap";
  const actionButton = "inline-flex h-5 w-5 items-center justify-center rounded-[3px] border border-[var(--cal-hairline)] bg-transparent text-[var(--cal-muted)] opacity-65 transition-colors hover:border-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:opacity-30 group-hover:opacity-100";
  const addSetButton = "inline-flex h-7 items-center justify-center gap-1 rounded-[3px] border border-[var(--cal-hairline)] bg-transparent px-2 text-[11px] font-medium text-[var(--cal-muted)] transition-colors hover:border-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]";

  const commitDropPercent = (index: number, pct: number) => {
    if (locked || index <= 0 || sets[index]?.scope === 'log') return;
    updateAndPropagate(applySetDropPercent(sets, index, pct));
  };

  const planRows = sets
    .map((set, index) => ({ set, index }))
    .filter(({ set }) => set.scope !== 'log');
  const logRows = sets
    .map((set, index) => ({ set, index }))
    .filter(({ set }) => set.scope !== 'plan');
  const nextTabCell = (row: number, col: number): { row: number; col: number } | null => {
    const cells: Array<{ row: number; col: number }> = [];
    const rowCount = Math.max(planRows.length, logRows.length);
    for (let nextRow = 0; nextRow < rowCount; nextRow += 1) {
      if (planRows[nextRow]) {
        const firstPlanCol = nextRow === 0 ? 1 : 0;
        for (let nextCol = firstPlanCol; nextCol <= 3; nextCol += 1) cells.push({ row: nextRow, col: nextCol });
      }
      if (logRows[nextRow]) {
        for (let nextCol = 4; nextCol < GRID_COL_COUNT; nextCol += 1) cells.push({ row: nextRow, col: nextCol });
      }
    }
    const index = cells.findIndex((cell) => cell.row === row && cell.col === col);
    return index >= 0 ? cells[index + 1] ?? null : null;
  };

  const selectedPlanEntry = grid?.col === 1
    ? planRows[grid.row]
    : undefined;
  const selectedPlanOffer = selectedPlanEntry
    ? planKgOfferKg(selectedPlanEntry.set.suggestedWeight, selectedPlanEntry.set.plannedWeight)
    : null;
  const selectedPlanNumber = selectedPlanEntry
    ? grid!.row + 1
    : null;

  return (
    <div className="cal-nested-card cal-nested-flush mx-2 mb-2 overflow-hidden">
      <div className="px-2 min-h-8 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 min-w-0">
          {dragControls ? (
            <button
              type="button"
              data-testid={`reorder-lift-${id}`}
              aria-label={`Reorder ${variation}`}
              disabled={locked}
              onPointerDown={(event) => dragControls.start(event)}
              className="inline-flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-[3px] text-[var(--cal-muted)] transition-colors hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
              title="Drag to reorder lift"
            >
              <GripVertical size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`toggle-lift-${id}`}
            aria-expanded={!minimized}
            aria-controls={`lift-grid-${id}`}
            aria-label={`${minimized ? 'Expand' : 'Minimize'} ${variation}`}
            onClick={() => {
              setMinimized((value) => !value);
              setGrid(null);
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[var(--cal-muted)] transition-colors hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
            title={minimized ? 'Expand lift' : 'Minimize lift'}
          >
            {minimized ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </button>
          <h4
            className="text-base leading-6 font-semibold tracking-tight text-[var(--cal-ink)] truncate"
            data-testid={`exercise-title-${id}`}
          >
            {variation}
          </h4>
          {minimized ? (
            <div
              id={`lift-grid-${id}`}
              data-testid={`lift-minimized-${id}`}
              aria-label="Lift summary"
              className="flex min-w-0 items-center gap-2 truncate text-[11px] text-[var(--cal-muted)]"
            >
              <span className="tnum whitespace-nowrap">{plannedCount} plan set{plannedCount === 1 ? '' : 's'}</span>
              <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">·</span>
              <span className="tnum whitespace-nowrap">{loggedCount} logged</span>
              <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">·</span>
              <span className="truncate whitespace-nowrap">{tier ?? 'Lift'}</span>
              <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">·</span>
              <span className="truncate whitespace-nowrap">{movementPattern ?? liftCategory}</span>
            </div>
          ) : null}
          {onUpdateMeta ? (
            <button
              type="button"
              data-testid={`edit-lift-${id}`}
              onClick={() => setEditOpen(true)}
              className="h-6 px-1.5 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] shrink-0"
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted-soft)]">e1RM</span>
            <span className="text-xs tnum text-[var(--cal-muted)]">
              {sets[0]?.baseline_e1rm ? Math.round(sets[0].baseline_e1rm) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted-soft)]">Vol</span>
            <span className="w-24 text-right text-xs tnum text-[var(--cal-muted)]">{totalVolume.toLocaleString()} kg</span>
          </div>
          {onMoveUp && (
            <button
              type="button"
              data-testid={`move-lift-up-${id}`}
              disabled={locked}
              onClick={() => void onMoveUp()}
              className="h-6 px-1.5 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
            >
              Up
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              data-testid={`move-lift-down-${id}`}
              disabled={locked}
              onClick={() => void onMoveDown()}
              className="h-6 px-1.5 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
            >
              Down
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              data-testid={`remove-lift-${id}`}
              disabled={locked || removing}
              onClick={() => {
                if (locked || removing) return;
                if (!window.confirm(`Remove ${title} from this session?`)) return;
                setRemoving(true);
                void Promise.resolve(onRemove()).finally(() => setRemoving(false));
              }}
              className="h-6 px-1.5 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
      {!minimized ? (
      <div className="flex flex-col gap-2 px-2 pb-2 md:flex-row md:items-start">
      {onUpdateMeta ? (
        <section className="w-full shrink-0 md:w-44" data-testid={`lift-note-panel-${id}`}>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted)]">Note</span>
            <textarea
              data-testid={`lift-note-${id}`}
              value={noteDraft}
              disabled={locked || noteSaving}
              onChange={(event) => {
                setNoteDraft(event.target.value);
                setNoteStatus('idle');
              }}
              placeholder="Add a note for this lift"
              rows={5}
              className="h-24 min-h-24 w-full resize-y rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-canvas)] px-2 py-1.5 text-xs leading-5 text-[var(--cal-ink)] placeholder:text-[var(--cal-muted-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:opacity-50"
            />
          </label>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className={`text-[10px] ${noteStatus === 'error' ? 'text-[var(--cal-error)]' : noteStatus === 'saved' ? 'text-[var(--cal-success)]' : 'text-[var(--cal-muted-soft)]'}`} role={noteStatus === 'error' ? 'alert' : undefined}>
              {noteStatus === 'error' ? 'Save failed' : noteStatus === 'saved' ? 'Saved' : ' '}
            </span>
            <button
              type="button"
              data-testid={`save-lift-note-${id}`}
              disabled={locked || noteSaving}
              onClick={() => void saveLiftNote()}
              className="h-6 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)] px-1.5 text-[10px] font-medium text-[var(--cal-ink)] transition-colors hover:bg-[var(--cal-surface-strong)] disabled:opacity-40"
            >
              {noteSaving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </section>
      ) : null}
      <div id={`lift-grid-${id}`} className="min-w-0 flex-1 overflow-x-auto">
      <table role="grid" aria-label="Plan and log sets" data-testid="set-grid" className="text-left border-collapse w-max max-w-full">
        <thead>
          <tr className="border-b border-[var(--cal-hairline-soft)]">
            <th rowSpan={2} className={`${th} w-6 align-bottom`} data-testid="set-grid-h-num">#</th>
            <th colSpan={5} className={`${th} border-l border-[var(--cal-hairline)] bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-plan">
              <div className="relative flex min-h-5 items-center justify-center">
                <span>Plan</span>
                {selectedPlanEntry && selectedPlanOffer != null && selectedPlanNumber != null ? (
                  <span className="absolute right-0 inline-flex items-center gap-1 whitespace-nowrap normal-case tracking-normal text-[10px] font-normal text-[var(--cal-muted)]">
                    <span className="text-[var(--cal-muted-soft)]">S{selectedPlanNumber}</span>
                    <span>{selectedPlanEntry.set.plannedWeight ?? '—'} → <span data-testid="plan-suggestion-value">{selectedPlanOffer}</span> kg</span>
                    <button
                      type="button"
                      data-testid="plan-suggest"
                      onClick={() => updateSet(selectedPlanEntry.index, { plannedWeight: selectedPlanOffer, isAuto: false })}
                      className="h-5 rounded-[3px] border border-[var(--cal-hairline)] bg-transparent px-1.5 text-[10px] font-medium text-[var(--cal-muted)] transition-colors hover:border-[var(--cal-muted)] hover:bg-[var(--cal-surface)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
                    >
                      Use
                    </button>
                  </span>
                ) : null}
              </div>
            </th>
            <th rowSpan={2} className={`${th} w-4`} aria-label="Copy plan to log" data-testid="set-grid-h-copy" />
            <th colSpan={4} className={`${th} border-l border-[var(--cal-hairline)] bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-log">Log</th>
            <th rowSpan={2} className={`${th} border-l border-[var(--cal-hairline)] align-bottom`} data-testid="set-grid-h-e1rm">e1RM</th>
            <th rowSpan={2} className={`${th} align-bottom`} data-testid="set-grid-h-delta">Δ%</th>
            <th rowSpan={2} className={`${th} align-bottom`} data-testid="set-grid-h-inol">INOL</th>
          </tr>
          <tr className="border-b border-[var(--cal-hairline-soft)]">
            <th className={`${thField} w-11 border-l border-[var(--cal-hairline)] bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-pct">Adj %</th>
            <th className={`${thField} bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-planKg">kg</th>
            <th className={`${thField} bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-planReps">reps</th>
            <th className={`${thField} bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-planTarget">Intensity</th>
            <th className={`${thField} w-10 border-r border-[var(--cal-hairline)] bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} aria-label="Plan set actions" data-testid="set-grid-h-plan-actions" />
            <th className={`${thField} border-l border-[var(--cal-hairline)] bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-logKg">kg</th>
            <th className={`${thField} bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-logReps">reps</th>
            <th className={`${thField} bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} data-testid="set-grid-h-logRpe">RPE</th>
            <th className={`${thField} w-10 bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]`} aria-label="Log set actions" data-testid="set-grid-h-log-actions" />
          </tr>
        </thead>
        <tbody>
            {planRows.length === 0 && logRows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-2 py-3 text-xs text-[var(--cal-muted-soft)]">
                  No sets programmed.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(planRows.length, logRows.length) }).map((_, laneIndex) => {
              const planEntry = planRows[laneIndex];
              const logEntry = logRows[laneIndex];
              const planIndex = planEntry?.index ?? 0;
              const logIndex = logEntry?.index ?? 0;
              const planSet = planEntry?.set;
              const logSet = logEntry?.set;
              const set = {
                ...(planSet ?? {}),
                ...(logSet ?? {}),
                plannedWeight: planSet?.plannedWeight ?? logSet?.plannedWeight,
                plannedReps: planSet?.plannedReps ?? logSet?.plannedReps,
                plannedRpe: planSet?.plannedRpe ?? logSet?.plannedRpe,
                target_value: planSet?.target_value ?? logSet?.target_value,
                intensity_type: planSet?.intensity_type ?? logSet?.intensity_type,
                suggestedWeight: planSet?.suggestedWeight ?? logSet?.suggestedWeight,
                dropPercent: planSet?.dropPercent ?? logSet?.dropPercent,
                actual: logSet?.actual ?? planSet?.actual,
                reps: logSet?.reps ?? planSet?.reps,
                executedRpe: logSet?.executedRpe ?? planSet?.executedRpe,
              };
              const weight = trainingOrZero(set.actual);
              const reps = trainingIntOrZero(set.reps);
              const rpe = trainingOrZero(set.executedRpe);
              const e1RM = calculateE1RM(weight, reps, rpe);
              const planE1RM = calculateE1RM(
                trainingOrZero(set.plannedWeight),
                trainingIntOrZero(set.plannedReps),
                trainingOrZero(set.plannedRpe ?? set.target_value),
              );
              const e1rmDelta = formatE1rmDeltaPct(planE1RM, e1RM);
              const intensityPct = e1RM > 0 ? (weight / e1RM) * 100 : 0;
              const inol = e1RM > 0 && reps > 0 ? calculateINOL(reps, intensityPct) : 0;
              
              const rowHighlight = set.isTop
                ? 'bg-[color-mix(in_srgb,var(--cal-accent)_5%,transparent)]'
                : 'hover:bg-[var(--cal-surface-soft)]';

              const hasPlan = Boolean(planEntry);
              const hasLog = Boolean(logEntry);

              return (
                <tr key={`${planEntry?.set.id ?? logEntry?.set.id ?? laneIndex}-${laneIndex}`} className={`group ${rowHighlight}`}>
                  {hasPlan ? (<>
                  <td className={`${td} w-6 tnum text-[10px] text-[var(--cal-muted)]`}>{laneIndex + 1}</td>
                  <td className={`${td} w-11 border-l border-[var(--cal-hairline)] pr-0`}>
                    {laneIndex === 0 ? (
                      <span className="text-[11px] tnum text-[var(--cal-muted-soft)]" aria-hidden="true"> </span>
                    ) : (
                      <DropPercentCell
                        value={trainingInt(set.dropPercent) ?? 0}
                        locked={locked}
                        onCommit={(pct) => commitDropPercent(planIndex, pct)}
                        grid={bindGrid(laneIndex, 0)}
                      />
                    )}
                  </td>
                    {hasPlan ? (!locked ? (
                      <PrescriptionEditor
                            reps={set.plannedReps}
                            intensityType={set.intensity_type || "RPE"}
                            targetValue={set.target_value}
                            weight={set.plannedWeight}
                            rowIndex={planIndex}
                            liftId={id}
                            kgGrid={bindGrid(laneIndex, 1)}
                            repsGrid={bindGrid(laneIndex, 2)}
                            rpeGrid={bindGrid(laneIndex, 3)}
                            tdClass={td}
                            onChange={(updates) => updateSet(planIndex, {
                              plannedReps: updates.reps !== undefined ? updates.reps : set.plannedReps,
                              intensity_type: updates.intensityType !== undefined ? updates.intensityType : set.intensity_type,
                              target_value: updates.targetValue !== undefined ? updates.targetValue : set.target_value,
                              plannedRpe: updates.targetValue !== undefined ? updates.targetValue : set.plannedRpe,
                              plannedWeight: updates.weight !== undefined ? updates.weight : set.plannedWeight
                            })}
                          />
                    ) : (
                      <>
                        <td className={`${td} tnum text-[11px] text-[var(--cal-ink)]`}>{set.plannedWeight != null ? set.plannedWeight : '—'}</td>
                        <td className={`${td} tnum text-[11px]`}>{set.plannedReps ?? '—'}</td>
                        <td className={`${td} tnum text-[11px] pr-3`}>{set.target_value != null ? `${set.target_value}${set.intensity_type === "PERCENT" ? "%" : ""}` : '—'}</td>
                      </>
                    )) : (
                      <>
                        <td colSpan={3} className={`${td} text-[var(--cal-muted-soft)]`} aria-label="No plan set" />
                      </>
                    )}
                  <td className={`${actionCell} border-r border-[var(--cal-hairline)]`}>
                    {hasPlan ? (<>
                    <button
                      type="button"
                      disabled={locked || !hasPlan}
                      onClick={() => duplicateSet(planIndex, 'plan')}
                      className={actionButton}
                      aria-label={`Copy plan set ${laneIndex + 1}`}
                      title="Copy this set"
                    >
                      <Copy size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Copy plan set</span>
                    </button>
                    <button
                      type="button"
                      disabled={locked || !hasPlan}
                      onClick={() => deleteSet(planIndex, 'plan')}
                      className={actionButton}
                      aria-label={`Delete plan set ${laneIndex + 1}`}
                      title="Delete this plan set"
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Delete plan set</span>
                    </button>
                    </>) : null}
                  </td>
                  <td className={`${td} pl-1`}>
                    {hasPlan ? (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => syncTarget(planIndex)}
                      className="h-5 w-4 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
                      title="Copy plan to log"
                    >
                      <ArrowRight size={12} />
                    </button>
                    ) : null}
                  </td>
                  </>) : (
                    <td colSpan={7} className="p-0" aria-label="No plan set" />
                  )}
                  {hasLog ? (<>
                  <td className={`${td} pl-px border-l border-[var(--cal-hairline)]`}>
                    {locked ? (
                      <span className="text-[11px] tnum text-[var(--cal-ink)]">{set.actual ?? '—'}</span>
                    ) : (
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.actual)}
                        onChange={(val) => updateSet(logIndex, { actual: trainingNumber(val), isAuto: !val })}
                        placeholder="—"
                        fieldKey={`${id}-actual-weight`}
                        label="Log Weight"
                        widthClass="w-12"
                        isLogged={true}
                        isAuto={false}
                        suggestedValue={null}
                        step={2.5}
                        rowIndex={logIndex}
                        grid={bindGrid(laneIndex, 4)}
                      />
                    )}
                  </td>
                  <td className={td}>
                    {locked ? (
                      <span className="text-[11px] tnum">{set.reps ?? '—'}</span>
                    ) : (
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.reps)}
                        onChange={(val) => updateSet(logIndex, { reps: trainingInt(val) })}
                        placeholder="—"
                        fieldKey={`${id}-reps`}
                        label="Log Reps"
                        widthClass="w-8"
                        isLogged={true}
                        step={1}
                        rowIndex={logIndex}
                        grid={bindGrid(laneIndex, 5)}
                      />
                    )}
                  </td>
                  <td className={`${td} pr-1`}>
                    {locked ? (
                      <span className="text-[11px] tnum">{set.executedRpe ?? '—'}</span>
                    ) : (
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.executedRpe)}
                        onChange={(val) => updateSet(logIndex, { executedRpe: trainingNumber(val) })}
                        placeholder="—"
                        fieldKey={`${id}-executedRpe`}
                        label="Log RPE"
                        widthClass="w-8"
                        isLogged={true}
                        step={0.5}
                        rowIndex={logIndex}
                        grid={bindGrid(laneIndex, 6)}
                      />
                    )}
                  </td>
                  <td className={actionCell}>
                    <button
                      type="button"
                      disabled={locked || !hasLog}
                      onClick={() => duplicateSet(logIndex, 'log')}
                      className={actionButton}
                      aria-label={`Copy log set ${laneIndex + 1}`}
                      title="Copy this log set"
                    >
                      <Copy size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Copy log set</span>
                    </button>
                    <button
                      type="button"
                      disabled={locked || !hasLog}
                      onClick={() => deleteSet(logIndex, 'log')}
                      className={actionButton}
                      aria-label={`Delete log set ${laneIndex + 1}`}
                      title="Delete this log set"
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Delete log set</span>
                    </button>
                  </td>
                  <td className={`${td} border-l border-[var(--cal-hairline)] tnum text-[11px]`} data-testid={`set-metrics-${set.id}`}>
                    <span data-testid={`set-e1rm-${set.id}`} className={e1RM > 0 ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}>
                      {e1RM > 0 ? Math.round(e1RM) : '—'}
                    </span>
                  </td>
                  <td className={`${td} tnum text-[11px] text-[var(--cal-muted)]`} data-testid={`set-e1rm-delta-${set.id}`}>
                    {e1rmDelta}
                  </td>
                  <td className={`${td} tnum text-[11px]`}>
                    <span
                      data-testid={`set-inol-${set.id}`}
                      className={inol > 0 ? 'text-[var(--cal-muted)]' : 'text-[var(--cal-muted-soft)]'}
                    >
                      {inol > 0 ? inol.toFixed(2) : '—'}
                    </span>
                  </td>
                  </>) : (
                    <td colSpan={7} className="p-0" aria-label="No log set" />
                  )}
                </tr>
              );
            })}
        </tbody>
        {!locked ? (
          <tfoot>
            <tr className="border-t border-[var(--cal-hairline)]">
              <td colSpan={2} />
              <td colSpan={4} className="px-1.5 py-1 text-center">
                <button
                  type="button"
                  data-testid={`add-plan-set-${id}`}
                  aria-label="+ Plan set"
                  onClick={() => addSet('plan')}
                  title={`Add a blank plan set to ${title}`}
                  className={addSetButton}
                >
                  <Plus size={12} strokeWidth={2} aria-hidden="true" />
                  <span>Plan set</span>
                </button>
              </td>
              <td />
              <td colSpan={4} className="px-1.5 py-1 text-center">
                <button
                  type="button"
                  data-testid={`add-log-set-${id}`}
                  aria-label="+ Log set"
                  onClick={() => addSet('log')}
                  title={`Add a blank log set to ${title}`}
                  className={addSetButton}
                >
                  <Plus size={12} strokeWidth={2} aria-hidden="true" />
                  <span>Log set</span>
                </button>
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        ) : null}
      </table>
      </div>
      </div>
      ) : null}
      {editOpen && onUpdateMeta && (
        <CenteredDialog
          title={`Edit lift · ${title}`}
          subtitle="Name, pattern, bar, tempo, ROM, and gear."
          onClose={() => setEditOpen(false)}
          testId="edit-lift-dialog"
          footer={(
            <button
              type="button"
              data-testid="edit-lift-done"
              onClick={() => {
                const nextTitle = (editCategory === 'User Defined' ? editCustomName : editTitle).trim();
                if (!locked && nextTitle) {
                  const patch: LiftMetaPatch = {
                    title: nextTitle,
                    variation: editVariation || compileVariation(nextTitle, parseModifiers(variation, editLiftCategory)),
                    tier: editTier,
                    movementPattern: editMovementPattern,
                    liftCategory: editLiftCategory,
                  };
                  onUpdateMeta(patch);
                }
                setEditOpen(false);
              }}
              className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)]"
            >
              Done
            </button>
          )}
        >
          <div className="flex flex-col gap-2">
            <NestedCard testId={`edit-lift-exercise-card-${id}`}>
              <LiftCatalogChoice
                testPrefix={`edit-lift-${id}`}
                category={editCategory}
                tier={editTier}
                movementPattern={editMovementPattern}
                search={editSearch}
                exerciseName={editExerciseName}
                customName={editCustomName}
                onCategoryChange={(next) => {
                  setEditCategory(next);
                  setEditSearch('');
                  setEditExerciseName('');
                  if (next === 'User Defined') {
                    setEditCustomName(editTitle);
                    setEditMovementPattern(movementPattern ?? 'Misc');
                  }
                }}
                onTierChange={setEditTier}
                onMovementPatternChange={setEditMovementPattern}
                onSearchChange={setEditSearch}
                onExerciseChange={(item) => {
                  setEditCategory('');
                  setEditExerciseName(item.name);
                  setEditTitle(item.name);
                  setEditCustomName('');
                  setEditLiftCategory(item.liftCategory);
                  setEditTier(item.tier);
                  setEditMovementPattern(item.movementPattern);
                  setEditVariation(item.tier === 'Comp' ? compileVariation(item.name, defaultModifiers(item.liftCategory)) : item.name);
                }}
                onCustomNameChange={(next) => {
                  setEditCustomName(next);
                  setEditTitle(next);
                  setEditLiftCategory('Other');
                  setEditVariation(next.trim());
                }}
              />
            </NestedCard>
            <NestedCard testId={`edit-lift-constructor-${id}`}>
              <LiftVariationPicker
                title={editCategory === 'User Defined' ? editCustomName || 'Accessory' : editTitle}
                variation={editVariation}
                liftCategory={editLiftCategory}
                locked={locked}
                onChange={(next) => {
                  setEditVariation(next.variation);
                  setEditTier((current) => current === 'Accessory' ? 'Accessory' : next.tier);
                }}
              />
            </NestedCard>
          </div>
        </CenteredDialog>
      )}
    </div>
  );
};

function dropPercentDisplay(value: number): string {
  return value === 0 ? '' : String(value);
}

function DropPercentCell({
  value,
  locked,
  onCommit,
  grid,
}: {
  value: number;
  locked: boolean;
  onCommit: (pct: number) => void;
  grid: SetGridBind;
}) {
  if (locked) {
    return (
      <span
        className="text-[11px] tnum text-[var(--cal-muted)]"
        data-testid="set-drop-pct"
      >
        {dropPercentDisplay(value) ? String(dropPercentDisplay(value)) + '%' : ''}
      </span>
    );
  }

  return (
    <EditablePerformanceCell
      value={dropPercentDisplay(value)}
      onChange={(raw) => onCommit(parseDropPercent(raw))}
      placeholder=""
      fieldKey="set-drop-pct"
      label="Adjustment percent"
      widthClass="w-10"
      step={1}
      suffix="%"
      grid={grid}
    />
  );
}

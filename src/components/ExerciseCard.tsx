import { useState, useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, GripVertical, Trash2, Copy, Plus, Pencil, StickyNote } from 'lucide-react';
import type { DragControls } from 'motion/react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor } from './PrescriptionEditor';
import { LiftVariationPicker } from './LiftVariationPicker';
import { CenteredDialog, NestedCard } from './CenteredDialog';
import { 
  calculateE1RM, 
  calculateINOL,
  calculatePlannedE1RM,
  getRpePercentage,
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
  type RangeCommand,
  type SetGridBind,
} from '../services/sheetsCellKeyboard';
import {
  cellsIn,
  extendEnd,
  isSingleCell,
  normalizePastedNumber,
  parseTsv,
  planFillDown,
  planPaste,
  rectHas,
  rectOf,
  toTsv,
  type CellWrite,
  type GridCell,
  type GridRect,
} from '../services/sheetRange';
import { clearHistory, createGridHistory, recordChange, sameSets, stepRedo, stepUndo } from '../services/setGridHistory';
import {
  applySetDropPercent,
  parseDropPercent,
  planKgOfferKg,
  refreshSetAnchors,
} from '../services/setPrescription';
import type { LiftMetaPatch } from '../types';

type LaneEntry = { set: any; index: number };

/** Rows of the grid zip the plan list with the log list (the two halves may be different records). */
function lanesOf(setList: any[]): { planRows: LaneEntry[]; logRows: LaneEntry[] } {
  const entries = setList.map((set, index) => ({ set, index }));
  return {
    planRows: entries.filter(({ set }) => set.scope !== 'log'),
    logRows: entries.filter(({ set }) => set.scope !== 'plan'),
  };
}

function newSetRecord(number: number, scope: 'plan' | 'log' | 'both') {
  return {
    id: `s-${Math.random().toString(36).slice(2, 12)}`,
    label: `Set ${number}`,
    scope,
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
    executedRpe: null,
  };
}

function cellText(value: unknown): string {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

/** "Knee Dominant" → "Knee dominant" for display. */
function sentenceCaseLabel(value: string): string {
  const [first, ...rest] = value.split(' ');
  return [first, ...rest.map((word) => word.toLowerCase())].join(' ');
}
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

type ExerciseSummarySet = {
  scope?: string;
  actual?: unknown;
  reps?: unknown;
  executedRpe?: unknown;
  plannedReps?: unknown;
  plannedRpe?: unknown;
  target_value?: unknown;
  intensity_type?: string;
};

export function summarizeExerciseCard(sets: ExerciseSummarySet[]): {
  intensityPct: number | null;
  nl: number;
} {
  const loggedSets = sets.filter((set) => set.scope !== 'plan' && trainingNumber(set.actual) != null);
  const useLogged = loggedSets.length > 0;
  const selectedSets = useLogged
    ? loggedSets
    : sets.filter((set) => set.scope !== 'log');

  const intensityValues = selectedSets
    .map((set) => {
      if (useLogged) {
        const weight = trainingOrZero(set.actual);
        const reps = trainingIntOrZero(set.reps);
        const rpe = trainingOrZero(set.executedRpe);
        if (weight > 0 && reps > 0 && rpe > 0) {
          const e1rm = calculateE1RM(weight, reps, rpe);
          if (e1rm > 0) return (weight / e1rm) * 100;
        }
      }

      const reps = trainingIntOrZero(useLogged ? set.reps ?? set.plannedReps : set.plannedReps);
      const target = trainingOrZero(set.target_value ?? set.plannedRpe);
      if (reps <= 0 || target <= 0) return null;
      return set.intensity_type === 'PERCENT'
        ? target
        : getRpePercentage(reps, target) * 100;
    })
    .filter((value): value is number => value != null && value > 0);

  return {
    intensityPct: intensityValues.length > 0
      ? Math.round(intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length)
      : null,
    nl: selectedSets.reduce(
      (sum, set) => sum + trainingIntOrZero(useLogged ? set.reps : set.plannedReps),
      0,
    ),
  };
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
  onMinimizedChange,
  dragControls,
  locked = false,
  canEditPlan = true,
  roleMode: _roleMode = 'coach',
  initialMinimized = true,
  minimized: minimizedProp,
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
  onMinimizedChange?: (minimized: boolean) => void,
  dragControls?: DragControls,
  locked?: boolean,
  canEditPlan?: boolean,
  roleMode?: 'coach' | 'athlete',
  initialMinimized?: boolean,
  /** Controlled open/closed state; when omitted the card keeps its own (starting from initialMinimized). */
  minimized?: boolean,
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
  const [noteOpen, setNoteOpen] = useState(false);
  const [ownMinimized, setOwnMinimized] = useState(initialMinimized);
  const minimized = minimizedProp ?? ownMinimized;
  const [grid, setGrid] = useState<{
    row: number;
    col: number;
    mode: CellMode;
    overwrite: boolean;
    seed?: string;
    /** Multi-cell selection. The active cell (row/col) stays where typing goes. */
    range?: { anchor: GridCell; end: GridCell };
  } | null>(null);
  const historyRef = useRef(createGridHistory<any[]>());
  const [dragging, setDragging] = useState(false);
  const dragAnchorRef = useRef<GridCell | null>(null);
  const [gridNotice, setGridNotice] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [rangeBox, setRangeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

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
    // Blur-to-save: nothing to send when the note did not change.
    if (noteDraft.trim() === (liftNote ?? '').trim()) return;
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

  // Undo never crosses a lock, and a finished session can't be changed anyway.
  useEffect(() => {
    if (locked) clearHistory(historyRef.current);
  }, [locked]);

  const updateAndPropagate = (newSets: any[], record = true) => {
    const recalculated = recalculatePresetsAndSugs(newSets);
    if (record && !sameSets(sets, recalculated)) recordChange(historyRef.current, sets, recalculated);
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

  /** Delete the whole row: its plan and its log, even when they are two separate records. */
  const deleteRow = (laneIndex: number) => {
    const planIdx = planRows[laneIndex]?.index;
    const logIdx = logRows[laneIndex]?.index;
    if (planIdx === undefined && logIdx === undefined) return;
    const next = sets.flatMap((set, i) => {
      const dropPlan = i === planIdx;
      const dropLog = i === logIdx;
      if (!dropPlan && !dropLog) return [set];
      // A "both" record can show its plan in one row and its log in another: keep the other half.
      if (set.scope === 'both' && dropPlan && !dropLog) {
        return [{ ...set, scope: 'log', plannedWeight: null, plannedReps: null, plannedRpe: null, target_value: null, dropPercent: 0 }];
      }
      if (set.scope === 'both' && dropLog && !dropPlan) {
        return [{ ...set, scope: 'plan', actual: null, reps: null, executedRpe: null }];
      }
      return [];
    });
    updateAndPropagate(next);
  };

  /**
   * Copy plan → log for one row. Rows pair the Nth plan record with the Nth log record, so the
   * log must land at log position `laneIndex` and the plan rows must not move. Only log fields
   * are written; a record's scope changes only when a plan-only record can carry this row's log.
   */
  const syncTarget = (planIndex: number, laneIndex: number) => {
    if (locked) return;
    const plan = sets[planIndex];
    if (!plan) return;
    const logValues = {
      actual: trainingNumber(plan.plannedWeight),
      reps: trainingInt(plan.plannedReps),
      executedRpe: plan.intensity_type === 'PERCENT' ? null : trainingNumber(plan.plannedRpe),
      isAuto: false,
    };
    // This row already shows a log (same record or a separate one): fill it, keep its scope.
    const logEntry = logRows[laneIndex];
    if (logEntry) {
      updateSet(logEntry.index, logValues);
      return;
    }
    // No log in this row. Logs fill rows top-down, so the plan record itself can carry it only
    // when it is plan-only and every existing log sits in an earlier row and an earlier record.
    if (plan.scope === 'plan' && logRows.length === laneIndex && logRows.every(({ index }) => index < planIndex)) {
      updateSet(planIndex, { ...logValues, scope: 'both' });
      return;
    }
    // Otherwise add log sets at the end: empty ones for the rows above that have no log yet,
    // then this row's. Plan rows are untouched.
    const blanks = Array.from({ length: laneIndex - logRows.length }, (_, i) => newSetRecord(sets.length + 1 + i, 'log'));
    updateAndPropagate([...sets, ...blanks, { ...newSetRecord(sets.length + blanks.length + 1, 'log'), ...logValues }]);
  };

  const totalVolume = sets.reduce((acc, s) => acc + (trainingOrZero(s.actual) * trainingIntOrZero(s.reps)), 0);
  const plannedCount = sets.filter((set) => set.scope !== 'log').length;
  const loggedCount = sets.filter((set) => set.scope !== 'plan' && trainingNumber(set.actual) != null).length;
  const { intensityPct, nl } = summarizeExerciseCard(sets);

  // One "Add set": a new full row (plan + log). If the plan and log columns are uneven,
  // it first fills the next row that is missing a half. Without plan rights it adds a log set.
  const addSet = () => {
    if (!canEditPlan) return addHalfSet('log');
    if (planRows.length < logRows.length) return addHalfSet('plan');
    if (logRows.length < planRows.length) return addHalfSet('log');
    const nextRow = planRows.length;
    updateAndPropagate([...sets, newSetRecord(sets.length + 1, 'both')]);
    setGrid({ row: nextRow, col: 1, mode: 'selected', overwrite: false });
  };

  const addHalfSet = (target: 'plan' | 'log') => {
    const targetRows = target === 'plan' ? planRows : logRows;
    const oppositeRows = target === 'plan' ? logRows : planRows;
    const nextRow = targetRows.length;
    const oppositeEntry = oppositeRows[nextRow];
    if (oppositeEntry) {
      updateSet(oppositeEntry.index, target === 'plan'
        ? { scope: 'both', plannedWeight: null, plannedReps: null, plannedRpe: null, target_value: null, dropPercent: 0 }
        : { scope: 'both', actual: null, reps: null, executedRpe: null });
      setGrid({ row: nextRow, col: target === 'plan' ? (nextRow === 0 ? 1 : 0) : 4, mode: 'selected', overwrite: false });
      return;
    }
    updateAndPropagate([...sets, newSetRecord(sets.length + 1, target)]);
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
      // Blur commit: if a mousedown already selected another cell, keep that selection.
      setGrid((prev) => (prev && (prev.row !== nextRow || prev.col !== nextCol)
        ? prev
        : { row: nextRow, col: nextCol, mode: 'selected', overwrite: false }));
    },
    inRange: rangeIsMulti && rangeRect != null && rectHas(rangeRect, row, col),
    onExtend: extendRange,
    onRangeCommand: runRangeCommand,
    onClearRange: clearRange,
    copyText: copyRange,
    onPasteText: pasteRange,
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

  const td = "p-0 align-middle whitespace-nowrap";
  const th = "px-3 py-2 text-left text-[13px] font-semibold text-[var(--cal-ink)] whitespace-nowrap";
  const thField = "px-3 py-1.5 text-right text-xs font-normal text-[var(--cal-muted)] whitespace-nowrap";
  const thMetric = "px-3 py-1.5 text-center text-xs font-normal text-[var(--cal-muted)] whitespace-nowrap";
  const actionCell = "w-14 px-0 py-1 align-middle whitespace-nowrap";
  // Row tools: quiet ghost icons, shown on row hover/focus (always on touch), like the calendar day tools.
  const actionButton = "inline-flex h-6 w-6 items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--cal-surface-strong)] hover:text-[var(--cal-ink)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 group-hover:disabled:opacity-30";
  const headerButton = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--cal-radius-md)] px-2 text-[13px] text-[var(--cal-muted)] transition-colors hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:opacity-40";
  const headerIcon = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] transition-colors hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:opacity-40";

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

  // ---- Range selection (Sheets parity; see .cursor/rules/sheets-cell-edit.mdc) ----
  const setsRef = useRef(sets);
  setsRef.current = sets;
  const rowCount = Math.max(planRows.length, logRows.length);
  const rangeRect: GridRect | null = grid
    ? grid.range ? rectOf(grid.range.anchor, grid.range.end) : rectOf({ row: grid.row, col: grid.col })
    : null;
  const rangeIsMulti = rangeRect != null && !isSingleCell(rangeRect);

  const readCellOf = (lanes: { planRows: LaneEntry[]; logRows: LaneEntry[] }) => (row: number, col: number): string => {
    const plan = lanes.planRows[row]?.set;
    const log = lanes.logRows[row]?.set;
    switch (col) {
      case 0: return plan && row > 0 ? dropPercentDisplay(trainingInt(plan.dropPercent) ?? 0) : '';
      case 1: return cellText(plan?.plannedWeight);
      case 2: return cellText(plan?.plannedReps);
      case 3: return cellText(plan?.target_value);
      case 4: return cellText(log?.actual);
      case 5: return cellText(log?.reps);
      case 6: return cellText(log?.executedRpe);
      default: return '';
    }
  };
  const readCell = readCellOf({ planRows, logRows });

  /** One rule for clear, paste, fill and accept: only real, editable cells; never creates sets. */
  const isWritable = (lanes: { planRows: LaneEntry[]; logRows: LaneEntry[] }, row: number, col: number) => {
    if (locked) return false;
    if (col <= 3) return canEditPlan && Boolean(lanes.planRows[row]) && !(col === 0 && row === 0);
    return Boolean(lanes.logRows[row]);
  };

  /** Typed text → the numeric patch for that column (null = not a number, skip). */
  const patchFor = (col: number, raw: string): Record<string, unknown> | null => {
    const empty = raw === '';
    const n = empty ? null : trainingNumber(raw);
    if (!empty && n === null) return null;
    switch (col) {
      case 0: return { dropPercent: empty ? 0 : parseDropPercent(raw), isAuto: false };
      case 1: return { plannedWeight: n };
      case 2: return { plannedReps: n === null ? null : Math.round(n) };
      case 3: return { target_value: n, plannedRpe: n };
      case 4: return { actual: n, isAuto: empty };
      case 5: return { reps: n === null ? null : Math.round(n) };
      case 6: return { executedRpe: n };
      default: return null;
    }
  };

  const applyWrites = (base: any[], writes: CellWrite[]) => {
    const lanes = lanesOf(base);
    const next = [...base];
    let applied = 0;
    let skipped = 0;
    for (const write of writes) {
      const patch = isWritable(lanes, write.row, write.col) ? patchFor(write.col, write.raw) : null;
      if (!patch) {
        skipped += 1;
        continue;
      }
      const index = (write.col <= 3 ? lanes.planRows : lanes.logRows)[write.row].index;
      next[index] = { ...next[index], ...patch };
      applied += 1;
    }
    return { next, applied, skipped };
  };

  const saveWrites = (base: any[], writes: CellWrite[]) => {
    const result = applyWrites(base, writes);
    if (result.applied > 0) updateAndPropagate(result.next);
    return result;
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const clearRange = () => {
    if (!rangeRect) return;
    setGridNotice(null);
    saveWrites(sets, cellsIn(rangeRect).map((cell) => ({ ...cell, raw: '' })));
  };

  const copyRange = () => (rangeRect ? toTsv(rangeRect, readCell) : '');

  /** Append rows for a paste that ran past the last set — only when the person asks. */
  const addRowsAndPaste = (rest: string[][], left: number) => {
    const base = setsRef.current;
    const lanes = lanesOf(base);
    const firstRow = Math.max(lanes.planRows.length, lanes.logRows.length);
    const width = Math.max(...rest.map((line) => line.length));
    const touchesPlan = left <= 3;
    const touchesLog = left + width - 1 >= 4;
    const scope = touchesPlan && touchesLog ? 'both' : touchesPlan ? 'plan' : 'log';
    const added = rest.map((_, i) => newSetRecord(base.length + i + 1, scope));
    const writes = rest.flatMap((line, r) => line
      .map((raw, c) => ({ row: firstRow + r, col: left + c, raw: normalizePastedNumber(raw) }))
      .filter((write) => write.col < GRID_COL_COUNT));
    const result = applyWrites([...base, ...added], writes);
    updateAndPropagate(result.next);
    setGridNotice(result.skipped > 0 ? { text: `${plural(result.skipped, 'cell')} skipped (no set there, read-only, or not a number).` } : null);
  };

  const pasteRange = (text: string) => {
    if (!rangeRect || locked) return;
    const matrix = parseTsv(text);
    const plan = planPaste(rangeRect, matrix, rowCount, GRID_COL_COUNT);
    const result = saveWrites(sets, plan.writes);
    if (matrix.length > 1 || matrix[0].length > 1) {
      const width = Math.max(...matrix.map((line) => line.length));
      setGrid((prev) => prev && ({
        ...prev,
        mode: 'selected',
        range: {
          anchor: { row: rangeRect.top, col: rangeRect.left },
          end: {
            row: Math.min(rangeRect.top + plan.pastedRows - 1, Math.max(0, rowCount - 1)),
            col: Math.min(rangeRect.left + width - 1, GRID_COL_COUNT - 1),
          },
        },
      }));
    }
    const parts: string[] = [];
    if (result.skipped > 0) parts.push(`${plural(result.skipped, 'cell')} skipped (no set there, read-only, or not a number).`);
    if (plan.clippedRows > 0) {
      const width = Math.max(...matrix.map((line) => line.length));
      const touchesPlan = rangeRect.left <= 3;
      const touchesLog = rangeRect.left + width - 1 >= 4;
      // New rows only line up when the lists they join are full to the last row.
      const canAdd = !locked
        && (!touchesPlan || (canEditPlan && planRows.length === rowCount))
        && (!touchesLog || logRows.length === rowCount);
      const rest = matrix.slice(plan.pastedRows);
      setGridNotice({
        text: [`Pasted ${plan.pastedRows} of ${matrix.length} rows.`, ...parts].join(' '),
        action: canAdd
          ? { label: `Add ${plural(plan.clippedRows, 'set')}`, run: () => addRowsAndPaste(rest, rangeRect.left) }
          : undefined,
      });
      return;
    }
    setGridNotice(parts.length ? { text: parts.join(' ') } : null);
  };

  const fillDown = () => {
    if (!rangeRect) return;
    setGridNotice(null);
    saveWrites(sets, planFillDown(rangeRect, readCell));
  };

  const acceptSuggestions = () => {
    if (!rangeRect || locked || !canEditPlan) return;
    const writes: CellWrite[] = [];
    for (let row = rangeRect.top; row <= rangeRect.bottom; row += 1) {
      if (!rectHas(rangeRect, row, 1)) continue;
      const plan = planRows[row]?.set;
      const offer = plan ? planKgOfferKg(plan.suggestedWeight ?? null, plan.plannedWeight) : null;
      if (offer != null) writes.push({ row, col: 1, raw: String(offer) });
    }
    if (writes.length === 0) {
      setGridNotice({ text: 'No suggested weights in the selection.' });
      return;
    }
    setGridNotice(null);
    saveWrites(sets, writes);
  };

  const runHistory = (direction: 'undo' | 'redo') => {
    const step = direction === 'undo'
      ? stepUndo(historyRef.current, sets, sameSets)
      : stepRedo(historyRef.current, sets, sameSets);
    if (step.status === 'ok') {
      updateAndPropagate(step.value, false);
      setGridNotice(null);
    } else if (step.status === 'conflict') {
      setGridNotice({ text: `Can't ${direction}: this lift changed since.` });
    }
  };

  const runRangeCommand = (command: RangeCommand): boolean => {
    switch (command) {
      case 'collapse':
        if (!grid?.range) return false;
        setGrid({ ...grid, range: undefined });
        setGridNotice(null);
        return true;
      case 'selectAll':
        if (rowCount === 0) return true;
        setGrid((prev) => prev && ({ ...prev, mode: 'selected', range: { anchor: { row: 0, col: 0 }, end: { row: rowCount - 1, col: GRID_COL_COUNT - 1 } } }));
        return true;
      case 'fillDown': fillDown(); return true;
      case 'acceptSuggestions': acceptSuggestions(); return true;
      case 'undo': runHistory('undo'); return true;
      case 'redo': runHistory('redo'); return true;
      default: {
        const _exhaustive: never = command;
        return _exhaustive;
      }
    }
  };

  const extendRange = (direction: 'left' | 'right' | 'up' | 'down') => {
    setGrid((prev) => {
      if (!prev) return prev;
      const base = prev.range ?? { anchor: { row: prev.row, col: prev.col }, end: { row: prev.row, col: prev.col } };
      return { ...prev, mode: 'selected', range: { anchor: base.anchor, end: extendEnd(base.end, direction, rowCount, GRID_COL_COUNT) } };
    });
  };

  const gridPosOf = (target: EventTarget | null): GridCell | null => {
    const td = (target as HTMLElement | null)?.closest?.('[data-grid-pos]');
    if (!td) return null;
    const [row, col] = (td.getAttribute('data-grid-pos') ?? '').split(':').map(Number);
    return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
  };

  const onGridMouseDown = (event: ReactMouseEvent<HTMLTableElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, button, textarea, select')) return;
    // Stop the browser from starting a text selection anywhere in the grid (a drag can
    // run over row numbers, metrics and headers). Focus is moved to the cell by hand.
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const pos = gridPosOf(target);
    if (!pos) return;
    const cellEl = target.closest('[data-grid-pos]')?.querySelector<HTMLElement>('[data-cell-id]') ?? null;
    if (event.shiftKey && grid) {
      setGrid({ ...grid, mode: 'selected', range: { anchor: grid.range?.anchor ?? { row: grid.row, col: grid.col }, end: pos } });
      return;
    }
    if (!cellEl) return;
    // Focusing also blurs a cell that is being edited, which commits it.
    cellEl.focus({ preventScroll: true });
    setGridNotice(null);
    dragAnchorRef.current = pos;
    setDragging(true);
    setGrid((prev) => (prev && prev.row === pos.row && prev.col === pos.col && !prev.range
      ? prev
      : { row: pos.row, col: pos.col, mode: 'selected', overwrite: false }));
  };

  const onGridMouseOver = (event: ReactMouseEvent<HTMLTableElement>) => {
    const anchor = dragAnchorRef.current;
    if (!anchor) return;
    const pos = gridPosOf(event.target);
    if (!pos) return;
    setGrid((prev) => {
      if (!prev) return prev;
      if (pos.row === anchor.row && pos.col === anchor.col) return prev.range ? { ...prev, range: undefined } : prev;
      return { ...prev, row: anchor.row, col: anchor.col, mode: 'selected', range: { anchor, end: pos } };
    });
  };

  useEffect(() => {
    if (!dragging) return;
    const stop = () => {
      dragAnchorRef.current = null;
      setDragging(false);
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [dragging]);

  // One outline around the whole range, measured from its corner cells (Sheets look).
  const rangeKey = rangeIsMulti && rangeRect ? `${rangeRect.top}:${rangeRect.left}:${rangeRect.bottom}:${rangeRect.right}` : '';
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = gridWrapRef.current;
      if (!rangeKey || !wrap || !rangeRect) {
        setRangeBox(null);
        return;
      }
      const first = wrap.querySelector(`[data-grid-pos="${rangeRect.top}:${rangeRect.left}"]`);
      const last = wrap.querySelector(`[data-grid-pos="${rangeRect.bottom}:${rangeRect.right}"]`);
      if (!first || !last) {
        setRangeBox(null);
        return;
      }
      const frame = wrap.getBoundingClientRect();
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      setRangeBox({
        left: a.left - frame.left + wrap.scrollLeft,
        top: a.top - frame.top + wrap.scrollTop,
        width: b.right - a.left,
        height: b.bottom - a.top,
      });
    };
    measure();
    if (!rangeKey) return;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, sets.length, minimized]);

  // Lift totals: one line in the minimized header, a stacked list beside the grid when open.
  const liftStats = (layout: 'inline' | 'stacked') => {
    const items: Array<{ key: string; label: string; value: ReactNode; testId?: string; title?: string }> = [];
    if (intensityPct != null) items.push({ key: 'intensity', label: 'Intensity', value: `${intensityPct}%`, testId: `lift-intensity-${id}` });
    items.push({
      key: 'sets',
      label: 'Sets',
      title: `${plannedCount} planned, ${loggedCount} logged`,
      testId: `lift-set-count-${id}`,
      // Each half stays whole, so a narrow totals column breaks at the dot, not inside "0 logged".
      value: <><span className="whitespace-nowrap"><span className="font-medium text-[var(--cal-ink)]">{plannedCount}</span> planned ·</span> <span className="whitespace-nowrap"><span className="font-medium text-[var(--cal-ink)]">{loggedCount}</span> logged</span></>,
    });
    items.push({ key: 'nl', label: 'NL', value: nl, testId: `lift-nl-${id}` });
    items.push({ key: 'e1rm', label: 'e1RM', value: sets[0]?.baseline_e1rm ? Math.round(sets[0].baseline_e1rm) : '—' });
    items.push({ key: 'volume', label: 'Volume', value: `${totalVolume.toLocaleString()} kg` });
    if (layout === 'inline') {
      return items.map((item) => (
        <span key={item.key} className="whitespace-nowrap tnum" title={item.title}>
          {item.key === 'sets' ? null : <>{item.label} </>}
          <span className={item.key === 'sets' ? '' : 'font-medium text-[var(--cal-ink)]'} data-testid={item.testId}>{item.value}</span>
        </span>
      ));
    }
    return (
      <dl className="lift-stats text-[13px] text-[var(--cal-muted)]" aria-label="Lift totals">
        {items.map((item) => (
          <div key={item.key} className="lift-stat" title={item.title}>
            <dt>{item.label}</dt>
            <dd className={`tnum ${item.key === 'sets' ? '' : 'font-medium text-[var(--cal-ink)]'}`} data-testid={item.testId}>{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <div className="lift-card cal-nested-card cal-nested-flush mx-2 mb-2 overflow-hidden">
      {/* Narrow card: name row on top, grid, then totals. Wide open card: name row on top, grid, totals and note in a column on the right (index.css .lift-layout). */}
      <div className={`lift-layout ${minimized ? '' : 'lift-layout--open'}`}>
      <div className="lift-head flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="lift-head__main flex items-center gap-1.5 min-w-0">
          {dragControls ? (
            <button
              type="button"
              data-testid={`reorder-lift-${id}`}
              aria-label={`Reorder ${variation}`}
              disabled={locked}
              onPointerDown={(event) => dragControls.start(event)}
              className={`${headerIcon} cursor-grab touch-none active:cursor-grabbing disabled:cursor-not-allowed`}
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
              const next = !minimized;
              if (minimizedProp === undefined) setOwnMinimized(next);
              onMinimizedChange?.(next);
              setGrid(null);
            }}
            className={headerIcon}
            title={minimized ? 'Expand lift' : 'Minimize lift'}
          >
            {minimized ? <ChevronRight size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
          </button>
          <h4
            className="text-base leading-6 font-semibold tracking-tight text-[var(--cal-ink)] truncate"
            data-testid={`exercise-title-${id}`}
          >
            {variation}
          </h4>
          <div
            id={minimized ? `lift-grid-${id}` : undefined}
            data-testid={minimized ? `lift-minimized-${id}` : `lift-meta-${id}`}
            aria-label="Lift summary"
            className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-[var(--cal-muted)]"
          >
            <span className="truncate whitespace-nowrap">{tier ?? 'Lift'}</span>
            <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">·</span>
            <span className="truncate whitespace-nowrap">{movementPattern ? sentenceCaseLabel(movementPattern) : liftCategory}</span>
          </div>
          {onUpdateMeta ? (
            <button
              type="button"
              data-testid={`edit-lift-${id}`}
              aria-label={`Edit ${variation}`}
              disabled={locked}
              onClick={() => setEditOpen(true)}
              className={headerButton}
            >
              <Pencil size={13} aria-hidden="true" />
              Edit
            </button>
          ) : null}
        </div>
        <div className="lift-head__tools flex items-center gap-4 shrink-0 text-[13px] text-[var(--cal-muted)]">
          {minimized ? <>{liftStats('inline')}</> : null}
          {onMoveUp && (
            <button
              type="button"
              data-testid={`move-lift-up-${id}`}
              aria-label={`Move ${variation} up`}
              disabled={locked}
              onClick={() => void onMoveUp()}
              className={headerButton}
            >
              Up
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              data-testid={`move-lift-down-${id}`}
              aria-label={`Move ${variation} down`}
              disabled={locked}
              onClick={() => void onMoveDown()}
              className={headerButton}
            >
              Down
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              data-testid={`remove-lift-${id}`}
              aria-label={removing ? `Removing ${variation}` : `Remove ${variation}`}
              data-tip="Remove this lift from the session"
              disabled={locked || removing}
              onClick={() => {
                if (locked || removing) return;
                if (!window.confirm(`Remove ${title} from this session?`)) return;
                setRemoving(true);
                void Promise.resolve(onRemove()).finally(() => setRemoving(false));
              }}
              className={`${headerIcon} hover:!text-[var(--cal-error)]`}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {!minimized ? (
      <>
      <div className="lift-main flex min-w-0 max-w-full flex-col gap-3">
      <div id={`lift-grid-${id}`} ref={gridWrapRef} className="relative min-w-0 max-w-full overflow-x-auto">
      <table
        role="grid"
        aria-label="Plan and log sets"
        aria-multiselectable="true"
        data-testid="set-grid"
        onMouseDown={onGridMouseDown}
        onMouseOver={onGridMouseOver}
        className={`sheet-grid text-left w-max max-w-full ${dragging ? 'sheet-grid--dragging' : ''}`}
      >
        <thead>
          <tr className="border-b border-[var(--cal-hairline-soft)]">
            <th rowSpan={2} className={`${thMetric} sheet-th w-10 px-2 align-bottom`} data-testid="set-grid-h-num">#</th>
            <th colSpan={4} className={`${th} sheet-th sheet-th--group`} data-testid="set-grid-h-plan">
              <div className="relative flex min-h-5 items-center justify-start">
                <span>Plan</span>
                {selectedPlanEntry && selectedPlanOffer != null && selectedPlanNumber != null ? (
                  <span className="absolute right-0 inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-normal text-[var(--cal-muted)]">
                    <span className="text-[var(--cal-muted-soft)]">Set {selectedPlanNumber}</span>
                    <span>{selectedPlanEntry.set.plannedWeight ?? '—'} → <span data-testid="plan-suggestion-value">{selectedPlanOffer}</span> kg</span>
                    <button
                      type="button"
                      data-testid="plan-suggest"
                      onClick={() => updateSet(selectedPlanEntry.index, { plannedWeight: selectedPlanOffer, isAuto: false })}
                      disabled={locked || !canEditPlan}
                      className="cal-dock-btn cal-dock-btn--main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
                    >
                      Use
                    </button>
                  </span>
                ) : null}
              </div>
            </th>
            <th rowSpan={2} className="sheet-gap" aria-hidden="true" />
            <th colSpan={3} className={`${th} sheet-th sheet-th--group`} data-testid="set-grid-h-log">Log</th>
            <th rowSpan={2} className="sheet-gap" aria-hidden="true" />
            <th rowSpan={2} className={`${thMetric} sheet-th w-14 align-bottom`} data-testid="set-grid-h-e1rm">e1RM</th>
            <th rowSpan={2} className={`${thMetric} sheet-th w-14 align-bottom`} data-testid="set-grid-h-delta">Δ%</th>
            <th rowSpan={2} className={`${thMetric} sheet-th w-14 align-bottom`} data-testid="set-grid-h-inol">INOL</th>
            {/* Row tools live in a borderless gutter outside the sheet. */}
            <th rowSpan={2} className="w-[7.5rem] p-0" aria-label="Set actions" data-testid="set-grid-h-copy" />
          </tr>
          <tr className="border-b border-[var(--cal-hairline-soft)]">
            <th className={`${thField} sheet-th w-14`} data-testid="set-grid-h-pct">Drop %</th>
            <th className={`${thField} sheet-th`} data-testid="set-grid-h-planKg">kg</th>
            <th className={`${thField} sheet-th`} data-testid="set-grid-h-planReps">Reps</th>
            <th className={`${thField} sheet-th`} data-testid="set-grid-h-planTarget">Intensity</th>
            <th className={`${thField} sheet-th`} data-testid="set-grid-h-logKg">kg</th>
            <th className={`${thField} sheet-th`} data-testid="set-grid-h-logReps">Reps</th>
            <th className={`${thField} sheet-th`} data-testid="set-grid-h-logRpe">RPE</th>
          </tr>
        </thead>
        <tbody>
            {planRows.length === 0 && logRows.length === 0 && (
              <tr>
                <td colSpan={13} className="sheet-td px-3 py-3 text-[13px] text-[var(--cal-muted)]">
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
              // No RPE logged → no e1RM from the log (the formula would just echo the bar weight).
              const e1RM = rpe > 0 ? calculateE1RM(weight, reps, rpe) : 0;
              const planE1RM = calculatePlannedE1RM(
                trainingOrZero(set.plannedWeight),
                trainingIntOrZero(set.plannedReps),
                set.intensity_type,
                trainingOrZero(set.target_value ?? set.plannedRpe),
              );
              const e1rmDelta = formatE1rmDeltaPct(planE1RM, e1RM);
              // INOL needs %1RM: from the logged e1RM, else from the max the plan implies
              // (e.g. 100 kg logged on a 60% row → 60%).
              const inolMax = e1RM > 0 ? e1RM : planE1RM;
              const intensityPct = inolMax > 0 && weight > 0 ? (weight / inolMax) * 100 : 0;
              const inol = intensityPct > 0 && reps > 0 ? calculateINOL(reps, intensityPct) : 0;
              
              const rowHighlight = 'hover:bg-[color-mix(in_srgb,var(--cal-surface-soft)_60%,transparent)]';

              const hasPlan = Boolean(planEntry);
              const hasLog = Boolean(logEntry);

              return (
                <tr key={`${planEntry?.set.id ?? logEntry?.set.id ?? laneIndex}-${laneIndex}`} className={`group ${rowHighlight}`}>
                  {hasPlan ? (<>
                  <td className={`${td} sheet-td sheet-td--num w-10 px-2 tnum text-[13px] text-[var(--cal-muted)] text-center ${set.isTop ? 'sheet-td--top' : ''}`} title={set.isTop ? 'Top set' : undefined}>{laneIndex + 1}</td>
                  <td data-grid-pos={`${laneIndex}:0`} className={`${td} sheet-td`}>
                    {laneIndex === 0 ? (
                      locked ? (
                        <span className="text-sm tnum text-[var(--cal-muted-soft)]" aria-hidden="true"> </span>
                      ) : (
                        // A1: selectable like any cell (start a range or paste here), never editable.
                        <EditablePerformanceCell
                          value=""
                          onChange={() => undefined}
                          readOnly
                          placeholder=""
                          fieldKey="set-drop-pct-first"
                          label="Drop % (not used on set 1)"
                          widthClass="w-16"
                          grid={bindGrid(0, 0)}
                        />
                      )
                    ) : (
                      <DropPercentCell
                        value={trainingInt(set.dropPercent) ?? 0}
                        locked={locked || !canEditPlan}
                        onCommit={(pct) => commitDropPercent(planIndex, pct)}
                        grid={bindGrid(laneIndex, 0)}
                      />
                    )}
                  </td>
                    {hasPlan ? (!locked && canEditPlan ? (
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
                            tdClass={`${td} sheet-td`}
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
                        <td data-grid-pos={`${laneIndex}:1`} className={`${td} sheet-td w-[72px] px-3 text-right tnum text-sm text-[var(--cal-ink)]`}>{set.plannedWeight ?? ''}</td>
                        <td data-grid-pos={`${laneIndex}:2`} className={`${td} sheet-td w-14 px-3 text-right tnum text-sm`}>{set.plannedReps ?? ''}</td>
                        <td data-grid-pos={`${laneIndex}:3`} className={`${td} sheet-td w-[84px] px-3 text-right tnum text-sm`}>{set.target_value != null ? `${set.target_value}${set.intensity_type === "PERCENT" ? "%" : ""}` : ''}</td>
                      </>
                    )) : (
                      <>
                        <td colSpan={3} className={`${td} sheet-td sheet-td--readonly`} aria-label="No plan set" />
                      </>
                    )}
                  </>) : (
                    <>
                      {Array.from({ length: 5 }).map((_, cell) => (
                        <td key={`noplan-${cell}`} data-grid-pos={cell > 0 ? `${laneIndex}:${cell - 1}` : undefined} className="sheet-td sheet-td--readonly h-9" aria-label={cell === 0 ? 'No plan set' : undefined} />
                      ))}
                    </>
                  )}
                  <td className="sheet-gap" aria-hidden="true" />
                  {hasLog ? (<>
                  <td data-grid-pos={`${laneIndex}:4`} className={`${td} sheet-td`}>
                    {locked ? (
                      <span className="flex h-9 w-[72px] items-center justify-end px-3 text-sm tnum text-[var(--cal-ink)]">{set.actual ?? ''}</span>
                    ) : (
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.actual)}
                        onChange={(val) => updateSet(logIndex, { actual: trainingNumber(val), isAuto: !val })}
                        placeholder=""
                        fieldKey={`${id}-actual-weight`}
                        label="Log Weight"
                        widthClass="w-[72px]"
                        isLogged={true}
                        isAuto={false}
                        suggestedValue={null}
                        step={2.5}
                        rowIndex={logIndex}
                        grid={bindGrid(laneIndex, 4)}
                      />
                    )}
                  </td>
                  <td data-grid-pos={`${laneIndex}:5`} className={`${td} sheet-td`}>
                    {locked ? (
                      <span className="flex h-9 w-14 items-center justify-end px-3 text-sm tnum">{set.reps ?? ''}</span>
                    ) : (
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.reps)}
                        onChange={(val) => updateSet(logIndex, { reps: trainingInt(val) })}
                        placeholder=""
                        fieldKey={`${id}-reps`}
                        label="Log Reps"
                        widthClass="w-14"
                        isLogged={true}
                        step={1}
                        rowIndex={logIndex}
                        grid={bindGrid(laneIndex, 5)}
                      />
                    )}
                  </td>
                  <td data-grid-pos={`${laneIndex}:6`} className={`${td} sheet-td`}>
                    {locked ? (
                      <span className="flex h-9 w-14 items-center justify-end px-3 text-sm tnum">{set.executedRpe ?? ''}</span>
                    ) : (
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.executedRpe)}
                        onChange={(val) => updateSet(logIndex, { executedRpe: trainingNumber(val) })}
                        placeholder=""
                        fieldKey={`${id}-executedRpe`}
                        label="Log RPE"
                        widthClass="w-14"
                        isLogged={true}
                        step={0.5}
                        rowIndex={logIndex}
                        grid={bindGrid(laneIndex, 6)}
                      />
                    )}
                  </td>
                  <td className="sheet-gap" aria-hidden="true" />
                  <td className={`${td} sheet-td sheet-td--readonly w-16 px-3 text-center tnum text-sm`} data-testid={`set-metrics-${set.id}`}>
                    <span data-testid={`set-e1rm-${set.id}`} className={e1RM > 0 ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}>
                      {e1RM > 0 ? Math.round(e1RM) : '—'}
                    </span>
                  </td>
                  <td className={`${td} sheet-td sheet-td--readonly w-16 px-3 text-center tnum text-[13px] ${e1rmDelta.startsWith('-') ? 'text-[var(--cal-warning,var(--cal-muted))]' : e1rmDelta.startsWith('+') ? 'text-[var(--cal-success)]' : 'text-[var(--cal-muted)]'}`} data-testid={`set-e1rm-delta-${set.id}`}>
                    {e1rmDelta}
                  </td>
                  <td className={`${td} sheet-td sheet-td--readonly w-16 px-3 text-center tnum text-[13px]`}>
                    <span
                      data-testid={`set-inol-${set.id}`}
                      className={inol > 0 ? 'text-[var(--cal-muted)]' : 'text-[var(--cal-muted-soft)]'}
                    >
                      {inol > 0 ? inol.toFixed(2) : '—'}
                    </span>
                  </td>
                  </>) : (
                    <>
                      {/* No log set yet: keep the gridlines, cells stay read-only until "Add set" fills this row. */}
                      {Array.from({ length: 7 }).map((_, cell) => (cell === 3
                        ? <td key="nolog-gap" className="sheet-gap" aria-hidden="true" />
                        : <td key={`nolog-${cell}`} data-grid-pos={cell < 3 ? `${laneIndex}:${cell + 4}` : undefined} className="sheet-td sheet-td--readonly h-9" aria-label={cell === 0 ? 'No log set' : undefined} />
                      ))}
                    </>
                  )}
                  <td className="w-[7.5rem] whitespace-nowrap bg-[var(--cal-surface-card)] px-1 align-middle">
                    <div className="flex items-center gap-0.5">
                    {hasPlan ? (<>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => syncTarget(planIndex, laneIndex)}
                      className={actionButton}
                      data-tip="Copy plan to log"
                      aria-label={`Copy plan set ${laneIndex + 1} to log`}
                    >
                      <ArrowRight size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={locked || !canEditPlan || !hasPlan}
                      onClick={() => duplicateSet(planIndex, 'plan')}
                      className={actionButton}
                      aria-label={`Copy plan set ${laneIndex + 1}`}
                      data-tip="Copy this set"
                    >
                      <Copy size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Copy plan set</span>
                    </button>
                    </>) : null}
                    {hasLog ? (<>
                    <button
                      type="button"
                      disabled={locked || !hasLog}
                      onClick={() => duplicateSet(logIndex, 'log')}
                      className={actionButton}
                      aria-label={`Copy log set ${laneIndex + 1}`}
                      data-tip="Copy this log set"
                    >
                      <Copy size={12} strokeWidth={2} aria-hidden="true" />
                      <span className="sr-only">Copy log set</span>
                    </button>
                    </>) : null}
                    {/* The tip sits on a wrapper so it still explains a disabled button. */}
                    <span
                      className="inline-flex"
                      data-tip={hasPlan && !canEditPlan && !locked
                        ? "You can't delete planned sets. Clear the log cells instead."
                        : 'Delete this set (plan and log)'}
                    >
                      <button
                        type="button"
                        disabled={locked || (hasPlan && !canEditPlan)}
                        onClick={() => deleteRow(laneIndex)}
                        className={actionButton}
                        aria-label={`Delete set ${laneIndex + 1}`}
                        data-testid={`delete-set-${id}-${laneIndex + 1}`}
                      >
                        <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </span>
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
        {!locked ? (
          <tfoot>
            <tr>
              {/* One "add row" strip across # → Log: it adds both halves, and it is as wide as the grid on any screen. */}
              <td colSpan={9} className="p-0 pt-1">
                <button
                  type="button"
                  data-testid={`add-set-${id}`}
                  aria-label="Add set"
                  onClick={addSet}
                  title={canEditPlan ? `Add a blank set (plan and log) to ${title}` : `Add a blank log set to ${title}`}
                  className="sheet-add-row"
                >
                  <Plus size={12} strokeWidth={2} aria-hidden="true" />
                  <span>Add set</span>
                </button>
              </td>
              <td colSpan={5} />
            </tr>
          </tfoot>
        ) : null}
      </table>
      {rangeBox ? (
        <div
          aria-hidden="true"
          data-testid={`set-grid-range-${id}`}
          className="sheet-range-box"
          style={{ left: rangeBox.left, top: rangeBox.top, width: rangeBox.width, height: rangeBox.height }}
        />
      ) : null}
      </div>
      {gridNotice ? (
        <p role="status" data-testid={`set-grid-notice-${id}`} className="flex flex-wrap items-center gap-2 px-1 text-[13px] text-[var(--cal-muted)]">
          <span>{gridNotice.text}</span>
          {gridNotice.action ? (
            <button
              type="button"
              data-testid={`set-grid-notice-action-${id}`}
              onClick={gridNotice.action.run}
              className="cal-dock-btn cal-dock-btn--main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
            >
              {gridNotice.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setGridNotice(null)}
            className="ml-auto text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
          >
            Dismiss
          </button>
        </p>
      ) : null}
      </div>
      {/* Lift totals + note: wide card = totals in a column right of the grid with the note under them; narrow = one compact row under the grid (index.css .lift-layout). */}
      <aside className="lift-side" data-testid={`lift-side-${id}`}>
        {liftStats('stacked')}
        <div className="lift-note">
        {onUpdateMeta && (noteOpen || noteDraft.trim()) ? (
          <section className="w-full" data-testid={`lift-note-panel-${id}`}>
            {noteOpen ? (
              <div className="flex flex-col gap-1">
                <textarea
                  data-testid={`lift-note-${id}`}
                  aria-label="Lift note"
                  autoFocus
                  value={noteDraft}
                  disabled={locked || noteSaving}
                  onChange={(event) => {
                    setNoteDraft(event.target.value);
                    setNoteStatus('idle');
                  }}
                  onBlur={(event) => {
                    // Save when leaving the note, unless focus moved to its own Save button.
                    if ((event.relatedTarget as HTMLElement | null)?.dataset?.testid === `save-lift-note-${id}`) return;
                    void saveLiftNote().then(() => setNoteOpen(false));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      (event.currentTarget as HTMLTextAreaElement).blur();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setNoteDraft(liftNote ?? '');
                      setNoteOpen(false);
                    }
                  }}
                  placeholder="Cues, setup, how it felt…"
                  rows={Math.min(6, Math.max(2, noteDraft.split('\n').length))}
                  className="w-full resize-none rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-canvas)] px-3 py-2 text-sm leading-5 text-[var(--cal-ink)] placeholder:text-[var(--cal-muted-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:opacity-50"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--cal-muted)]">Saves when you click away · Ctrl+Enter</span>
                  <button
                    type="button"
                    data-testid={`save-lift-note-${id}`}
                    disabled={locked || noteSaving}
                    onClick={() => void saveLiftNote().then(() => setNoteOpen(false))}
                    className={headerButton}
                  >
                    {noteSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid={`open-lift-note-${id}`}
                disabled={locked}
                onClick={() => setNoteOpen(true)}
                className="flex w-full min-w-0 items-center gap-2 rounded-[var(--cal-radius-md)] px-2 py-1 text-left text-[13px] text-[var(--cal-body)] hover:bg-[var(--cal-surface-soft)] disabled:opacity-60"
                title="Edit note"
              >
                <StickyNote size={13} aria-hidden="true" className="shrink-0 text-[var(--cal-muted)]" />
                <span className="truncate">{noteDraft}</span>
                <span
                  className={`ml-auto shrink-0 text-xs ${noteStatus === 'error' ? 'text-[var(--cal-error)]' : 'text-[var(--cal-success)]'}`}
                  role={noteStatus === 'error' ? 'alert' : undefined}
                >
                  {noteStatus === 'error' ? 'Save failed' : noteStatus === 'saved' ? 'Saved' : ''}
                </span>
              </button>
            )}
          </section>
        ) : null}
        {onUpdateMeta && !noteOpen && !noteDraft.trim() ? (
          <button
            type="button"
            data-testid={`add-lift-note-${id}`}
            disabled={locked}
            onClick={() => setNoteOpen(true)}
            className={headerButton}
          >
            <Plus size={13} aria-hidden="true" />
            Note
          </button>
        ) : null}
        </div>
      </aside>
      </>
      ) : null}
      </div>
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
              disabled={locked || (editCategory === 'User Defined' && !editCustomName.trim())}
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
              className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-40"
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
            {editCategory === 'User Defined' && !editCustomName.trim() ? (
              <p role="alert" data-testid="edit-lift-name-error" className="text-xs text-[var(--cal-error)]">Enter an exercise name before saving.</p>
            ) : null}
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
        className="flex h-9 w-16 items-center justify-end px-3 text-sm tnum text-[var(--cal-muted)]"
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
      widthClass="w-16"
      step={1}
      suffix="%"
      grid={grid}
    />
  );
}

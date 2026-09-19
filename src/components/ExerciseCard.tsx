import { useState, useEffect } from 'react';
import { ArrowRight, Trash2, Copy } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor, MovementPatternSelect } from './PrescriptionEditor';
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
  type CellMode,
  type MoveKind,
  type NeighborDir,
  type SetGridBind,
} from '../services/sheetsCellKeyboard';
import {
  applyLiftAdj,
  applySetDropPercent,
  formatLiftAdjPreview,
  formatSignedDelta,
  LIFT_ADJ_COPY,
  LIFT_ADJ_KG_STEP,
  LIFT_ADJ_PCT_STEP,
  liftAdjDisabledReason,
  parseDropPercent,
  parseSignedDelta,
  planKgOfferKg,
  previewLiftAdj,
  refreshSetAnchors,
  type LiftAdjMode,
} from '../services/setPrescription';
import type { LiftMetaPatch } from '../types';
import type { MovementPattern } from '../services/exerciseCatalog';

export const ExerciseCard = ({ 
  id,
  title, 
  variation, 
  tags: _tags, 
  tier,
  liftCategory = 'Other',
  movementPattern,
  initialSets,
  onUpdateSets,
  onUpdateMeta,
  onRemove,
  onMoveUp,
  onMoveDown,
  locked = false,
  roleMode: _roleMode = 'coach'
}: { 
  id: string,
  title: string, 
  variation: string, 
  tags: string[], 
  tier?: 'Comp' | 'Variation' | 'Accessory',
  liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other',
  movementPattern?: MovementPattern,
  initialSets: any[],
  onUpdateSets: (sets: any[]) => void,
  onUpdateMeta?: (patch: LiftMetaPatch) => void,
  onRemove?: () => void | Promise<void>,
  onMoveUp?: () => void | Promise<void>,
  onMoveDown?: () => void | Promise<void>,
  locked?: boolean,
  roleMode?: 'coach' | 'athlete',
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
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjMode, setAdjMode] = useState<LiftAdjMode>('pct');
  const [adjDraft, setAdjDraft] = useState('0');
  const [grid, setGrid] = useState<{
    row: number;
    col: number;
    mode: CellMode;
    overwrite: boolean;
    seed?: string;
  } | null>(null);

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

  const duplicateSet = (index: number) => {
    const set = sets[index];
    const newSets = [...sets];
    newSets.splice(index + 1, 0, {
      ...set,
      id: `s-${Math.random().toString(36).slice(2, 12)}`,
      isTop: false,
      plannedWeight: null,
      suggestedWeight: null,
      dropPercent: 0,
      actual: null,
      reps: null,
      executedRpe: null,
      isAuto: false,
    });
    updateAndPropagate(newSets);
  };

  const deleteSet = (index: number) => {
    const newSets = sets.filter((_, i) => i !== index);
    updateAndPropagate(newSets);
  };

  const syncTarget = (index: number) => {
    if (locked) return;
    const set = sets[index];
    const kg = trainingNumber(set.plannedWeight);
    updateSet(index, { 
      actual: kg,
      reps: trainingInt(set.plannedReps),
      executedRpe: set.intensity_type === 'PERCENT' ? null : trainingNumber(set.plannedRpe),
      isAuto: false
    });
  };

  const totalVolume = sets.reduce((acc, s) => acc + (trainingOrZero(s.actual) * trainingIntOrZero(s.reps)), 0);

  const addSet = () => {
    const previous = sets[sets.length - 1];
    updateAndPropagate([...sets, {
      id: `s-${Math.random().toString(36).slice(2, 12)}`,
      label: `Set ${sets.length + 1}`,
      plannedWeight: null,
      plannedReps: previous?.plannedReps ?? null,
      plannedRpe: previous?.plannedRpe ?? previous?.target_value ?? null,
      intensity_type: previous?.intensity_type || 'RPE',
      target_value: previous?.target_value ?? previous?.plannedRpe ?? null,
      dropPercent: 0,
      isTop: false,
      isAuto: false,
      actual: null,
      reps: null,
      executedRpe: null
    }]);
  };

  const bindGrid = (row: number, col: number): SetGridBind => ({
    cellId: makeCellId(id, row, col),
    row,
    col,
    isActive: grid?.row === row && grid?.col === col,
    mode: grid?.row === row && grid?.col === col ? grid.mode : 'selected',
    editOverwrite: grid?.overwrite ?? false,
    editSeed: grid?.seed,
    tabStop: (grid == null && row === 0 && col === 0) || (grid?.row === row && grid?.col === col),
    onSelect: (nextRow, nextCol) => {
      setGrid({ row: nextRow, col: nextCol, mode: 'selected', overwrite: false });
    },
    onBeginEdit: (nextRow, nextCol, overwrite, seed) => {
      setGrid({ row: nextRow, col: nextCol, mode: 'editing', overwrite, seed });
    },
    onCommit: (nextRow, nextCol, _value, move, kind) => {
      if (move && kind) {
        const next = neighbor(addressFrom(id, nextRow, nextCol), move, kind, sets.length);
        setGrid({ row: next.row, col: colOf(next), mode: 'selected', overwrite: false });
        return;
      }
      setGrid({ row: nextRow, col: nextCol, mode: 'selected', overwrite: false });
    },
    onCancel: (nextRow, nextCol) => {
      setGrid({ row: nextRow, col: nextCol, mode: 'selected', overwrite: false });
    },
    onMove: (nextRow, nextCol, direction: NeighborDir, kind: MoveKind) => {
      const next = neighbor(addressFrom(id, nextRow, nextCol), direction, kind, sets.length);
      setGrid({ row: next.row, col: colOf(next), mode: 'selected', overwrite: false });
    },
  });

  const td = "px-2 py-0.5 align-middle whitespace-nowrap";
  const th = "px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-[var(--cal-muted)] whitespace-nowrap";
  const sep = (ch: string) => (
    <span className="text-[10px] text-[var(--cal-muted-soft)] select-none" aria-hidden="true">{ch}</span>
  );
  const adjDisabled = locked ? null : liftAdjDisabledReason(sets);
  const adjDelta = parseSignedDelta(adjDraft) ?? 0;
  const { preview: adjPreview, patches: adjPatches } = previewLiftAdj(sets, adjMode, adjDelta);
  const nudgeAdj = (dir: 1 | -1) => {
    const step = adjMode === 'kg' ? LIFT_ADJ_KG_STEP : LIFT_ADJ_PCT_STEP;
    const current = parseSignedDelta(adjDraft) ?? 0;
    const next = adjMode === 'kg'
      ? Math.round((current + dir * step) * 10) / 10
      : Math.round(current + dir * step);
    setAdjDraft(formatSignedDelta(next));
  };
  const applyAdj = () => {
    if (locked || adjPatches.length === 0) return;
    updateAndPropagate(applyLiftAdj(sets, adjPatches));
    setAdjOpen(false);
  };

  const commitDropPercent = (index: number, pct: number) => {
    if (locked || index <= 0) return;
    updateAndPropagate(applySetDropPercent(sets, index, pct));
  };

  return (
    <div className="cal-nested-card cal-nested-flush mx-2 mb-2 overflow-hidden">
      <div className="px-2 min-h-8 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-start gap-2 min-w-0">
          <h4 className="text-lg leading-7 font-semibold tracking-tight text-[var(--cal-ink)] truncate">{title}</h4>
          <span className="text-xs text-[var(--cal-muted)] truncate">
            {tier ? `${tier} · ${variation}` : variation}
          </span>
          {movementPattern ? (
            <span
              className="text-xs text-[var(--cal-muted)] truncate"
              data-testid={`movement-pattern-label-${id}`}
            >
              {movementPattern}
            </span>
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
            <span className="text-xs tnum text-[var(--cal-muted)]">{totalVolume.toLocaleString()} kg</span>
          </div>
          {!locked ? (
          <>
          <button
            type="button"
            data-testid={`lift-adj-${id}`}
            disabled={adjDisabled != null}
            title={adjDisabled ?? 'Adj remaining unlogged Plan kg'}
            aria-label="Adj"
            onClick={() => {
              if (adjDisabled) return;
              setAdjMode('pct');
              setAdjDraft('0');
              setAdjOpen(true);
            }}
            className="h-6 px-1.5 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
          >
            Adj
          </button>
          <button type="button" onClick={addSet} className="h-6 px-1.5 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)]">
            + Set
          </button>
          </>
          ) : null}
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
      <div className="overflow-x-auto">
      <table role="grid" aria-label="Plan and log sets" className="text-left border-collapse w-max max-w-full">
        <thead>
          <tr className="border-b border-[var(--cal-hairline-soft)]">
            <th className={`${th} w-6`}>#</th>
            <th className={`${th} w-14`}>%</th>
            <th className={`${th} pr-3`}>
              <span className="text-[var(--cal-muted)]">Plan</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[var(--cal-muted-soft)]">kg × reps @</span>
            </th>
            <th className={`${th} w-6 px-1`} aria-label="Copy plan to log" />
            <th className={`${th} pl-3 border-l border-[var(--cal-hairline-soft)]`}>
              <span className="text-[var(--cal-muted)]">Log</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[var(--cal-muted-soft)]">kg × reps @ RPE</span>
            </th>
            <th className={th}>Δ</th>
            <th className={th}>e1RM</th>
            <th className={th}>INOL</th>
            <th className={`${th} w-10`} aria-label="Set actions" />
          </tr>
        </thead>
        <tbody>
            {sets.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-3 text-xs text-[var(--cal-muted-soft)]">
                  No sets programmed.
                </td>
              </tr>
            )}
            {sets.map((set, i) => {
              const weight = trainingOrZero(set.actual);
              const reps = trainingIntOrZero(set.reps);
              const rpe = trainingOrZero(set.executedRpe);
              const e1RM = calculateE1RM(weight, reps, rpe);
              const intensityPct = e1RM > 0 ? (weight / e1RM) * 100 : 0;
              const inol = e1RM > 0 && reps > 0 ? calculateINOL(reps, intensityPct) : 0;
              
              const isOvershoot = rpe > trainingOrZero(set.plannedRpe ?? set.rpe);
              const isUndershoot = rpe > 0 && rpe < trainingOrZero(set.plannedRpe ?? set.rpe);
              
              const rowHighlight = isOvershoot 
                ? 'bg-orange-500/10' 
                : isUndershoot 
                  ? 'bg-mac-green/10' 
                  : set.isTop ? 'bg-[color-mix(in_srgb,var(--cal-accent)_5%,transparent)]' : 'hover:bg-[var(--cal-surface-soft)]';

              const actualWt = trainingOrZero(set.actual);
              const plannedWt = trainingOrZero(set.plannedWeight);
              const wtDelta = actualWt > 0 && plannedWt > 0 ? (actualWt - plannedWt) : null;
              const offerKg = planKgOfferKg(set.suggestedWeight, set.plannedWeight);

              const actualRp = trainingOrZero(set.executedRpe);
              const targetRpVal = trainingOrZero(set.plannedRpe);
              const rpeDelta = actualRp > 0 && targetRpVal > 0 ? (actualRp - targetRpVal) : null;

              return (
                <tr key={`${i}-${set.label}`} className={`group ${rowHighlight}`}>
                  <td className={`${td} w-6 tnum text-[10px] text-[var(--cal-muted)]`}>{i + 1}</td>
                  <td className={`${td} w-14`}>
                    {i === 0 ? (
                      <span className="text-[11px] tnum text-[var(--cal-muted-soft)]" aria-hidden="true">—</span>
                    ) : (
                      <DropPercentCell
                        value={trainingInt(set.dropPercent) ?? 0}
                        locked={locked}
                        onCommit={(pct) => commitDropPercent(i, pct)}
                        onTabToPlan={() => {
                          setGrid({ row: i, col: 0, mode: 'selected', overwrite: false });
                        }}
                      />
                    )}
                  </td>
                  <td className={`${td} pr-3`}>
                    {!locked ? (
                      <div className="flex items-center gap-0.5 whitespace-nowrap">
                          <PrescriptionEditor
                            reps={set.plannedReps}
                            intensityType={set.intensity_type || "RPE"}
                            targetValue={set.target_value}
                            weight={set.plannedWeight}
                            rowIndex={i}
                            liftId={id}
                            kgGrid={bindGrid(i, 0)}
                            repsGrid={bindGrid(i, 1)}
                            rpeGrid={bindGrid(i, 2)}
                            onChange={(updates) => updateSet(i, {
                              plannedReps: updates.reps !== undefined ? updates.reps : set.plannedReps,
                              intensity_type: updates.intensityType !== undefined ? updates.intensityType : set.intensity_type,
                              target_value: updates.targetValue !== undefined ? updates.targetValue : set.target_value,
                              plannedRpe: updates.targetValue !== undefined ? updates.targetValue : set.plannedRpe,
                              plannedWeight: updates.weight !== undefined ? updates.weight : set.plannedWeight
                            })}
                          />
                          {offerKg != null ? (
                            <button
                              type="button"
                              data-testid="plan-suggest"
                              onClick={() => updateSet(i, { plannedWeight: offerKg, isAuto: false })}
                              className="h-6 px-1 text-[10px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                              title="Use kg from the set you just logged"
                            >
                              use {offerKg}
                            </button>
                          ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[11px] tnum whitespace-nowrap">
                          <span className="text-[var(--cal-ink)]">{set.plannedWeight != null ? `${set.plannedWeight} kg` : '—'}</span>
                          {sep('×')}
                          <span>{set.plannedReps}</span>
                          {sep('@')}
                          <span>{set.target_value}{set.intensity_type === "PERCENT" ? "%" : " RPE"}</span>
                      </div>
                    )}
                  </td>
                  <td className={`${td} px-1`}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => syncTarget(i)}
                      className="h-6 w-5 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
                      title="Copy plan to log"
                    >
                      <ArrowRight size={12} />
                    </button>
                  </td>
                  <td className={`${td} pl-3 border-l border-[var(--cal-hairline-soft)]`}>
                    {locked ? (
                      <div className="flex items-center gap-1 text-[11px] tnum whitespace-nowrap">
                        <span className="text-[var(--cal-ink)]">{set.actual ?? '—'}</span>
                        {sep('×')}
                        <span>{set.reps ?? '—'}</span>
                        {sep('@')}
                        <span>{set.executedRpe ?? '—'}</span>
                      </div>
                    ) : (
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.actual)}
                        onChange={(val) => updateSet(i, { actual: trainingNumber(val), isAuto: !val })}
                        placeholder="—"
                        fieldKey={`${id}-actual-weight`}
                        label="Log Weight"
                        widthClass="w-12"
                        isLogged={true}
                        isAuto={false}
                        suggestedValue={null}
                        step={2.5}
                        rowIndex={i}
                        grid={bindGrid(i, 3)}
                      />
                      {sep('×')}
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.reps)}
                        onChange={(val) => updateSet(i, { reps: trainingInt(val) })}
                        placeholder="—"
                        fieldKey={`${id}-reps`}
                        label="Log Reps"
                        widthClass="w-8"
                        isLogged={true}
                        step={1}
                        rowIndex={i}
                        grid={bindGrid(i, 4)}
                      />
                      {sep('@')}
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.executedRpe)}
                        onChange={(val) => updateSet(i, { executedRpe: trainingNumber(val) })}
                        placeholder="—"
                        fieldKey={`${id}-executedRpe`}
                        label="Log RPE"
                        widthClass="w-8"
                        isLogged={true}
                        step={0.5}
                        rowIndex={i}
                        grid={bindGrid(i, 5)}
                      />
                    </div>
                    )}
                  </td>
                  <td className={`${td} tnum text-[10px] text-[var(--cal-muted)]`}>
                    {wtDelta !== null ? `${wtDelta > 0 ? '+' : ''}${wtDelta}` : '—'}
                    {rpeDelta !== null ? ` ${rpeDelta > 0 ? '+' : ''}${rpeDelta}r` : ''}
                  </td>
                  <td className={`${td} tnum text-[11px]`} data-testid={`set-metrics-${set.id}`}>
                    <span data-testid={`set-e1rm-${set.id}`} className={e1RM > 0 ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}>
                      {e1RM > 0 ? Math.round(e1RM) : '—'}
                    </span>
                  </td>
                  <td className={`${td} tnum text-[11px]`}>
                    <span
                      data-testid={`set-inol-${set.id}`}
                      className={inol > 0 ? 'text-[var(--cal-muted)]' : 'text-[var(--cal-muted-soft)]'}
                    >
                      {inol > 0 ? inol.toFixed(2) : '—'}
                    </span>
                  </td>
                  <td className={td}>
                    <div className="flex items-center justify-end">
                      <button 
                        type="button"
                        disabled={locked}
                        onClick={() => duplicateSet(i)}
                        className="h-6 w-5 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-40"
                        title="Duplicate set"
                      >
                        <Copy size={11} />
                      </button>
                      <button 
                        type="button"
                        disabled={locked}
                        onClick={() => deleteSet(i)}
                        className="h-6 w-5 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-error)] disabled:opacity-40"
                        title="Delete set"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      </div>
      {adjOpen && !locked ? (
        <CenteredDialog
          title="Adj"
          subtitle={LIFT_ADJ_COPY.scope}
          onClose={() => setAdjOpen(false)}
          onSubmit={applyAdj}
          testId="lift-adj-dialog"
          footer={(
            <>
              <button
                type="button"
                data-testid="lift-adj-cancel"
                onClick={() => setAdjOpen(false)}
                className="h-8 px-3 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="lift-adj-apply"
                className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)]"
              >
                Apply
              </button>
            </>
          )}
        >
          <NestedCard testId="lift-adj-card">
          <div className="flex flex-col gap-3">
            <div className="inline-flex self-start border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)]" role="group" aria-label="Adj mode">
              <button
                type="button"
                data-testid="lift-adj-mode-kg"
                aria-pressed={adjMode === 'kg'}
                onClick={() => { setAdjMode('kg'); setAdjDraft('0'); }}
                className={`h-7 px-2 text-[11px] ${adjMode === 'kg' ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted)]'}`}
              >
                kg
              </button>
              <button
                type="button"
                data-testid="lift-adj-mode-pct"
                aria-pressed={adjMode === 'pct'}
                onClick={() => { setAdjMode('pct'); setAdjDraft('0'); }}
                className={`h-7 px-2 text-[11px] ${adjMode === 'pct' ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted)]'}`}
              >
                %
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="lift-adj-dec"
                onClick={() => nudgeAdj(-1)}
                className="h-8 w-8 text-sm text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                aria-label="Decrease"
              >
                −
              </button>
              <input
                data-testid="lift-adj-value"
                type="text"
                inputMode="decimal"
                value={adjDraft}
                onChange={(event) => setAdjDraft(event.target.value)}
                onBlur={() => {
                  const parsed = parseSignedDelta(adjDraft);
                  setAdjDraft(formatSignedDelta(parsed ?? 0));
                }}
                className="h-8 w-20 px-2 text-center text-xs tnum text-[var(--cal-ink)] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)]"
                aria-label="Adj amount"
              />
              <button
                type="button"
                data-testid="lift-adj-inc"
                onClick={() => nudgeAdj(1)}
                className="h-8 w-8 text-sm text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                aria-label="Increase"
              >
                +
              </button>
            </div>
            {adjPreview ? (
              <p data-testid="lift-adj-preview" className="text-xs tnum text-[var(--cal-muted)]">
                {formatLiftAdjPreview(adjPreview)}
              </p>
            ) : (
              <p data-testid="lift-adj-preview" className="text-xs text-[var(--cal-muted-soft)]">
                Nothing to apply at this value.
              </p>
            )}
          </div>
          </NestedCard>
        </CenteredDialog>
      ) : null}
      {editOpen && onUpdateMeta && (
        <CenteredDialog
          title={`Edit lift · ${title}`}
          subtitle="Pattern, bar, tempo, ROM, and gear. The compiled name stays readonly."
          onClose={() => setEditOpen(false)}
          testId="edit-lift-dialog"
          footer={(
            <button
              type="button"
              data-testid="edit-lift-done"
              onClick={() => setEditOpen(false)}
              className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)]"
            >
              Done
            </button>
          )}
        >
          <div className="flex flex-col gap-2">
            <NestedCard testId={`edit-lift-constructor-${id}`}>
              <LiftVariationPicker
                title={title}
                variation={variation}
                liftCategory={liftCategory}
                locked={locked}
                onChange={(next) => onUpdateMeta(next)}
              />
            </NestedCard>
            <NestedCard testId={`edit-lift-pattern-${id}`}>
              <MovementPatternSelect
                id={`edit-${id}`}
                value={movementPattern}
                locked={locked}
                onChange={(next) => onUpdateMeta({ movementPattern: next })}
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
  onTabToPlan,
}: {
  value: number;
  locked: boolean;
  onCommit: (pct: number) => void;
  onTabToPlan: () => void;
}) {
  const [draft, setDraft] = useState(dropPercentDisplay(value));

  useEffect(() => {
    setDraft(dropPercentDisplay(value));
  }, [value]);

  const commitDraft = (raw: string) => {
    onCommit(parseDropPercent(raw));
  };

  if (locked) {
    return (
      <span
        className="text-[11px] tnum text-[var(--cal-muted)]"
        data-testid="set-drop-pct"
      >
        {dropPercentDisplay(value) || '—'}
      </span>
    );
  }

  return (
    <input
      data-testid="set-drop-pct"
      type="text"
      inputMode="decimal"
      tabIndex={-1}
      value={draft}
      placeholder="—"
      aria-label="Set percent"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commitDraft(draft)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key === 'Process') return;
        if (event.key === 'Tab') {
          event.preventDefault();
          commitDraft(draft);
          onTabToPlan();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          commitDraft(draft);
          event.currentTarget.blur();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(dropPercentDisplay(value));
          event.currentTarget.blur();
        }
      }}
      className="h-6 w-10 px-0.5 text-center text-[11px] tnum text-[var(--cal-ink)] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] rounded-sm focus:outline-none focus:border-[var(--cal-accent)] placeholder:text-[var(--cal-muted-soft)]"
    />
  );
}

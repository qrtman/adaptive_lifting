import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Settings, Plus } from 'lucide-react';
import type { ExerciseData, SetData } from '../types';
import { calculateE1RM } from '../utils/mathUtils';
import { computeExerciseBlockMetrics, formatKg } from '../utils/exerciseMetrics';
import { createAdHocSet, duplicatePrescriptionSet, pickLogFields, pickPrescriptionFields, reorderSets } from '../utils/setRowUtils';
import { useSpreadsheetNavigation } from './useSpreadsheetNavigation';
import { ExerciseSetRow } from './ExerciseSetRow';

export interface ExerciseCardProps {
  key?: string;
  exercise: ExerciseData;
  roleMode: 'coach' | 'athlete';
  onUpdateSets: (sets: SetData[]) => void;
  onOpenPrescription: () => void;
}

export function ExerciseCard({
  exercise,
  roleMode: _roleMode,
  onUpdateSets,
  onOpenPrescription,
}: ExerciseCardProps) {
  const rowRefs = useRef<HTMLTableRowElement[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [autoAdjustPopover, setAutoAdjustPopover] = useState<{idx: number, suggestedWeight: number, suggestedE1RM: number, currentWeight: number, currentE1RM: number} | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const setIds = useMemo(() => exercise.sets.map((s) => s.id), [exercise.sets]);
  const activeDragIdx = activeDragId ? exercise.sets.findIndex((s) => s.id === activeDragId) : -1;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const applyAutoAdjust = (startIdx: number, updateAll: boolean) => {
    if (!autoAdjustPopover) return;
    const updated = [...exercise.sets];

    const applyToSet = (i: number) => {
      const s = updated[i];
      let newWeight = 0;
      if (s.intensity_type === 'PERCENT' && s.target_value) {
        newWeight = Math.round((autoAdjustPopover.suggestedE1RM * (s.target_value / 100)) / 2.5) * 2.5;
      } else if (s.intensity_type === 'RPE' && s.plannedReps && s.plannedRpe) {
        const prescPct = Math.max(0, 100 - (10 - s.plannedRpe) * 3 - s.plannedReps * 2);
        newWeight = Math.round((autoAdjustPopover.suggestedE1RM * (prescPct / 100)) / 2.5) * 2.5;
      }

      updated[i] = { ...s, baseline_e1rm: Number(autoAdjustPopover.suggestedE1RM.toFixed(1)) };
      if (newWeight > 0) {
        updated[i].plannedWeight = newWeight;
      }
    };

    if (updateAll) {
      for (let i = startIdx; i < updated.length; i++) {
        if (!updated[i].actual) {
          applyToSet(i);
        }
      }
    } else {
      applyToSet(startIdx);
    }

    onUpdateSets(updated);
    setAutoAdjustPopover(null);
  };

  const handleLoggedChange = (idx: number, key: 'actual' | 'reps' | 'executedRpe', val: number | null) => {
    const updated = [...exercise.sets];
    updated[idx] = {
      ...updated[idx],
      [key]: val,
    };
    onUpdateSets(updated);
  };

  const updatePrescription = (idx: number, updates: Partial<SetData>) => {
    const updated = [...exercise.sets];
    const s = { ...updated[idx], ...updates };

    const topSetE1RM = updated[0] ? calculateE1RM(updated[0].actual || 0, updated[0].reps || 0, updated[0].executedRpe || 0) : 0;

    if ('plannedWeight' in updates) {
      if (s.plannedWeight && s.plannedWeight > 0) {
        let impliedE1RM = 0;
        if (s.intensity_type === 'PERCENT' && s.target_value && s.target_value > 0) {
          impliedE1RM = s.plannedWeight / (s.target_value / 100);
        } else if (s.intensity_type === 'RPE' && s.plannedReps && s.plannedRpe) {
          const pPct = Math.max(0, 100 - (10 - s.plannedRpe) * 3 - s.plannedReps * 2);
          impliedE1RM = s.plannedWeight / (pPct / 100);
        }
        if (impliedE1RM > 0) {
          s.baseline_e1rm = Number(impliedE1RM.toFixed(1));
        }
      }
    }

    const baseE1rm = s.baseline_e1rm || topSetE1RM;
    const droppedE1RM = s.dropPercent !== undefined
      ? baseE1rm * (1 + (s.dropPercent / 100))
      : baseE1rm;

    if ('baseline_e1rm' in updates || 'dropPercent' in updates || 'target_value' in updates || 'intensity_type' in updates || 'plannedRpe' in updates || 'plannedReps' in updates) {
      if (baseE1rm > 0) {
        if (s.intensity_type === 'PERCENT' && s.target_value) {
          s.plannedWeight = Math.round((droppedE1RM * (s.target_value / 100)) / 2.5) * 2.5;
        } else if (s.intensity_type === 'RPE' && s.plannedReps && s.plannedRpe) {
          const pPct = Math.max(0, 100 - (10 - s.plannedRpe) * 3 - s.plannedReps * 2);
          s.plannedWeight = Math.round((droppedE1RM * (pPct / 100)) / 2.5) * 2.5;
        }
      }
    }

    updated[idx] = s;
    onUpdateSets(updated);
  };

  const handleAddSet = () => {
    const lastSet = exercise.sets[exercise.sets.length - 1];
    onUpdateSets([...exercise.sets, createAdHocSet(lastSet?.label ?? 'Main Set')]);
  };

  const handleRemoveSet = (idx: number) => {
    onUpdateSets(exercise.sets.filter((_, i) => i !== idx));
  };

  const applyPrescToFollowing = (fromIdx: number) => {
    const source = exercise.sets[fromIdx];
    const presc = pickPrescriptionFields(source);
    const updated = exercise.sets.map((set, i) => (
      i <= fromIdx ? set : { ...set, ...presc }
    ));
    onUpdateSets(updated);
  };

  const applyLogToFollowing = (fromIdx: number) => {
    const source = exercise.sets[fromIdx];
    const log = pickLogFields(source);
    const updated = exercise.sets.map((set, i) => (
      i <= fromIdx ? set : { ...set, ...log }
    ));
    onUpdateSets(updated);
  };

  const moveSet = useCallback((fromIdx: number, toIdx: number) => {
    onUpdateSets(reorderSets(exercise.sets, fromIdx, toIdx));
  }, [exercise.sets, onUpdateSets]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over || active.id === over.id) return;

    const oldIndex = exercise.sets.findIndex((s) => s.id === active.id);
    const newIndex = exercise.sets.findIndex((s) => s.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onUpdateSets(arrayMove(exercise.sets, oldIndex, newIndex));
    }
  };

  const metrics = useMemo(
    () => computeExerciseBlockMetrics(exercise.sets),
    [exercise.sets],
  );

  const inolClass = metrics.inolRisk === 'high'
    ? 'exercise-card__metric-val--danger'
    : metrics.inolRisk === 'moderate'
      ? 'exercise-card__metric-val--warn'
      : '';

  const {
    activeCell,
    handleKeyDown,
    handleFocusSelect,
    handleDoubleClickAppend,
    handleSubcellMouseDown,
    handleInputClick,
    handleSubcellClick,
    handleCellClick,
  } = useSpreadsheetNavigation({
    sets: exercise.sets,
    updatePrescription,
    rowRefs,
    cardRef,
    exerciseScopeId: exercise.id,
    onMoveRow: moveSet,
  });

  return (
    <div ref={cardRef} className="exercise-card ok-tabular p-6 relative mb-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h3 className="exercise-card__title mb-1">{exercise.variation}</h3>
          <span className="exercise-card__subtitle block">
            {exercise.title}
          </span>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="exercise-card__metrics" aria-label="Exercise block metrics">
            <span className="exercise-card__metric">
              <span className="exercise-card__metric-label">tonnage</span>
              <span className="exercise-card__metric-val">{formatKg(metrics.execTonnage)}</span>
            </span>
            <span className="exercise-card__metric-sep" aria-hidden>·</span>
            <span className="exercise-card__metric">
              <span className="exercise-card__metric-label">avg intensity</span>
              <span className="exercise-card__metric-val">
                {metrics.avgIntensityPct != null ? `${metrics.avgIntensityPct.toFixed(0)}%` : '—'}
              </span>
            </span>
            <span className="exercise-card__metric-sep" aria-hidden>·</span>
            <span className="exercise-card__metric">
              <span className="exercise-card__metric-label">INOL</span>
              <span className={`exercise-card__metric-val ${inolClass}`}>
                {metrics.inol > 0 ? metrics.inol.toFixed(2) : '—'}
              </span>
            </span>
            <span className="exercise-card__metric-sep" aria-hidden>·</span>
            <span className="exercise-card__metric">
              <span className="exercise-card__metric-label">e1RM</span>
              <span className="exercise-card__metric-val">
                {metrics.topE1rm > 0 ? metrics.topE1rm.toFixed(1) : '—'}
              </span>
            </span>
          </div>
          <button
            onClick={onOpenPrescription}
            className="p-2 bg-transparent hover:bg-ok-surface-3 text-ok-faint hover:text-ok rounded-md transition-all cursor-pointer"
            title="Prescription settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <div className="exercise-card__table-scroll pb-2">
          <table className="exercise-card__grid ok-tabular text-left whitespace-nowrap">
            <colgroup>
              <col className="ecard-col-set" />
              <col className="ecard-col-reps" />
              <col className="ecard-col-intensity" />
              <col className="ecard-col-weight" />
              <col className="ecard-col-e1rm" />
              <col className="ecard-col-presc-fill" />
              <col className="ecard-col-reps" />
              <col className="ecard-col-rpe" />
              <col className="ecard-col-weight" />
              <col className="ecard-col-e1rm-exec" />
              <col className="ecard-col-actions" />
            </colgroup>
            <thead>
              <tr className="exercise-card__th-col">
                <th className="ecard-th-set">Set</th>
                <th className="text-center ecard-zone--presc-start ecard-th-reps">
                  <span className="ecard-zone-tag">Presc</span>
                  <span className="ecard-th-label">Reps</span>
                </th>
                <th className="text-center ecard-th-intensity">RPE / %</th>
                <th className="text-center ecard-th-weight">Weight</th>
                <th className="text-center ecard-th-e1rm">E1RM</th>
                <th className="ecard-th-presc-fill ecard-zone--split" aria-hidden="true" />
                <th className="text-center ecard-zone--exec-start ecard-th-reps">
                  <span className="ecard-zone-tag">Log</span>
                  <span className="ecard-th-label">Reps</span>
                </th>
                <th className="text-center ecard-th-rpe">RPE</th>
                <th className="text-center ecard-th-weight">Weight</th>
                <th className="text-center ecard-th-e1rm-exec">E1RM</th>
                <th className="ecard-th-actions" aria-hidden="true" />
              </tr>
            </thead>
            <SortableContext items={setIds} strategy={verticalListSortingStrategy}>
              <tbody>
                {exercise.sets.map((s, idx) => (
                  <ExerciseSetRow
                    key={s.id}
                    ref={(el) => { if (el) rowRefs.current[idx] = el; }}
                    s={s}
                    idx={idx}
                    exercise={exercise}
                    activeCell={activeCell}
                    autoAdjustPopover={autoAdjustPopover}
                    setAutoAdjustPopover={setAutoAdjustPopover}
                    updatePrescription={updatePrescription}
                    handleLoggedChange={handleLoggedChange}
                    handleKeyDown={handleKeyDown}
                    handleFocusSelect={handleFocusSelect}
                    handleDoubleClickAppend={handleDoubleClickAppend}
                    handleSubcellMouseDown={handleSubcellMouseDown}
                    handleInputClick={handleInputClick}
                    handleSubcellClick={handleSubcellClick}
                    handleCellClick={handleCellClick}
                    onDuplicate={(index, set) => {
                      const updated = [...exercise.sets];
                      updated.splice(index + 1, 0, duplicatePrescriptionSet(set));
                      onUpdateSets(updated);
                    }}
                    onApplyPrescBelow={applyPrescToFollowing}
                    onApplyLogBelow={applyLogToFollowing}
                    setCount={exercise.sets.length}
                    onDelete={handleRemoveSet}
                    applyAutoAdjust={applyAutoAdjust}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </div>

        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
          {activeDragId && activeDragIdx >= 0 ? (
            <div className="exercise-card__row-drag-overlay">
              Set {activeDragIdx + 1}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="exercise-card__compare mt-4" aria-label="Prescription vs executed comparison">
        <span className="exercise-card__compare-side">
          <span className="exercise-card__compare-tag">Presc</span>
          <span className="exercise-card__compare-val">{formatKg(metrics.prescTonnage)}</span>
          <span className="exercise-card__compare-meta">{metrics.prescSetCount} sets</span>
        </span>
        <span className="exercise-card__compare-arrow" aria-hidden>→</span>
        <span className="exercise-card__compare-side">
          <span className="exercise-card__compare-tag">Exec</span>
          <span className="exercise-card__compare-val">{formatKg(metrics.execTonnage)}</span>
          <span className="exercise-card__compare-meta">{metrics.execSetCount} sets</span>
        </span>
      </div>

      <button
        onClick={handleAddSet}
        className="mt-4 w-full py-3 border border-dashed border-ok hover:bg-ok-surface-2 rounded-[var(--ok-radius-md)] flex items-center justify-center gap-2 text-ok-muted hover:text-ok font-bold uppercase tracking-widest transition-all cursor-pointer"
      >
        <Plus size={14} /> Add Set Record
      </button>
    </div>
  );
}

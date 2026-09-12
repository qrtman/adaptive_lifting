import { useState, useEffect } from 'react';
import { ArrowRight, Trash2, Copy } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor } from './PrescriptionEditor';
import { LiftVariationPicker } from './LiftVariationPicker';
import { CenteredDialog } from './CenteredDialog';
import { 
  calculateE1RM, 
  calculateINOL,
} from '../services/mathEngine';
import { displayTrainingValue, trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from '../services/numericTraining';
import { refreshSetAnchors } from '../services/setPrescription';

export const ExerciseCard = ({ 
  id,
  title, 
  variation, 
  tags: _tags, 
  tier,
  liftCategory = 'Other',
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
  initialSets: any[],
  onUpdateSets: (sets: any[]) => void,
  onUpdateMeta?: (patch: { variation: string; tier: 'Comp' | 'Variation' }) => void,
  onRemove?: () => void | Promise<void>,
  onMoveUp?: () => void | Promise<void>,
  onMoveDown?: () => void | Promise<void>,
  locked?: boolean,
  roleMode?: 'coach' | 'athlete',
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
      isTop: false,
      isAuto: false,
      actual: null,
      reps: null,
      executedRpe: null
    }]);
  };

  const td = "px-2 py-0.5 align-middle whitespace-nowrap";
  const th = "px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-[#636366] whitespace-nowrap";
  const sep = (ch: string) => (
    <span className="text-[10px] text-[#636366] select-none" aria-hidden="true">{ch}</span>
  );

  return (
    <div className="border-b border-white/10">
      <div className="px-2 min-h-8 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-start gap-2 min-w-0">
          <h4 className="text-lg leading-7 text-white truncate">{title}</h4>
          <span className="text-xs text-[#AEAEB2] truncate">
            {tier ? `${tier} · ${variation}` : variation}
          </span>
          {onUpdateMeta ? (
            <button
              type="button"
              data-testid={`edit-lift-${id}`}
              onClick={() => setEditOpen(true)}
              className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white shrink-0"
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">e1RM</span>
            <span className="text-xs font-mono tabular-nums text-[#AEAEB2]">
              {sets[0]?.baseline_e1rm ? Math.round(sets[0].baseline_e1rm) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">Vol</span>
            <span className="text-xs font-mono tabular-nums text-[#AEAEB2]">{totalVolume.toLocaleString()} kg</span>
          </div>
          {!locked ? (
          <button type="button" onClick={addSet} className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white">
            + Set
          </button>
          ) : null}
          {onMoveUp && (
            <button
              type="button"
              data-testid={`move-lift-up-${id}`}
              disabled={locked}
              onClick={() => void onMoveUp()}
              className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white disabled:opacity-40"
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
              className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white disabled:opacity-40"
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
              className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white disabled:opacity-40"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
      <table className="text-left border-collapse w-max max-w-full">
        <thead>
          <tr className="border-b border-white/5">
            <th className={`${th} w-6`}>#</th>
            <th className={`${th} pr-3`}>
              <span className="text-[#AEAEB2]">Plan</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[#636366]">kg × reps @</span>
            </th>
            <th className={`${th} w-6 px-1`} aria-label="Copy plan to log" />
            <th className={`${th} pl-3 border-l border-white/5`}>
              <span className="text-[#AEAEB2]">Log</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[#636366]">kg × reps @ RPE</span>
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
                <td colSpan={8} className="px-2 py-3 text-xs text-[#636366]">
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
                  : set.isTop ? 'bg-mac-blue/5' : 'hover:bg-white/[0.01]';

              const actualWt = trainingOrZero(set.actual);
              const plannedWt = trainingOrZero(set.plannedWeight);
              const wtDelta = actualWt > 0 && plannedWt > 0 ? (actualWt - plannedWt) : null;

              const actualRp = trainingOrZero(set.executedRpe);
              const targetRpVal = trainingOrZero(set.plannedRpe);
              const rpeDelta = actualRp > 0 && targetRpVal > 0 ? (actualRp - targetRpVal) : null;

              return (
                <tr key={`${i}-${set.label}`} className={`group ${rowHighlight}`}>
                  <td className={`${td} w-6 font-mono text-[10px] text-[#AEAEB2]`}>{i + 1}</td>
                  <td className={`${td} pr-3`}>
                    {!locked ? (
                      <div className="flex items-center gap-0.5 whitespace-nowrap">
                          <PrescriptionEditor
                            reps={set.plannedReps}
                            intensityType={set.intensity_type || "RPE"}
                            targetValue={set.target_value}
                            weight={set.plannedWeight}
                            onChange={(updates) => updateSet(i, {
                              plannedReps: updates.reps !== undefined ? updates.reps : set.plannedReps,
                              intensity_type: updates.intensityType !== undefined ? updates.intensityType : set.intensity_type,
                              target_value: updates.targetValue !== undefined ? updates.targetValue : set.target_value,
                              plannedRpe: updates.targetValue !== undefined ? updates.targetValue : set.plannedRpe,
                              plannedWeight: updates.weight !== undefined ? updates.weight : set.plannedWeight
                            })}
                          />
                          {set.suggestedWeight && set.plannedWeight == null ? (
                            <button
                              type="button"
                              data-testid="plan-suggest"
                              onClick={() => updateSet(i, { plannedWeight: set.suggestedWeight })}
                              className="h-6 px-1 text-[10px] text-[#AEAEB2] hover:text-white"
                              title="Use kg from the set you just logged"
                            >
                              use {set.suggestedWeight}
                            </button>
                          ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
                          <span className="text-white">{set.plannedWeight != null ? `${set.plannedWeight} kg` : '—'}</span>
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
                      className="h-6 w-5 flex items-center justify-center text-[#AEAEB2] hover:text-white disabled:opacity-40"
                      title="Copy plan to log"
                    >
                      <ArrowRight size={12} />
                    </button>
                  </td>
                  <td className={`${td} pl-3 border-l border-white/5`}>
                    {locked ? (
                      <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
                        <span className="text-white">{set.actual ?? '—'}</span>
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
                      />
                    </div>
                    )}
                  </td>
                  <td className={`${td} font-mono tabular-nums text-[10px] text-[#AEAEB2]`}>
                    {wtDelta !== null ? `${wtDelta > 0 ? '+' : ''}${wtDelta}` : '—'}
                    {rpeDelta !== null ? ` ${rpeDelta > 0 ? '+' : ''}${rpeDelta}r` : ''}
                  </td>
                  <td className={`${td} font-mono tabular-nums text-[11px]`} data-testid={`set-metrics-${set.id}`}>
                    <span data-testid={`set-e1rm-${set.id}`} className={e1RM > 0 ? 'text-white' : 'text-[#636366]'}>
                      {e1RM > 0 ? Math.round(e1RM) : '—'}
                    </span>
                  </td>
                  <td className={`${td} font-mono tabular-nums text-[11px]`}>
                    <span
                      data-testid={`set-inol-${set.id}`}
                      className={inol > 0 ? 'text-[#AEAEB2]' : 'text-[#636366]'}
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
                        className="h-6 w-5 flex items-center justify-center text-[#AEAEB2] hover:text-white disabled:opacity-40"
                        title="Duplicate set"
                      >
                        <Copy size={11} />
                      </button>
                      <button 
                        type="button"
                        disabled={locked}
                        onClick={() => deleteSet(i)}
                        className="h-6 w-5 flex items-center justify-center text-[#AEAEB2] hover:text-red-400 disabled:opacity-40"
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
      {editOpen && onUpdateMeta && (
        <CenteredDialog
          title={`Edit lift · ${title}`}
          subtitle="Bar, tempo, ROM, and gear. The compiled name stays readonly."
          onClose={() => setEditOpen(false)}
          testId="edit-lift-dialog"
          footer={(
            <button
              type="button"
              data-testid="edit-lift-done"
              onClick={() => setEditOpen(false)}
              className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded"
            >
              Done
            </button>
          )}
        >
          <LiftVariationPicker
            title={title}
            variation={variation}
            liftCategory={liftCategory}
            locked={locked}
            onChange={onUpdateMeta}
          />
        </CenteredDialog>
      )}
    </div>
  );
};

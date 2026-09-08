import { useState, useEffect } from 'react';
import { ArrowRight, Trash2, Copy, Maximize2, Minimize2 } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor } from './PrescriptionEditor';
import { 
  calculateE1RM, 
  anchorE1RMFromPrescription,
  formatPrecedingE1RMDelta,
  precedingLoggedE1RMDelta,
  sumExerciseINOL,
} from '../services/mathEngine';
import { displayTrainingValue, trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from '../services/numericTraining';

export const ExerciseCard = ({ 
  id,
  title, 
  variation, 
  tags: _tags, 
  tier,
  initialSets,
  onUpdateSets,
  roleMode = 'coach'
}: { 
  id: string,
  title: string, 
  variation: string, 
  tags: string[], 
  tier?: 'Comp' | 'Variation' | 'Accessory',
  initialSets: any[],
  onUpdateSets: (sets: any[]) => void,
  roleMode?: 'coach' | 'athlete',
}) => {
  const recalculatePresetsAndSugs = (setArray: any[]) => {
    if (setArray.length === 0) return setArray;

    const first = setArray[0];
    const isPercent = (first.intensity_type || 'RPE') === 'PERCENT';
    const anchor = anchorE1RMFromPrescription(
      first.plannedWeight,
      first.plannedReps,
      isPercent ? first.target_value : (first.plannedRpe ?? first.target_value),
      first.intensity_type || 'RPE',
    );

    return setArray.map((s, index) => {
      let suggestedWeight = s.suggestedWeight;
      const anchorWeight = trainingOrZero(setArray[0].actual ?? setArray[0].plannedWeight);
      if (anchorWeight > 0 && index > 0 && s.isAuto) {
        const drop = s.dropPercent !== undefined ? s.dropPercent : -5;
        suggestedWeight = anchorWeight * (1 + drop / 100);
      }

      return {
        ...s,
        baseline_e1rm: anchor,
        suggestedWeight,
      };
    });
  };

  const mapInitialSets = (setsList: any[]) => {
    const mapped = setsList.map((s, i) => {
      const plannedWeightMatch = s.planned?.match(/(\d+(?:\.\d+)?)/);
      const plannedRepsMatch = s.planned?.match(/x\s*(\d+)/);
      
      const plannedReps = trainingInt(s.plannedReps) ?? (plannedRepsMatch ? trainingInt(plannedRepsMatch[1]) : null);
      const plannedRpe = trainingNumber(s.plannedRpe ?? s.rpe);
      const plannedWeight = trainingNumber(s.plannedWeight) ?? (plannedWeightMatch ? trainingNumber(plannedWeightMatch[1]) : null);
      const rpeVal = plannedRpe || 8;
      const weightVal = plannedWeight || 100;

      const intensity_type = s.intensity_type || "RPE";
      const target_value = s.target_value !== undefined 
        ? s.target_value 
        : (intensity_type === "PERCENT" ? 80 : rpeVal);

      const adjustment_pct = s.adjustment_pct !== undefined 
        ? s.adjustment_pct 
        : (s.dropPercent !== undefined ? s.dropPercent / 100 : 0);

      return {
        ...s,
        plannedWeight: plannedWeight ?? (weightVal > 0 ? weightVal : 137.5),
        plannedReps: plannedReps ?? 4,
        plannedRpe: intensity_type === "RPE" ? target_value : null,
        intensity_type,
        target_value,
        adjustment_pct,
        dropPercent: s.dropPercent !== undefined ? s.dropPercent : (i > 0 ? -5 : 0),
        isAuto: s.isAuto !== undefined ? s.isAuto : (i > 0 && !s.actual),
        actual: trainingNumber(s.actual),
        reps: trainingInt(s.reps),
        executedRpe: trainingNumber(s.executedRpe)
      };
    });
    
    return recalculatePresetsAndSugs(mapped);
  };

  const [sets, setSets] = useState(() => mapInitialSets(initialSets));

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
    newSets.splice(index + 1, 0, { ...set, isTop: false, actual: null, isAuto: true });
    updateAndPropagate(newSets);
  };

  const deleteSet = (index: number) => {
    const newSets = sets.filter((_, i) => i !== index);
    updateAndPropagate(newSets);
  };

  const syncTarget = (index: number) => {
    const set = sets[index];
    const isPercent = set.intensity_type === "PERCENT";
    updateSet(index, {
      actual: trainingNumber(set.plannedWeight),
      reps: trainingInt(set.plannedReps),
      executedRpe: isPercent ? null : trainingNumber(set.plannedRpe ?? set.target_value),
      isAuto: false
    });
  };

  const totalVolume = sets.reduce((acc, s) => acc + (trainingOrZero(s.actual ?? s.suggestedWeight) * trainingIntOrZero(s.reps)), 0);
  const totalInol = sumExerciseINOL(sets);

  const addSet = () => {
    updateAndPropagate([...sets, {
      label: "Additional Set",
      plannedWeight: null,
      plannedReps: null,
      plannedRpe: null,
      isTop: false,
      actual: null,
      reps: null,
      executedRpe: null
    }]);
  };

  const [expanded, setExpanded] = useState(true);

  const isAccessory = tier === 'Accessory';
  const headingName = isAccessory ? title : (variation || title);
  const supportingName = isAccessory ? variation : title;
  const supportingLabel = [isAccessory ? null : tier, supportingName]
    .filter((part) => part && part !== headingName)
    .join(' · ');

  const td = "px-2 py-0.5 align-middle whitespace-nowrap";
  const th = "px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-[#636366] whitespace-nowrap";
  const sep = (ch: string) => (
    <span className="text-[10px] text-[#636366] select-none" aria-hidden="true">{ch}</span>
  );

  const identity = (
    <div className="flex items-baseline gap-2 min-w-0 flex-1 @min-[36rem]:w-44 @min-[36rem]:flex-none @min-[36rem]:flex-col @min-[36rem]:items-start @min-[36rem]:gap-0">
      <h4 className="text-lg leading-7 text-white truncate @min-[36rem]:leading-6 @min-[36rem]:whitespace-normal">{headingName}</h4>
      {supportingLabel ? (
        <span className="text-xs text-[#AEAEB2] truncate @min-[36rem]:whitespace-normal">{supportingLabel}</span>
      ) : null}
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-[10px] uppercase tracking-wider text-[#636366]">e1RM</span>
        <span
          data-testid={`exercise-anchor-e1rm-${id}`}
          className="text-xs font-mono tabular-nums text-[#AEAEB2]"
        >
          {sets[0]?.baseline_e1rm > 0 ? Math.round(sets[0].baseline_e1rm) : '—'}
        </span>
      </div>
    </div>
  );

  const toolbar = (
    <div
      data-testid={`exercise-toolbar-${id}`}
      className="flex items-center gap-x-2 gap-y-0.5 shrink-0 flex-wrap @min-[36rem]:flex-col @min-[36rem]:items-end @min-[36rem]:gap-1"
    >
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-[#636366]">Vol</span>
        <span className="text-xs font-mono tabular-nums text-[#AEAEB2]">{totalVolume.toLocaleString()} kg</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-[#636366]">INOL</span>
        <span
          data-testid={`exercise-inol-${id}`}
          className="text-xs font-mono tabular-nums text-[#AEAEB2]"
        >
          {totalInol > 0 ? totalInol.toFixed(2) : '—'}
        </span>
      </div>
      {expanded && (
        <button type="button" onClick={addSet} className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white">
          + Set
        </button>
      )}
      <button
        type="button"
        data-testid={`exercise-expand-${id}`}
        onClick={() => setExpanded((open) => !open)}
        className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
        title={expanded ? 'Minimize exercise' : 'Maximize exercise'}
      >
        {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        {expanded ? 'Minimize' : 'Maximize'}
      </button>
    </div>
  );

  return (
    <div className="@container border-b border-white/10" data-testid={`exercise-card-${id}`}>
      {expanded ? (
      <div className="px-2 py-1 flex flex-wrap @min-[36rem]:flex-nowrap items-start gap-x-3 gap-y-1">
      {identity}
      <div className="overflow-x-auto min-w-0 w-full @min-[36rem]:flex-1 @min-[36rem]:w-auto order-last @min-[36rem]:order-none">
      <table className="text-left border-collapse w-max max-w-full">
        <thead>
          <tr className="border-b border-white/5">
            <th className={`${th} w-6`}>#</th>
            <th className={`${th} pr-3`}>
              <span className="text-[#AEAEB2]">Rx</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[#636366]">kg × reps @</span>
            </th>
            <th className={`${th} text-right`}>%adj</th>
            <th className={`${th} w-6 px-1`} aria-label="Copy prescription to log" />
            <th className={`${th} pl-3 border-l border-white/5`}>
              <span className="text-[#AEAEB2]">Log</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[#636366]">kg × reps @ RPE</span>
            </th>
            <th className={th}>e1RM</th>
            <th className={`${th} w-10`} aria-label="Set actions" />
          </tr>
        </thead>
        <tbody>
            {sets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-3 text-xs text-[#636366]">
                  No sets programmed.
                </td>
              </tr>
            )}
            {sets.map((set, i) => {
              const isPercent = (set.intensity_type || "RPE") === "PERCENT";
              const weight = trainingOrZero(set.actual ?? set.suggestedWeight);
              const reps = trainingIntOrZero(set.reps);
              const rpe = trainingOrZero(set.executedRpe);
              const percentTarget = trainingOrZero(set.target_value);
              const e1RM = isPercent
                ? (weight > 0 && percentTarget > 0 ? weight / (percentTarget / 100) : 0)
                : calculateE1RM(weight, reps, rpe);

              const e1rmDelta = precedingLoggedE1RMDelta(sets, i);
              const adjPct = set.adjustment_pct !== undefined
                ? Math.round(set.adjustment_pct * 100)
                : (set.dropPercent !== undefined ? Math.round(set.dropPercent) : 0);

              return (
                <tr key={`${i}-${set.label}`} className="group hover:bg-white/[0.01]">
                  <td className={`${td} w-6 font-mono text-[10px] text-[#AEAEB2]`}>{i + 1}</td>
                  <td className={`${td} pr-3`}>
                    {roleMode === 'coach' ? (
                      <div className="flex items-center gap-0.5 whitespace-nowrap">
                          <PrescriptionEditor
                            setId={set.id}
                            reps={set.plannedReps}
                            intensityType={set.intensity_type || "RPE"}
                            targetValue={set.target_value}
                            weight={set.plannedWeight}
                            onChange={(updates) => {
                              const nextType = updates.intensityType !== undefined ? updates.intensityType : set.intensity_type;
                              const nextTarget = updates.targetValue !== undefined ? updates.targetValue : set.target_value;
                              const switchingToPercent = nextType === "PERCENT";
                              updateSet(i, {
                                plannedReps: updates.reps !== undefined ? updates.reps : set.plannedReps,
                                intensity_type: nextType,
                                target_value: nextTarget,
                                plannedWeight: updates.weight !== undefined ? updates.weight : set.plannedWeight,
                                plannedRpe: switchingToPercent ? null : nextTarget,
                                ...(switchingToPercent ? { executedRpe: null } : {})
                              });
                            }}
                          />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
                          <span className="text-white">{set.plannedWeight} kg</span>
                          {sep('×')}
                          <span>{set.plannedReps}</span>
                          {sep('@')}
                          <span>{set.target_value}{set.intensity_type === "PERCENT" ? "%" : " RPE"}</span>
                      </div>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {roleMode === 'coach' ? (
                      <div className="flex items-center justify-end gap-0.5" data-testid={`set-adj-${set.id}`}>
                        <EditablePerformanceCell
                          value={displayTrainingValue(adjPct)}
                          onChange={(val) => {
                            const rawPct = trainingOrZero(val);
                            updateSet(i, { adjustment_pct: rawPct / 100, dropPercent: rawPct });
                          }}
                          placeholder="0"
                          fieldKey={`${id}-adjustment_pct`}
                          label="%adj"
                          widthClass="w-8"
                          step={1}
                          rowIndex={i}
                        />
                        <span className="text-[10px] text-[#636366] select-none" aria-hidden="true">%</span>
                      </div>
                    ) : (
                      <span data-testid={`set-adj-${set.id}`} className="font-mono text-[11px] tabular-nums text-[#AEAEB2]">
                        {adjPct}%
                      </span>
                    )}
                  </td>
                  <td className={`${td} px-1`}>
                    <button
                      type="button"
                      onClick={() => syncTarget(i)}
                      className="h-6 w-5 flex items-center justify-center text-[#AEAEB2] hover:text-white"
                      title="Copy prescription to log"
                    >
                      <ArrowRight size={12} />
                    </button>
                  </td>
                  <td className={`${td} pl-3 border-l border-white/5`}>
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.actual)}
                        onChange={(val) => updateSet(i, { actual: trainingNumber(val), isAuto: !val })}
                        placeholder="—"
                        fieldKey={`${id}-actual-weight`}
                        label="Log Weight"
                        widthClass="w-12"
                        isLogged={true}
                        isAuto={set.isAuto}
                        suggestedValue={set.suggestedWeight ? displayTrainingValue(Math.round(set.suggestedWeight * 4) / 4) : "0"}
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
                      {isPercent ? (
                        <span
                          data-testid={`log-rpe-${set.id}`}
                          className="w-8 h-6 flex items-center justify-center text-[10px] text-[#636366]"
                          title="RPE is not used for % prescriptions"
                        >
                          —
                        </span>
                      ) : (
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
                      )}
                    </div>
                  </td>
                  <td className={`${td} font-mono tabular-nums text-[11px]`} data-testid={`set-metrics-${set.id}`}>
                    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                      <span data-testid={`set-e1rm-${set.id}`} className={e1RM > 0 ? 'text-white' : 'text-[#636366]'}>
                        {e1RM > 0 ? Math.round(e1RM) : '—'}
                      </span>
                      {e1rmDelta !== null ? (
                        <span data-testid={`set-delta-${set.id}`} className="text-[10px] text-[#AEAEB2]">
                          {formatPrecedingE1RMDelta(e1rmDelta)}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className={td}>
                    <div className="flex items-center justify-end">
                      <button 
                        onClick={() => duplicateSet(i)}
                        className="h-6 w-5 flex items-center justify-center text-[#AEAEB2] hover:text-white"
                        title="Duplicate set"
                      >
                        <Copy size={11} />
                      </button>
                      <button 
                        onClick={() => deleteSet(i)}
                        className="h-6 w-5 flex items-center justify-center text-[#AEAEB2] hover:text-red-400"
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
      {toolbar}
      </div>
      ) : (
        <>
          <div className="px-2 min-h-8 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {identity}
            {toolbar}
          </div>
          <p className="px-2 pb-2 text-[10px] text-[#636366]">
            {sets.length} {sets.length === 1 ? 'set' : 'sets'} · Maximize to open
          </p>
        </>
      )}
    </div>
  );
};

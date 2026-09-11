import { useState, useEffect } from 'react';
import { ArrowRight, Trash2, Copy } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor } from './PrescriptionEditor';
import { 
  calculateCapacityScaledWeight, 
  calculateE1RM, 
  calculateINOL,
  calculateWeightFromE1RM 
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

    // Use Set 0 baseline_e1rm as the primary anchor
    const primaryAnchor = setArray[0].baseline_e1rm !== undefined ? trainingOrZero(setArray[0].baseline_e1rm) : 150;

    return setArray.map((s, index) => {
      // Find the most recent E1RM from logged preceding sets
      let prevLogE1RM = 0;
      for (let j = index - 1; j >= 0; j--) {
        const prevSet = setArray[j];
        const prevW = trainingOrZero(prevSet.actual);
        const prevR = trainingIntOrZero(prevSet.reps);
        const prevRp = trainingOrZero(prevSet.executedRpe);
        const calcPrev = calculateE1RM(prevW, prevR, prevRp);
        if (calcPrev > 0) {
          prevLogE1RM = calcPrev;
          break;
        }
      }

      // Determine the active baseline E1RM for this set's prescription calculations:
      const activeE1RM = index === 0
        ? primaryAnchor
        : (prevLogE1RM > 0 ? prevLogE1RM : primaryAnchor);

      // Recalculate planned weight (prescribed weight) using the active E1RM
      const repsVal = trainingInt(s.plannedReps) || 4;
      const computedWeight = calculateCapacityScaledWeight(
        activeE1RM,
        s.intensity_type || "RPE",
        s.target_value !== undefined ? s.target_value : 8,
        repsVal,
        s.adjustment_pct !== undefined ? s.adjustment_pct : 0
      );

      // Log suggested weight (if auto-scale applies for log side)
      let suggestedWeight = s.suggestedWeight;
      const anchorWeight = trainingOrZero(setArray[0].actual ?? setArray[0].plannedWeight);
      if (anchorWeight > 0 && index > 0 && s.isAuto) {
        const drop = s.dropPercent !== undefined ? s.dropPercent : -5;
        suggestedWeight = anchorWeight * (1 + drop / 100);
      }

      return {
        ...s,
        baseline_e1rm: activeE1RM,
        suggestedWeight,
        plannedWeight: computedWeight > 0 ? computedWeight : trainingNumber(s.plannedWeight)
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

      const repsVal = plannedReps || 4;
      const rpeVal = plannedRpe || 8;
      const weightVal = plannedWeight || 100;

      const calculatedBase = calculateE1RM(weightVal, repsVal, rpeVal);
      const baseline_e1rm = s.baseline_e1rm !== undefined ? s.baseline_e1rm : (calculatedBase > 0 ? calculatedBase : 150);

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
        plannedRpe: intensity_type === "RPE" ? target_value : (plannedRpe ?? 8),
        baseline_e1rm,
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
    updateSet(index, { 
      actual: trainingNumber(set.plannedWeight),
      reps: trainingInt(set.plannedReps),
      executedRpe: trainingNumber(set.plannedRpe),
      isAuto: false
    });
  };

  const totalVolume = sets.reduce((acc, s) => acc + (trainingOrZero(s.actual ?? s.suggestedWeight) * trainingIntOrZero(s.reps)), 0);

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

  const td = "px-2 py-0.5 align-middle whitespace-nowrap";
  const th = "px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-[#636366] whitespace-nowrap";
  const sep = (ch: string) => (
    <span className="text-[10px] text-[#636366] select-none" aria-hidden="true">{ch}</span>
  );

  return (
    <div className="border-b border-white/10">
      <div className="px-2 min-h-8 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <h4 className="text-lg leading-7 text-white truncate">{title}</h4>
          <span className="text-xs text-[#AEAEB2] truncate">
            {tier ? `${tier} · ${variation}` : variation}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">e1RM</span>
            {roleMode === 'coach' && sets[0] ? (
              <EditablePerformanceCell
                value={displayTrainingValue(sets[0].baseline_e1rm !== undefined ? Math.round(sets[0].baseline_e1rm) : 150)}
                onChange={(val) => updateSet(0, { baseline_e1rm: trainingNumber(val) || 150 })}
                placeholder="150"
                fieldKey={`${id}-baseline_e1rm`}
                label="Baseline e1RM"
                step={5}
                variant="transparent"
                widthClass="w-10"
                rowIndex={0}
              />
            ) : (
              <span className="text-xs font-mono tabular-nums text-[#AEAEB2]">
                {sets[0]?.baseline_e1rm !== undefined ? Math.round(sets[0].baseline_e1rm) : '150'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">Vol</span>
            <span className="text-xs font-mono tabular-nums text-[#AEAEB2]">{totalVolume.toLocaleString()} kg</span>
          </div>
          <button type="button" onClick={addSet} className="h-6 px-1.5 text-xs text-[#AEAEB2] hover:text-white">
            + Set
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
      <table className="text-left border-collapse w-max max-w-full">
        <thead>
          <tr className="border-b border-white/5">
            <th className={`${th} w-6`}>#</th>
            <th className={`${th} pr-3`}>
              <span className="text-[#AEAEB2]">Rx</span>
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[#636366]">kg × reps @</span>
            </th>
            <th className={`${th} w-6 px-1`} aria-label="Copy prescription to log" />
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
              const weight = trainingOrZero(set.actual ?? set.suggestedWeight);
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

              // e1rm from log performance of previous sets
              let prevLogE1RM = 0;
              for (let j = i - 1; j >= 0; j--) {
                const prevSet = sets[j];
                const prevW = trainingOrZero(prevSet.actual);
                const prevR = trainingIntOrZero(prevSet.reps);
                const prevRp = trainingOrZero(prevSet.executedRpe);
                const calcPrev = calculateE1RM(prevW, prevR, prevRp);
                if (calcPrev > 0) {
                  prevLogE1RM = calcPrev;
                  break;
                }
              }

              const targetReps = trainingIntOrZero(set.plannedReps);
              const targetRpe = trainingOrZero(set.plannedRpe);
              let suggestedPrescribedWeight = null;
              if (targetReps > 0 && targetRpe > 0 && prevLogE1RM > 0) {
                const calcW = calculateWeightFromE1RM(prevLogE1RM, targetReps, targetRpe);
                if (calcW > 0) {
                  suggestedPrescribedWeight = Math.round(calcW * 4) / 4;
                }
              }

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
                    {roleMode === 'coach' ? (
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
                              plannedWeight: updates.weight !== undefined ? updates.weight : set.plannedWeight
                            })}
                          />
                          {suggestedPrescribedWeight && suggestedPrescribedWeight !== trainingOrZero(set.plannedWeight) && (
                            <button
                              type="button"
                              onClick={() => updateSet(i, { plannedWeight: suggestedPrescribedWeight })}
                              className="h-6 px-0.5 text-[10px] text-amber-400"
                              title="Update prescription from logged e1RM"
                            >
                              {suggestedPrescribedWeight}
                            </button>
                          )}
                          <EditablePerformanceCell
                            value={displayTrainingValue(set.adjustment_pct !== undefined ? Math.round(set.adjustment_pct * 100) : 0)}
                            onChange={(val) => {
                              const rawPct = trainingOrZero(val);
                              updateSet(i, { adjustment_pct: rawPct / 100, dropPercent: rawPct });
                            }}
                            placeholder="0"
                            fieldKey={`${id}-adjustment_pct`}
                            label="Fatigue / Modifier"
                            widthClass="w-8"
                            step={1}
                            rowIndex={i}
                          />
                          <span className="text-[10px] text-[#636366] select-none" aria-hidden="true">%</span>
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
    </div>
  );
};

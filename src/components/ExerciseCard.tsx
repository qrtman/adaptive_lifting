import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, MoreHorizontal, Plus, Trash2, Zap, Copy } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { PrescriptionEditor } from './PrescriptionEditor';
import { 
  calculateCapacityScaledWeight, 
  calculateE1RM, 
  calculateWeightFromE1RM 
} from '../services/mathEngine';
import { displayTrainingValue, trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from '../services/numericTraining';

export const ExerciseCard = ({ 
  id,
  title, 
  variation, 
  tags, 
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
  
  const accentColor = 'mac-blue';

  const updateSet = (index: number, updates: any) => {
    const newSets = [...sets];
    newSets[index] = { ...newSets[index], ...updates };
    updateAndPropagate(newSets);
  };

  const commitSuggestion = (index: number) => {
    if (sets[index].suggestedWeight) {
      updateSet(index, { 
        actual: Math.round(sets[index].suggestedWeight! * 4) / 4,
        isAuto: false 
      });
    }
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

  return (
    <div className="glass-card rounded-2xl overflow-hidden mb-8 border border-white/5 transition-all hover:bg-white/[0.02]">
      <div className="bg-white/5 px-8 py-6 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <h4 className="text-3xl font-bold text-white tracking-tight font-sans">{title}</h4>
            <span className={`text-[16px] text-${accentColor} font-black uppercase tracking-[0.2em] mt-1 font-sans`}>
              {tier ? `${tier} · ${variation}` : variation}
            </span>
          </div>
          <div className="h-8 w-px bg-white/10 hidden sm:block" />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end mr-4">
             <span className="text-[15px] font-black text-gray-200 uppercase tracking-widest leading-none font-sans">Session Volume</span>
             <span className="text-[16px] font-bold text-white font-sans mt-1">{totalVolume.toLocaleString()}kg</span>
          </div>
          <button className="p-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>
          <table className="w-full text-left border-collapse bg-[#161616]">
        <thead className="bg-[#131313] border-b border-[#20201F]">
          <tr>
            <th className="px-8 py-5 text-[15px] font-black text-white uppercase tracking-[0.2em] w-24 font-sans align-top">Set</th>
            <th className="px-8 py-5 border-r border-[#20201F] bg-white/[0.005]">
              <span className="text-[15px] font-black text-white uppercase tracking-[0.2em] block mb-3 font-sans">Prescription</span>
              {roleMode === 'coach' ? (
                <div className="flex items-center gap-4">
                  <span className="w-12 text-center text-[11px] font-black text-amber-400 uppercase tracking-widest font-sans">Reps</span>
                  <span className="w-20 text-center text-[11px] font-black text-amber-400 uppercase tracking-widest font-sans">Target</span>
                  <span className="w-20 text-center text-[11px] font-black text-amber-400 uppercase tracking-widest font-sans">Weight</span>
                  <span className="w-16 text-center text-[11px] font-black text-amber-400 uppercase tracking-widest font-sans">Fatigue %</span>
                  <div className="w-10" />
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <span className="text-[13px] font-black text-amber-400 uppercase tracking-widest font-sans">Coach Intent & Prescribed Lift</span>
                </div>
              )}
            </th>
            <th className="px-8 py-5 text-[15px] font-black text-white uppercase tracking-[0.2em] text-center font-sans align-top border-r border-[#20201F] bg-white/[0.005] w-32">
              Anchor E1RM
            </th>
            <th className="px-8 py-5 text-[15px] font-black text-white uppercase tracking-[0.2em] text-center font-sans align-top border-r border-[#20201F] bg-white/[0.005] w-36">
              Variance
            </th>
            <th className="px-8 py-5">
              <span className="text-[15px] font-black text-white uppercase tracking-[0.2em] block mb-3 font-sans">Log Performance</span>
              <div className="flex items-center gap-4">
                <span className="w-16 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">Reps</span>
                <span className="w-16 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">RPE</span>
                <span className="w-24 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">Weight (kg)</span>
              </div>
            </th>
            <th className="px-8 py-5 text-[15px] font-black text-white uppercase tracking-[0.2em] text-center font-sans align-top">E1RM (kg)</th>
            <th className="px-8 py-5 text-[15px] font-black text-white uppercase tracking-[0.2em] text-right font-sans align-top">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#20201F]">
          <AnimatePresence>
            {sets.map((set, i) => {
              const weight = trainingOrZero(set.actual ?? set.suggestedWeight);
              const reps = trainingIntOrZero(set.reps);
              const rpe = trainingOrZero(set.executedRpe);
              const e1RM = calculateE1RM(weight, reps, rpe);
              
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

              // Calculate Variance Deltas
              const actualWt = trainingOrZero(set.actual);
              const plannedWt = trainingOrZero(set.plannedWeight);
              const wtDelta = actualWt > 0 && plannedWt > 0 ? (actualWt - plannedWt) : null;

              const actualRp = trainingOrZero(set.executedRpe);
              const targetRpVal = trainingOrZero(set.plannedRpe);
              const rpeDelta = actualRp > 0 && targetRpVal > 0 ? (actualRp - targetRpVal) : null;

              return (
                <motion.tr 
                  key={`${i}-${set.label}`}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, x: -20 }}
                  className={`group transition-all ${rowHighlight}`}
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <span className={`text-[25px] font-black font-mono tabular-nums tracking-tighter ${set.isTop ? 'text-mac-blue' : 'text-white'}`}>0{i + 1}</span>
                      <div className={`w-2.5 h-2.5 rounded-full ${set.isTop ? 'bg-mac-blue shadow-[0_0_8px_rgba(0,122,255,0.6)]' : 'bg-gray-500'}`} />
                    </div>
                  </td>
                  <td className="px-8 py-6 border-r border-[#20201F] bg-white/[0.005]">
                    {roleMode === 'coach' ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-4">
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
                              className="mt-1.5 text-[9px] font-black bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 border border-amber-400/20 hover:border-amber-400/40 rounded px-1.5 py-0.5 tracking-wider uppercase flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap active:scale-95"
                              title="Update prescription weight using the recent logged E1RM"
                            >
                              <Zap size={10} className="fill-amber-400 stroke-none animate-pulse" />
                              Sug: {suggestedPrescribedWeight}
                            </button>
                          )}

                          {/* Fatigue/Modifier (adjustment_pct) */}
                          <EditablePerformanceCell
                            value={displayTrainingValue(set.adjustment_pct !== undefined ? Math.round(set.adjustment_pct * 100) : 0)}
                            onChange={(val) => {
                              const rawPct = trainingOrZero(val);
                              updateSet(i, { adjustment_pct: rawPct / 100, dropPercent: rawPct });
                            }}
                            placeholder="0"
                            fieldKey={`${id}-adjustment_pct`}
                            label="Fatigue / Modifier"
                            widthClass="w-16"
                            step={1}
                            rowIndex={i}
                          />

                          {/* Live Action Copy/Sync to Log */}
                          <button 
                            type="button"
                            onClick={() => syncTarget(i)}
                            className="p-2 text-gray-500 hover:text-mac-blue hover:bg-white/5 active:scale-95 transition-all cursor-pointer rounded-lg border border-white/5 hover:border-white/10 h-11 flex items-center justify-center w-10 self-start mt-0"
                            title="Copy Prescription to Log"
                          >
                            <ArrowRight size={18} className="stroke-[2.5]" />
                          </button>
                        </div>
                        {set.note && <span className="text-[15px] text-mac-blue/90 font-black uppercase tracking-widest mt-1 font-sans">{set.note}</span>}
                      </div>
                    ) : (
                      // Clean Athlete View with final coach intent and calculated weight (no inputs or modifiers)
                      <div className="flex items-center gap-4 py-2 px-3 bg-white/[0.02] border border-white/5 rounded-xl">
                        <div className="flex flex-col">
                          <span className="text-[11px] text-gray-400 font-extrabold uppercase tracking-widest leading-none">Coach Intent</span>
                          <span className="text-[17px] font-black text-white font-sans mt-1">
                            {set.plannedReps} reps @ {set.target_value}{set.intensity_type === "PERCENT" ? "%" : " RPE"}
                          </span>
                        </div>
                        <ArrowRight size={14} className="text-gray-500 stroke-[2.5]" />
                        <div className="flex flex-col">
                          <span className="text-[11px] text-amber-400 font-extrabold uppercase tracking-widest leading-none">Prescribed Lift</span>
                          <span className="text-[19px] font-extrabold text-mac-blue font-sans mt-0.5 leading-none mb-1">
                            {set.plannedWeight} kg
                          </span>
                          {suggestedPrescribedWeight && suggestedPrescribedWeight !== trainingOrZero(set.plannedWeight) && (
                            <button
                              type="button"
                              onClick={() => updateSet(i, { plannedWeight: suggestedPrescribedWeight })}
                              className="mt-1 text-[8.5px] font-black text-amber-400 uppercase tracking-widest border border-amber-400/20 bg-amber-400/5 hover:bg-amber-400/15 rounded px-1 py-0.5 cursor-pointer transition-colors flex items-center justify-center gap-0.5 active:scale-95"
                              title="Click to update prescribed weight to the real-time E1RM suggested weight"
                            >
                              <Zap size={8} className="fill-amber-400 stroke-none animate-pulse" />
                              Suggest {suggestedPrescribedWeight}kg
                            </button>
                          )}
                        </div>
                        <button 
                          type="button"
                          onClick={() => syncTarget(i)}
                          className="ml-auto p-1.5 text-gray-400 hover:text-mac-blue hover:bg-white/5 active:scale-95 transition-all cursor-pointer rounded-lg border border-white/5 hover:border-white/10"
                          title="Copy Preset to Log"
                        >
                          <ArrowRight size={16} className="stroke-[2.5]" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-8 py-6 text-center align-middle border-r border-[#20201F] bg-white/[0.002]">
                    {i === 0 ? (
                      roleMode === 'coach' ? (
                        <div className="flex justify-center">
                          <EditablePerformanceCell
                            value={displayTrainingValue(set.baseline_e1rm !== undefined ? Math.round(set.baseline_e1rm) : 150)}
                            onChange={(val) => updateSet(i, { baseline_e1rm: trainingNumber(val) || 150 })}
                            placeholder="150"
                            fieldKey={`${id}-baseline_e1rm`}
                            label="Baseline e1RM"
                            step={5}
                            variant="transparent"
                            widthClass="w-24"
                            rowIndex={i}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center">
                          <span className="text-[24px] font-black font-sans tabular-nums tracking-tighter leading-none text-gray-400">
                            {set.baseline_e1rm !== undefined ? Math.round(set.baseline_e1rm) : '150'}
                          </span>
                          <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest mt-1.5 font-sans leading-none">
                            Anchor
                          </span>
                        </div>
                      )
                    ) : (
                      // Subsequent sets (i > 0) are read-only
                      <div className="flex flex-col items-center justify-center">
                        <span className={`text-[24px] font-black font-sans tabular-nums tracking-tighter leading-none ${prevLogE1RM > 0 ? 'text-mac-green' : 'text-gray-400'}`}>
                          {set.baseline_e1rm !== undefined ? Math.round(set.baseline_e1rm) : '150'}
                        </span>
                        <span className={`text-[12px] font-black uppercase tracking-widest mt-1.5 font-sans leading-none ${prevLogE1RM > 0 ? 'text-mac-green/80' : 'text-gray-500'}`}>
                          {prevLogE1RM > 0 ? 'Logged' : 'Anchor'}
                        </span>
                      </div>
                    )}
                  </td>
                  {/* Variance Column */}
                  <td className="px-8 py-6 text-center border-r border-[#20201F] bg-white/[0.002]">
                    <div className="flex flex-col items-center justify-center gap-1 font-mono">
                      {wtDelta !== null ? (
                        <span className={`font-data-md text-[11px] px-1.5 py-0.5 rounded ${
                          wtDelta > 0 ? 'text-[#54e083] bg-[#54e083]/10 font-bold' :
                          wtDelta < 0 ? 'text-red-500 bg-red-500/10 font-bold' : 'text-gray-400 bg-white/5 font-bold'
                        }`}>
                          {wtDelta > 0 ? `+${wtDelta}` : wtDelta} kg
                        </span>
                      ) : (
                        <span className="font-data-md text-[11px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-bold">0.0 kg</span>
                      )}
                      
                      {rpeDelta !== null ? (
                        <span className={`font-data-md text-[11px] px-1.5 py-0.5 rounded ${
                          rpeDelta > 0 ? 'text-red-500 bg-red-500/10 font-bold' :
                          rpeDelta < 0 ? 'text-[#54e083] bg-[#54e083]/10 font-bold' : 'text-gray-400 bg-white/5 font-bold'
                        }`}>
                          {rpeDelta > 0 ? `+${rpeDelta}` : rpeDelta} RPE
                        </span>
                      ) : (
                        <span className="font-data-md text-[11px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-bold">0.0 RPE</span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.reps)}
                        onChange={(val) => updateSet(i, { reps: trainingInt(val) })}
                        placeholder="—"
                        fieldKey={`${id}-reps`}
                        label="Log Reps"
                        widthClass="w-16"
                        isLogged={true}
                        step={1}
                        rowIndex={i}
                      />
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.executedRpe)}
                        onChange={(val) => updateSet(i, { executedRpe: trainingNumber(val) })}
                        placeholder="—"
                        fieldKey={`${id}-executedRpe`}
                        label="Log RPE"
                        widthClass="w-16"
                        isLogged={true}
                        step={0.5}
                        rowIndex={i}
                      />
                      <EditablePerformanceCell
                        value={displayTrainingValue(set.actual)}
                        onChange={(val) => updateSet(i, { actual: trainingNumber(val), isAuto: !val })}
                        placeholder="—"
                        fieldKey={`${id}-actual-weight`}
                        label="Log Weight"
                        widthClass="w-24"
                        isLogged={true}
                        isAuto={set.isAuto}
                        suggestedValue={set.suggestedWeight ? displayTrainingValue(Math.round(set.suggestedWeight * 4) / 4) : "0"}
                        step={2.5}
                        rowIndex={i}
                      />
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center align-middle">
                    <div className="flex flex-col items-center justify-center">
                      <span className={`text-[24px] font-black font-mono tabular-nums tracking-tighter leading-none ${e1RM > 0 ? 'text-white' : 'text-gray-600'}`}>
                        {e1RM > 0 ? Math.round(e1RM) : '—'}
                      </span>
                      {e1RM > 0 && (
                        <span className="text-[12px] font-black text-gray-400 uppercase tracking-widest mt-1.5 font-sans leading-none">E1RM</span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => duplicateSet(i)}
                        className="p-2 text-gray-400 hover:text-mac-blue hover:bg-mac-blue/15 rounded-lg transition-all cursor-pointer"
                        title="Duplicate Set"
                      >
                        <Copy size={18} />
                      </button>
                      <button 
                        onClick={() => deleteSet(i)}
                        className="p-2 text-gray-400 hover:text-orange-500 hover:bg-orange-500/15 rounded-lg transition-all cursor-pointer"
                        title="Delete Set (Audible)"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
      <div className="px-8 py-5 bg-[#131313] flex justify-between items-center border-t border-[#20201F]">
        <div className="flex items-center gap-3">
          <Zap size={15} className="text-[#54e083] animate-pulse" />
          <p className="text-[15px] font-bold text-amber-400 uppercase tracking-widest italic transition-colors font-sans">
            {totalVolume > 15000 ? "Volume ceiling reached. Consider capping intensity." : "Maintaining volume targets. Autoregulation active."}
          </p>
        </div>
        <button 
          onClick={() => {
            const nextSet = {
              label: "Additional Set",
              plannedWeight: null,
              plannedReps: null,
              plannedRpe: null,
              isTop: false,
              actual: null,
              reps: null,
              executedRpe: null
            };
            updateAndPropagate([...sets, nextSet]);
          }}
          className="flex items-center gap-2 text-[15px] font-black text-white hover:text-white transition-all uppercase tracking-widest bg-white/10 hover:bg-white/15 px-4 py-2 rounded-lg border border-white/10 hover:border-white/20 cursor-pointer"
        >
          <Plus size={15} /> Add Set
        </button>
      </div>
    </div>
  );
};

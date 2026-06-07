import React, { useRef, useState } from 'react';
import { Settings, Plus } from 'lucide-react';
import type { ExerciseData, SetData } from '../types';
import { calculateE1RM } from '../utils/mathUtils';
import { useSpreadsheetNavigation } from './useSpreadsheetNavigation';
import { ExerciseSetRow } from './ExerciseSetRow';

export interface ExerciseCardProps {
  key?: string;
  exercise: ExerciseData;
  roleMode: 'coach' | 'athlete';
  showToggles?: boolean;
  onUpdateSets: (sets: SetData[]) => void;
  onOpenPrescription: () => void;
}

export function ExerciseCard({
  exercise,
  roleMode: _roleMode,
  showToggles = true,
  onUpdateSets,
  onOpenPrescription,
}: ExerciseCardProps) {
  const rowRefs = useRef<HTMLTableRowElement[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const [autoAdjustPopover, setAutoAdjustPopover] = useState<{idx: number, suggestedWeight: number, suggestedE1RM: number, currentWeight: number, currentE1RM: number} | null>(null);

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
          if (pPct > 0) impliedE1RM = s.plannedWeight / (pPct / 100);
        }
        
        if (impliedE1RM > 0) {
          if (s.dropPercent) {
             s.baseline_e1rm = Number((impliedE1RM / (1 + (s.dropPercent / 100))).toFixed(1));
          } else {
             s.baseline_e1rm = Number(impliedE1RM.toFixed(1));
          }
        }
      }
    }
    
    const baseE1rm = s.baseline_e1rm || topSetE1RM;
    const droppedE1RM = s.dropPercent ? baseE1rm * (1 + (s.dropPercent / 100)) : baseE1rm;
    
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
    const newSet: SetData = {
      id: `set-run-${Date.now()}-${exercise.sets.length}`,
      label: lastSet ? lastSet.label : 'Main Set',
      plannedWeight: lastSet ? lastSet.plannedWeight : 100,
      plannedReps: lastSet ? lastSet.plannedReps : 5,
      plannedRpe: lastSet ? lastSet.plannedRpe : 8,
      actual: null,
      reps: null,
      executedRpe: null,
    };
    onUpdateSets([...exercise.sets, newSet]);
  };

  const handleRemoveSet = (idx: number) => {
    onUpdateSets(exercise.sets.filter((_, i) => i !== idx));
  };

  const { 
    activeCell, 
    handleKeyDown, 
    handleFocusSelect, 
    handleDoubleClickAppend, 
    handleCellClick 
  } = useSpreadsheetNavigation({ 
    sets: exercise.sets, 
    updatePrescription, 
    rowRefs, 
    cardRef 
  });

  return (
    <div ref={cardRef} className="bg-[#111111] border border-white/5 rounded-[12px] p-6 font-sans relative overflow-hidden mb-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-[22px] font-black text-white uppercase tracking-wider mb-1">{exercise.variation}</h3>
          <span className="text-[11px] font-mono text-[#AEAEB2] tracking-widest uppercase block">
            {exercise.title}
          </span>
        </div>
        <button
          onClick={onOpenPrescription}
          className="p-2 bg-transparent hover:bg-white/5 text-[#666] hover:text-white rounded-md transition-all cursor-pointer"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto pb-2">
        <table className="w-full text-left text-xs font-mono whitespace-nowrap border-spacing-y-3 border-separate" style={{ borderSpacing: '0 12px' }}>
          <thead>
            {/* Super Headers */}
            <tr className="text-[#666] text-[10px] uppercase tracking-widest">
              <th className="pb-2 font-medium border-b border-white/5 w-8">Set</th>
              <th className="pb-2 text-center font-medium border-b border-white/5" colSpan={3}>Prescription</th>
              <th className="pb-2 text-center border-b border-white/5 w-36"></th>
              <th className="pb-2 text-center font-medium border-b border-white/5" colSpan={4}>Executed (Log)</th>
              <th className="pb-2 border-b border-white/5" colSpan={3}></th>
            </tr>
            {/* Sub Headers */}
            <tr className="text-[#555] text-[9px] uppercase tracking-widest">
              <th className="pt-3 pb-1 font-bold"></th>
              
              <th className="pt-3 pb-1 text-center font-bold">Reps</th>
              <th className="pt-3 pb-1 text-center font-bold">Rpe / %</th>
              <th className="pt-3 pb-1 text-center font-bold">Weight</th>
              
              <th className="pt-3 pb-1 text-center font-bold">E1RM</th>
              
              <th className="pt-3 pb-1 text-center font-bold">Reps</th>
              <th className="pt-3 pb-1 text-center font-bold">RPE</th>
              <th className="pt-3 pb-1 text-center font-bold">Weight</th>
              <th className="pt-3 pb-1 text-center font-bold">E1RM</th>
              
              <th className="pt-3 pb-1 text-center font-bold">Duplicate</th>
              <th className="pt-3 pb-1 text-center font-bold">Delete</th>
              <th className="pt-3 pb-1 text-center font-bold">Sync</th>
            </tr>
          </thead>
          <tbody>
            {exercise.sets.map((s, idx) => (
              <ExerciseSetRow
                key={s.id}
                ref={(el) => { if (el) rowRefs.current[idx] = el; }}
                s={s}
                idx={idx}
                exercise={exercise}
                showToggles={showToggles}
                activeCell={activeCell}
                autoAdjustPopover={autoAdjustPopover}
                setAutoAdjustPopover={setAutoAdjustPopover}
                updatePrescription={updatePrescription}
                handleLoggedChange={handleLoggedChange}
                handleKeyDown={handleKeyDown}
                handleFocusSelect={handleFocusSelect}
                handleDoubleClickAppend={handleDoubleClickAppend}
                handleCellClick={handleCellClick}
                onDuplicate={(index, set) => {
                  const newSet = { ...set, id: `set-dup-${Date.now()}` };
                  const updated = [...exercise.sets];
                  updated.splice(index + 1, 0, newSet);
                  onUpdateSets(updated);
                }}
                onDelete={handleRemoveSet}
                applyAutoAdjust={applyAutoAdjust}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Set Button */}
      <button
        onClick={handleAddSet}
        className="mt-6 w-full py-3 border border-dashed border-[#333] hover:border-[#555] hover:bg-white/5 rounded-[8px] flex items-center justify-center gap-2 text-[#666] hover:text-white text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
      >
        <Plus size={14} /> Add Set Record
      </button>
    </div>
  );
}

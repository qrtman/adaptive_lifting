import React, { useState } from 'react';
import { X, Plus, Trash2, Check, AlertCircle } from 'lucide-react';
import type { ExerciseData, SetData } from '../types';
import { calculateCapacityScaledWeight } from '../utils/mathUtils';

interface PrescriptionEditorProps {
  exercise: ExerciseData;
  onSave: (updatedExercise: ExerciseData) => void;
  onClose: () => void;
  roleMode: 'coach' | 'athlete';
}

export function PrescriptionEditor({
  exercise,
  onSave,
  onClose,
  roleMode,
}: PrescriptionEditorProps) {
  const [editedTitle, setEditedTitle] = useState(exercise.title);
  const [editedVariation, setEditedVariation] = useState(exercise.variation);
  const [editedSets, setEditedSets] = useState<SetData[]>(() => 
    exercise.sets.map(s => ({ ...s }))
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddSet = () => {
    const lastSet = editedSets[editedSets.length - 1];
    const newSet: SetData = {
      id: `set-new-${Date.now()}-${editedSets.length}`,
      label: lastSet ? lastSet.label : 'Main Set',
      plannedWeight: lastSet ? lastSet.plannedWeight : 100,
      plannedReps: lastSet ? lastSet.plannedReps : 5,
      plannedRpe: lastSet ? lastSet.plannedRpe : 8,
      intensity_type: lastSet ? lastSet.intensity_type : 'RPE',
      target_value: lastSet ? lastSet.target_value : 8,
      baseline_e1rm: lastSet ? lastSet.baseline_e1rm : 150,
      adjustment_pct: lastSet ? lastSet.adjustment_pct : 0,
    };
    setEditedSets([...editedSets, newSet]);
  };

  const handleRemoveSet = (index: number) => {
    setEditedSets(editedSets.filter((_, i) => i !== index));
  };

  const handleSetChange = <K extends keyof SetData>(index: number, key: K, val: SetData[K]) => {
    const updated = [...editedSets];
    updated[index] = {
      ...updated[index],
      [key]: val,
    };
    setEditedSets(updated);
  };

  const handleSave = () => {
    // Basic validation
    for (let i = 0; i < editedSets.length; i++) {
      const s = editedSets[i];
      if (s.plannedReps !== null && (s.plannedReps <= 0 || !Number.isInteger(s.plannedReps))) {
        setErrorMsg(`Set ${i + 1}: Reps must be a positive integer.`);
        return;
      }
      if (s.plannedRpe !== null && (s.plannedRpe < 1 || s.plannedRpe > 10)) {
        setErrorMsg(`Set ${i + 1}: RPE must be between 1 and 10.`);
        return;
      }
    }

    onSave({
      ...exercise,
      title: editedTitle,
      variation: editedVariation,
      sets: editedSets,
    });
    onClose();
  };

  const isReadOnly = roleMode === 'athlete';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#111] border border-white/10 rounded-lg w-full max-w-4xl h-[85dvh] flex flex-col shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-wider">
              {isReadOnly ? 'View Prescription' : 'Prescription Editor'}
            </h2>
            <p className="text-[11px] font-mono text-[#AEAEB2] tracking-widest mt-0.5">
              {exercise.title} — {exercise.variation}
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white p-1 hover:bg-white/5 rounded transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded flex items-center gap-2 text-xs font-mono">
              <AlertCircle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Metadata Block */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[9px] font-black uppercase text-zinc-500 tracking-widest block mb-1.5">Exercise Name</label>
              <input
                type="text"
                disabled={isReadOnly}
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-mac-blue disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-zinc-500 tracking-widest block mb-1.5">Variation Details</label>
              <input
                type="text"
                disabled={isReadOnly}
                value={editedVariation}
                onChange={(e) => setEditedVariation(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-mac-blue disabled:opacity-50"
              />
            </div>
          </div>

          {/* Sets List Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Lifting Sets & Stress Targets</h3>
              {!isReadOnly && (
                <button
                  onClick={handleAddSet}
                  className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 text-white rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus size={12} /> Add Set
                </button>
              )}
            </div>

            <div className="border border-white/10 rounded-lg overflow-hidden bg-black/40">
              <table className="w-full border-collapse text-left text-xs font-mono">
                <thead>
                  <tr className="bg-[#1C1C1E] border-b border-white/10 text-zinc-500 text-[10px] uppercase tracking-wider">
                    <th className="p-3">Label</th>
                    <th className="p-3">Target Reps</th>
                    <th className="p-3">Intensity Type</th>
                    <th className="p-3">Target Value</th>
                    <th className="p-3">e1RM (Baseline)</th>
                    <th className="p-3">Capacity Adj %</th>
                    <th className="p-3 text-right">Calculated Load</th>
                    {!isReadOnly && <th className="p-3 text-center w-12">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-200">
                  {editedSets.map((s, idx) => {
                    const calcWeight = calculateCapacityScaledWeight(
                      s.baseline_e1rm || 150,
                      s.intensity_type || 'RPE',
                      s.target_value || 8,
                      s.plannedReps || 5,
                      s.adjustment_pct || 0
                    );

                    return (
                      <tr key={s.id} className="hover:bg-white/2">
                        <td className="p-2">
                          <input
                            type="text"
                            disabled={isReadOnly}
                            value={s.label}
                            onChange={(e) => handleSetChange(idx, 'label', e.target.value)}
                            className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-24 text-white focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            disabled={isReadOnly}
                            value={s.plannedReps === null ? '' : s.plannedReps}
                            onChange={(e) => handleSetChange(idx, 'plannedReps', e.target.value === '' ? null : parseInt(e.target.value))}
                            className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-16 text-white focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            disabled={isReadOnly}
                            value={s.intensity_type || 'RPE'}
                            onChange={(e) => handleSetChange(idx, 'intensity_type', e.target.value as 'RPE' | 'PERCENT')}
                            className="bg-[#1C1C1E]/50 border border-white/5 rounded px-1 py-1 w-20 text-white focus:outline-none"
                          >
                            <option value="RPE">RPE</option>
                            <option value="PERCENT">% 1RM</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.5"
                            disabled={isReadOnly}
                            value={s.target_value === undefined || s.target_value === null ? '' : s.target_value}
                            onChange={(e) => handleSetChange(idx, 'target_value', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                            className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-16 text-white focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            disabled={isReadOnly}
                            value={s.baseline_e1rm === undefined || s.baseline_e1rm === null ? '' : s.baseline_e1rm}
                            onChange={(e) => handleSetChange(idx, 'baseline_e1rm', e.target.value === '' ? 150 : parseFloat(e.target.value))}
                            className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-20 text-white focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            disabled={isReadOnly}
                            value={s.adjustment_pct === undefined || s.adjustment_pct === null ? '' : s.adjustment_pct}
                            onChange={(e) => handleSetChange(idx, 'adjustment_pct', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                            className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-16 text-white focus:outline-none"
                          />
                        </td>
                        <td className="p-2 text-right font-black text-white tabular-nums">
                          {calcWeight} kg
                        </td>
                        {!isReadOnly && (
                          <td className="p-2 text-center">
                            <button
                              onClick={() => handleRemoveSet(idx)}
                              className="text-[#FF453A] hover:text-[#FF3B30] p-1.5 hover:bg-[#FF3B30]/10 rounded transition-all cursor-pointer"
                              title="Delete set"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {editedSets.length === 0 && (
                    <tr>
                      <td colSpan={isReadOnly ? 7 : 8} className="p-8 text-center text-zinc-500">
                        No sets programmed.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white rounded text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Cancel
          </button>
          {!isReadOnly && (
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-mac-blue hover:bg-blue-600 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(0,122,255,0.4)]"
            >
              <Check size={14} /> Save Prescription
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

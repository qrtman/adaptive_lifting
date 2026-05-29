import React from 'react';
import { EditablePerformanceCell } from './EditablePerformanceCell';

interface PrescriptionEditorProps {
  reps: number | null;
  intensityType: string; // 'RPE' | 'PERCENT' | 'AMRAP'
  targetValue: number | null;
  weight: number | null;
  onChange: (updates: { reps?: number | null; intensityType?: string; targetValue?: number; weight?: number | null }) => void;
}

export const PrescriptionEditor: React.FC<PrescriptionEditorProps> = ({
  reps, intensityType, targetValue, weight, onChange
}) => {
  return (
    <div className="flex items-center gap-4">
      <EditablePerformanceCell
        value={reps !== null && reps !== undefined ? reps.toString() : ""}
        onChange={(val) => onChange({ reps: val ? parseFloat(val) : null })}
        placeholder="—"
        fieldKey="reps"
        label="Reps"
        widthClass="w-12"
        step={1}
      />
      <div className="flex flex-col items-center gap-1.5 w-20">
        <EditablePerformanceCell
          value={targetValue !== null && targetValue !== undefined ? targetValue.toString() : ""}
          onChange={(val) => onChange({ targetValue: val ? parseFloat(val) : 0 })}
          placeholder={intensityType === "PERCENT" ? "80" : "8"}
          fieldKey="targetValue"
          label={intensityType === "PERCENT" ? "Target %" : "Target RPE"}
          widthClass="w-20"
          step={intensityType === "PERCENT" ? 1 : 0.5}
        />
        <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5 select-none h-6 items-center w-20 justify-between">
          <button
            type="button"
            onClick={() => onChange({ intensityType: "RPE", targetValue: intensityType === "RPE" ? (targetValue || 8) : 8 })}
            className={`flex-1 text-center py-0.5 text-[8.5px] font-black uppercase tracking-widest rounded transition-all cursor-pointer leading-none ${
              intensityType === "RPE" ? "bg-mac-blue text-white shadow-sm" : "text-gray-400 hover:text-white"
            }`}
          >RPE</button>
          <button
            type="button"
            onClick={() => onChange({ intensityType: "PERCENT", targetValue: intensityType === "PERCENT" ? (targetValue || 80) : 80 })}
            className={`flex-1 text-center py-0.5 text-[8.5px] font-black uppercase tracking-widest rounded transition-all cursor-pointer leading-none ${
              intensityType === "PERCENT" ? "bg-mac-blue text-white shadow-sm" : "text-gray-400 hover:text-white"
            }`}
          >%</button>
        </div>
      </div>
      <EditablePerformanceCell
        value={weight !== null && weight !== undefined ? weight.toString() : ""}
        onChange={(val) => onChange({ weight: val ? parseFloat(val) : null })}
        placeholder="—"
        fieldKey="weight"
        label="Weight"
        widthClass="w-20"
        step={2.5}
      />
    </div>
  );
};

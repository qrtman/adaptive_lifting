import React from 'react';
import { EditablePerformanceCell } from './EditablePerformanceCell';

interface PrescriptionEditorProps {
  reps: number | null;
  intensityType: string; // 'RPE' | 'PERCENT' | 'AMRAP'
  targetValue: number | null;
  weight: number | null;
  onChange: (updates: { reps?: number | null; intensityType?: string; targetValue?: number; weight?: number | null }) => void;
}

const Sep = ({ children }: { children: string }) => (
  <span className="text-[10px] text-[#636366] select-none" aria-hidden="true">
    {children}
  </span>
);

export const PrescriptionEditor: React.FC<PrescriptionEditorProps> = ({
  reps, intensityType, targetValue, weight, onChange
}) => {
  return (
    <div className="flex items-center gap-0.5">
      <EditablePerformanceCell
        value={weight !== null && weight !== undefined ? weight.toString() : ""}
        onChange={(val) => onChange({ weight: val ? parseFloat(val) : null })}
        placeholder="—"
        fieldKey="weight"
        label="Weight"
        widthClass="w-12"
        step={2.5}
      />
      <Sep>×</Sep>
      <EditablePerformanceCell
        value={reps !== null && reps !== undefined ? reps.toString() : ""}
        onChange={(val) => onChange({ reps: val ? parseFloat(val) : null })}
        placeholder="—"
        fieldKey="reps"
        label="Reps"
        widthClass="w-8"
        step={1}
      />
      <Sep>@</Sep>
      <EditablePerformanceCell
        value={targetValue !== null && targetValue !== undefined ? targetValue.toString() : ""}
        onChange={(val) => onChange({ targetValue: val ? parseFloat(val) : 0 })}
        placeholder={intensityType === "PERCENT" ? "80" : "8"}
        fieldKey="targetValue"
        label={intensityType === "PERCENT" ? "Target %" : "Target RPE"}
        widthClass="w-8"
        step={intensityType === "PERCENT" ? 1 : 0.5}
      />
      <button
        type="button"
        onClick={() => onChange({ intensityType: intensityType === "RPE" ? "PERCENT" : "RPE", targetValue: intensityType === "RPE" ? 80 : 8 })}
        className="h-6 px-0.5 text-[10px] text-[#AEAEB2] hover:text-white"
        title="Toggle RPE / %"
      >
        {intensityType === "PERCENT" ? "%" : "RPE"}
      </button>
    </div>
  );
};

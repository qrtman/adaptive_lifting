import React from 'react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { MOVEMENT_PATTERNS, type MovementPattern } from '../services/exerciseCatalog';
import { trainingInt, trainingNumber } from '../services/numericTraining';
import type { SetGridBind } from '../services/sheetsCellKeyboard';

interface PrescriptionEditorProps {
  reps: number | null;
  intensityType: string;
  targetValue: number | null;
  weight: number | null;
  rowIndex: number;
  liftId: string;
  kgGrid: SetGridBind;
  repsGrid: SetGridBind;
  rpeGrid: SetGridBind;
  onChange: (updates: {
    reps?: number | null;
    intensityType?: string;
    targetValue?: number | null;
    weight?: number | null;
  }) => void;
}

const Sep = ({ children }: { children: string }) => (
  <span className="text-[10px] text-[var(--cal-muted-soft)] select-none" aria-hidden="true">
    {children}
  </span>
);

export const PrescriptionEditor: React.FC<PrescriptionEditorProps> = ({
  reps, intensityType, targetValue, weight, rowIndex, liftId, kgGrid, repsGrid, rpeGrid, onChange
}) => {
  return (
    <div className="flex items-center gap-0.5" data-lift-id={liftId}>
      <EditablePerformanceCell
        value={weight !== null && weight !== undefined ? weight.toString() : ""}
        onChange={(val) => onChange({ weight: trainingNumber(val) })}
        placeholder="—"
        fieldKey="rx-weight"
        label="Plan weight"
        widthClass="w-12"
        step={2.5}
        rowIndex={rowIndex}
        grid={kgGrid}
      />
      <Sep>×</Sep>
      <EditablePerformanceCell
        value={reps !== null && reps !== undefined ? reps.toString() : ""}
        onChange={(val) => onChange({ reps: trainingInt(val) })}
        placeholder="—"
        fieldKey="reps"
        label="Reps"
        widthClass="w-8"
        step={1}
        rowIndex={rowIndex}
        grid={repsGrid}
      />
      <Sep>@</Sep>
      <EditablePerformanceCell
        value={targetValue !== null && targetValue !== undefined ? targetValue.toString() : ""}
        onChange={(val) => onChange({ targetValue: trainingNumber(val) })}
        placeholder="—"
        fieldKey="targetValue"
        label={intensityType === "PERCENT" ? "Target %" : "Target RPE"}
        widthClass="w-8"
        step={intensityType === "PERCENT" ? 1 : 0.5}
        rowIndex={rowIndex}
        grid={rpeGrid}
      />
      <button
        type="button"
        onClick={() => onChange({ intensityType: intensityType === "RPE" ? "PERCENT" : "RPE", targetValue: intensityType === "RPE" ? 80 : 8 })}
        className="h-6 px-0.5 text-[10px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
        data-testid="rx-intensity"
        title="Switch between RPE and %"
      >
        {intensityType === "PERCENT" ? "%" : "RPE"}
      </button>
    </div>
  );
};

export function MovementPatternSelect({
  value,
  onChange,
  locked = false,
  id,
}: {
  value?: MovementPattern | string | null;
  onChange: (value: MovementPattern) => void;
  locked?: boolean;
  id?: string;
}) {
  const selected = (MOVEMENT_PATTERNS as readonly string[]).includes(value || '')
    ? (value as MovementPattern)
    : 'Misc';
  return (
    <label className="flex items-center gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted-soft)]">Pattern</span>
      <select
        data-testid={id ? `movement-pattern-${id}` : 'movement-pattern'}
        disabled={locked}
        value={selected}
        onChange={(event) => onChange(event.target.value as MovementPattern)}
        className="h-6 max-w-[11rem] px-1 text-[11px] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] rounded text-[var(--cal-muted)] disabled:opacity-40"
      >
        {MOVEMENT_PATTERNS.map((pattern) => (
          <option key={pattern} value={pattern}>{pattern}</option>
        ))}
      </select>
    </label>
  );
}

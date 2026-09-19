import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
  tdClass: string;
  onChange: (updates: {
    reps?: number | null;
    intensityType?: string;
    targetValue?: number | null;
    weight?: number | null;
  }) => void;
}

export const PrescriptionEditor: React.FC<PrescriptionEditorProps> = ({
  reps, intensityType, targetValue, weight, rowIndex, liftId, kgGrid, repsGrid, rpeGrid, tdClass, onChange
}) => {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!modeMenuRef.current?.contains(event.target as Node)) setModeMenuOpen(false);
    };
    window.addEventListener('mousedown', closeOnOutsidePointer);
    return () => window.removeEventListener('mousedown', closeOnOutsidePointer);
  }, [modeMenuOpen]);

  const selectIntensityType = (nextType: 'RPE' | 'PERCENT') => {
    setModeMenuOpen(false);
    if (nextType === intensityType) return;
    onChange({
      intensityType: nextType,
      targetValue: nextType === 'PERCENT' ? 80 : 8,
    });
  };

  return (
    <>
      <td className={`${tdClass} pr-1`} data-lift-id={liftId}>
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
      </td>
      <td className={tdClass}>
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
      </td>
      <td className={tdClass}>
        <div className="flex items-center gap-0.5">
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
          <div ref={modeMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setModeMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setModeMenuOpen(false);
              }}
              className={`flex h-5 w-4 items-center justify-center rounded-[2px] border text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${
                modeMenuOpen
                  ? 'border-[var(--cal-muted)] bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]'
                  : 'border-[var(--cal-hairline)] text-[var(--cal-muted)] hover:border-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]'
              }`}
              data-testid="rx-intensity"
              aria-label={intensityType === 'PERCENT' ? 'Percentage target mode' : 'RPE target mode'}
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title="Choose RPE or percentage"
            >
              {intensityType === "PERCENT" ? "%" : "@"}
            </button>
            <AnimatePresence>
              {modeMenuOpen ? (
              <motion.div
                role="menu"
                aria-label="Target mode"
                initial={{ opacity: 0, x: -4, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -3, scale: 0.98 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="absolute left-full top-1/2 z-20 flex w-[84px] -translate-y-1/2 origin-left items-center gap-0.5 rounded-[3px] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-0.5 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="rx-intensity-rpe"
                  onClick={() => selectIntensityType('RPE')}
                  className={`flex h-5 min-w-0 flex-1 items-center justify-center gap-1 rounded-[2px] px-1 text-[10px] ${
                    intensityType === 'RPE'
                      ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]'
                      : 'text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]'
                  }`}
                >
                  <span>@</span> RPE
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="rx-intensity-percent"
                  onClick={() => selectIntensityType('PERCENT')}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] text-[10px] ${
                    intensityType === 'PERCENT'
                      ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]'
                      : 'text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]'
                  }`}
                  aria-label="Percentage"
                  title="Percentage"
                >
                  %
                </button>
              </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </td>
    </>
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

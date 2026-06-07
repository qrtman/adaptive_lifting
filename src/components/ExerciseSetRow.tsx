import React, { forwardRef, useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react';
import type { SetData, ExerciseData } from '../types';
import { calculateE1RM } from '../utils/mathUtils';
import { ActiveCell } from './useSpreadsheetNavigation';

export interface ExerciseSetRowProps {
  s: SetData;
  idx: number;
  exercise: ExerciseData;
  activeCell: ActiveCell;
  autoAdjustPopover: {idx: number, suggestedWeight: number, suggestedE1RM: number, currentWeight: number, currentE1RM: number} | null;
  setAutoAdjustPopover: (p: {idx: number, suggestedWeight: number, suggestedE1RM: number, currentWeight: number, currentE1RM: number} | null) => void;
  updatePrescription: (idx: number, updates: Partial<SetData>) => void;
  handleLoggedChange: (idx: number, key: keyof SetData, val: any) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: string) => void;
  handleFocusSelect: (idx: number, field: string) => void;
  handleDoubleClickAppend: (idx: number, field: string, e: React.MouseEvent<HTMLInputElement>) => void;
  handleSubcellMouseDown: (idx: number, field: string) => void;
  handleInputClick: (idx: number, field: string, e: React.MouseEvent<HTMLInputElement>) => void;
  handleSubcellClick: (idx: number, field: string, e: React.MouseEvent<HTMLDivElement>) => void;
  handleCellClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDuplicate: (idx: number, s: SetData) => void;
  onDelete: (idx: number) => void;
  applyAutoAdjust: (startIdx: number, updateAll: boolean) => void;
}

export const ExerciseSetRow = forwardRef<HTMLTableRowElement, ExerciseSetRowProps>(({
  s, idx, exercise, activeCell, autoAdjustPopover, setAutoAdjustPopover,
  updatePrescription, handleLoggedChange, handleKeyDown, handleFocusSelect,
  handleDoubleClickAppend, handleSubcellMouseDown, handleInputClick, handleSubcellClick,
  handleCellClick, onDuplicate, onDelete, applyAutoAdjust
}, ref) => {
  const currentE1RM = calculateE1RM(s.actual || 0, s.reps || 0, s.executedRpe || 0);
  const plannedE1RM = calculateE1RM(s.plannedWeight || 0, s.plannedReps || 0, s.plannedRpe || 0);

  const topSetE1RM = exercise.sets[0] ? calculateE1RM(exercise.sets[0].actual || 0, exercise.sets[0].reps || 0, exercise.sets[0].executedRpe || 0) : 0;
  let execVsTopPct: number | null = null;
  if (idx > 0 && currentE1RM > 0 && topSetE1RM > 0) {
    execVsTopPct = ((currentE1RM - topSetE1RM) / topSetE1RM) * 100;
  }

  const prescPct = s.plannedRpe && s.plannedReps ? Math.max(0, 100 - (10 - s.plannedRpe) * 3 - s.plannedReps * 2) : 0;
  const execPct = s.executedRpe && s.reps ? Math.max(0, 100 - (10 - s.executedRpe) * 3 - s.reps * 2) : prescPct;

  const isCellActive = (field: string) => activeCell?.rowIdx === idx && activeCell?.field === field;
  const getCellMode = (field: string) => isCellActive(field) ? activeCell?.mode : undefined;

  const latestExecutedSet = [...exercise.sets].slice(0, idx).reverse().find(set => set.actual && set.reps && set.executedRpe);
  let suggestedWeight = 0;
  let suggestedE1RM = 0;

  if (latestExecutedSet && !s.actual) {
    suggestedE1RM = calculateE1RM(latestExecutedSet.actual!, latestExecutedSet.reps!, latestExecutedSet.executedRpe!);
    if (s.intensity_type === 'PERCENT' && s.target_value) {
      suggestedWeight = Math.round((suggestedE1RM * (s.target_value / 100)) / 2.5) * 2.5;
    } else if (s.intensity_type === 'RPE' && s.plannedReps && s.plannedRpe) {
      const pPct = Math.max(0, 100 - (10 - s.plannedRpe) * 3 - s.plannedReps * 2);
      suggestedWeight = Math.round((suggestedE1RM * (pPct / 100)) / 2.5) * 2.5;
    }
  }

  const currentPrescE1RM = s.baseline_e1rm || plannedE1RM;
  const isE1RmOutOfSync = suggestedE1RM > 0 && Math.abs(suggestedE1RM - currentPrescE1RM) >= 0.5;
  const hasDrop = s.dropPercent !== undefined;
  const dropVal = s.dropPercent ?? 0;
  const droppedE1RM = hasDrop
    ? currentPrescE1RM * (1 + (dropVal / 100))
    : currentPrescE1RM;
  const dropTone = dropVal < 0 ? 'text-ok-red' : dropVal > 0 ? 'text-ok-green' : 'text-ok-muted';
  const dropPctLabel = `${dropVal > 0 ? '+' : ''}${dropVal.toFixed(1)}%`;

  const e1rmDisplay = s.baseline_e1rm !== undefined
    ? Number(s.baseline_e1rm.toFixed(1))
    : (plannedE1RM > 0 ? Number(plannedE1RM.toFixed(1)) : '');

  const isE1rmCellActive = isCellActive('baseline_e1rm') || isCellActive('dropPercent');
  const e1rmEquationTitle = `${e1rmDisplay} ${dropPctLabel} → ${droppedE1RM.toFixed(1)}`;

  const revealDrop = (e: React.MouseEvent) => {
    e.stopPropagation();
    updatePrescription(idx, { dropPercent: -2 });
    handleFocusSelect(idx, 'dropPercent');
  };

  const nudgeDropPercent = (delta: number) => {
    const current = s.dropPercent ?? 0;
    updatePrescription(idx, { dropPercent: Number((current + delta).toFixed(1)) });
  };

  const e1rmAnchorRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const updatePopoverPos = useCallback(() => {
    const anchor = e1rmAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 });
  }, []);

  useEffect(() => {
    if (!isE1rmCellActive || !hasDrop) {
      setPopoverPos(null);
      return;
    }
    updatePopoverPos();
    window.addEventListener('scroll', updatePopoverPos, true);
    window.addEventListener('resize', updatePopoverPos);
    return () => {
      window.removeEventListener('scroll', updatePopoverPos, true);
      window.removeEventListener('resize', updatePopoverPos);
    };
  }, [isE1rmCellActive, hasDrop, updatePopoverPos, dropVal, e1rmDisplay, droppedE1RM]);

  const e1rmPopover = isE1rmCellActive && hasDrop && popoverPos ? (
    <div
      className="exercise-card__e1rm-popover exercise-card__e1rm-popover--floating exercise-card__e1rm-flyout ok-tabular"
      data-e1rm-flyout={exercise.id}
      style={{ top: popoverPos.top, left: popoverPos.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="exercise-card__e1rm-popover-label">e1RM drop</span>
      <div className="exercise-card__e1rm-popover-grid">
        <div className="exercise-card__e1rm-popover-field exercise-card__e1rm-popover-field--base">
          <span className="exercise-card__e1rm-popover-field-label">Baseline</span>
          <input
            type="number"
            data-field="baseline_e1rm"
            onKeyDown={(e) => handleKeyDown(e, idx, 'baseline_e1rm')}
            onFocus={() => handleFocusSelect(idx, 'baseline_e1rm')}
            onDoubleClick={(e) => handleDoubleClickAppend(idx, 'baseline_e1rm', e)}
            value={e1rmDisplay}
            placeholder="—"
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : undefined;
              updatePrescription(idx, { baseline_e1rm: val });
            }}
            className="spreadsheet-inline-input spreadsheet-inline-input--base"
            data-e1rm-scope={exercise.id}
            data-e1rm-row={idx}
            data-mode={getCellMode('baseline_e1rm')}
          />
        </div>
        <span className="exercise-card__e1rm-popover-op" aria-hidden>Δ</span>
        <div className={`exercise-card__e1rm-popover-field exercise-card__e1rm-popover-field--drop ${dropVal < 0 ? 'is-drop-negative' : dropVal > 0 ? 'is-drop-positive' : 'is-drop-zero'}`}>
          <span className="exercise-card__e1rm-popover-field-label">Adjust %</span>
          <div className="exercise-card__e1rm-drop-stack">
            <input
              type="number"
              step="0.5"
              data-field="dropPercent"
              onKeyDown={(e) => handleKeyDown(e, idx, 'dropPercent')}
              onFocus={() => handleFocusSelect(idx, 'dropPercent')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'dropPercent', e)}
              value={s.dropPercent ?? ''}
              placeholder="0"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') {
                  updatePrescription(idx, { dropPercent: undefined });
                  return;
                }
                updatePrescription(idx, { dropPercent: parseFloat(raw) });
              }}
              className={`spreadsheet-inline-input spreadsheet-inline-input--drop ${dropTone}`}
              data-e1rm-scope={exercise.id}
              data-e1rm-row={idx}
              data-mode={getCellMode('dropPercent')}
            />
            <div className="exercise-card__e1rm-drop-stepper" aria-hidden>
              <button type="button" className="ecard-stepper" tabIndex={-1} aria-label="Increase adjust %" onClick={() => nudgeDropPercent(0.5)}>▲</button>
              <button type="button" className="ecard-stepper" tabIndex={-1} aria-label="Decrease adjust %" onClick={() => nudgeDropPercent(-0.5)}>▼</button>
            </div>
          </div>
        </div>
        <span className="exercise-card__e1rm-popover-op" aria-hidden>=</span>
        <div className="exercise-card__e1rm-popover-field exercise-card__e1rm-popover-field--result">
          <span className="exercise-card__e1rm-popover-field-label">Target</span>
          <span className="exercise-card__e1rm-eq-result">{droppedE1RM.toFixed(1)}</span>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <React.Fragment>
      <tr ref={ref} className="exercise-card__row align-middle">
        <td className="ecard-td-set text-ok-muted ok-tabular text-[12px] font-semibold text-center">{idx + 1}</td>

        {/* PRESCRIPTION */}
        <td className="ecard-zone--presc-start ecard-td-reps">
          <div
            className="spreadsheet-cell exercise-card__cell flex items-center text-ok-muted text-[12px] font-bold overflow-hidden"
            data-active={isCellActive('plannedReps')}
            data-mode={getCellMode('plannedReps')}
            onClick={handleCellClick}
          >
            <input
              type="number"
              data-field="plannedReps"
              onKeyDown={(e) => handleKeyDown(e, idx, 'plannedReps')}
              onFocus={() => handleFocusSelect(idx, 'plannedReps')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'plannedReps', e)}
              value={s.plannedReps === null ? '' : s.plannedReps}
              placeholder="R"
              onChange={(e) => updatePrescription(idx, { plannedReps: e.target.value ? parseInt(e.target.value) : null })}
              className="spreadsheet-input bg-transparent text-center w-full min-w-0 focus:outline-none spreadsheet-input--no-spin"
              data-mode={getCellMode('plannedReps')}
            />
          </div>
        </td>

        <td className="ecard-td-intensity">
          {(() => {
            const isRpeActive = isCellActive('plannedRpe');
            const isPctActive = isCellActive('target_value');
            const intensityFocused = isRpeActive || isPctActive;
            const rpeEmphasis = isRpeActive || (!intensityFocused && s.intensity_type !== 'PERCENT');
            const pctEmphasis = isPctActive || (!intensityFocused && s.intensity_type === 'PERCENT');

            return (
              <div
                className="spreadsheet-cell exercise-card__cell exercise-card__cell--intensity flex items-center"
                data-active={intensityFocused}
                data-mode={getCellMode('plannedRpe') || getCellMode('target_value')}
              >
                <div
                  className="exercise-card__intensity-split flex items-center gap-1 h-full w-full min-w-0 py-1"
                  data-has-focus={intensityFocused}
                >
                  <div
                    className="exercise-card__intensity-subcell"
                    data-active={isRpeActive}
                    data-mode={getCellMode('plannedRpe')}
                    data-intensity-mode={!intensityFocused && s.intensity_type !== 'PERCENT' ? 'stored' : undefined}
                    onMouseDown={() => handleSubcellMouseDown(idx, 'plannedRpe')}
                    onClick={(e) => handleSubcellClick(idx, 'plannedRpe', e)}
                  >
                    <input
                      type="number"
                      data-field="plannedRpe"
                      onKeyDown={(e) => handleKeyDown(e, idx, 'plannedRpe')}
                      value={s.plannedRpe || ''}
                      placeholder="RPE"
                      onMouseDown={() => handleSubcellMouseDown(idx, 'plannedRpe')}
                      onFocus={() => {
                        if (s.intensity_type !== 'RPE') updatePrescription(idx, { intensity_type: 'RPE' });
                        handleFocusSelect(idx, 'plannedRpe');
                      }}
                      onClick={(e) => handleInputClick(idx, 'plannedRpe', e)}
                      onDoubleClick={(e) => handleDoubleClickAppend(idx, 'plannedRpe', e)}
                      onChange={(e) => updatePrescription(idx, { plannedRpe: e.target.value ? parseFloat(e.target.value) : null })}
                      className={`spreadsheet-input bg-transparent text-center w-full min-w-0 focus:outline-none spreadsheet-input--no-spin ${rpeEmphasis ? 'text-ok text-[12px] font-bold' : 'text-ok-faint text-[12px]'}`}
                      data-mode={getCellMode('plannedRpe')}
                    />
                  </div>
                  <div
                    className="exercise-card__intensity-subcell exercise-card__intensity-subcell--pct"
                    data-active={isPctActive}
                    data-mode={getCellMode('target_value')}
                    data-intensity-mode={!intensityFocused && s.intensity_type === 'PERCENT' ? 'stored' : undefined}
                    onMouseDown={() => handleSubcellMouseDown(idx, 'target_value')}
                    onClick={(e) => handleSubcellClick(idx, 'target_value', e)}
                  >
                    <input
                      type="number"
                      data-field="target_value"
                      onKeyDown={(e) => handleKeyDown(e, idx, 'target_value')}
                      value={s.target_value || ''}
                      placeholder={prescPct > 0 ? prescPct.toString() : ''}
                      onMouseDown={() => handleSubcellMouseDown(idx, 'target_value')}
                      onFocus={() => {
                        if (s.intensity_type !== 'PERCENT') updatePrescription(idx, { intensity_type: 'PERCENT' });
                        handleFocusSelect(idx, 'target_value');
                      }}
                      onClick={(e) => handleInputClick(idx, 'target_value', e)}
                      onDoubleClick={(e) => handleDoubleClickAppend(idx, 'target_value', e)}
                      onChange={(e) => updatePrescription(idx, { target_value: e.target.value ? parseFloat(e.target.value) : undefined })}
                      className={`spreadsheet-input bg-transparent text-right w-full min-w-0 focus:outline-none spreadsheet-input--no-spin pl-1 pr-[2px] ${pctEmphasis ? 'text-ok text-[12px] font-bold' : 'text-ok-faint text-[12px]'}`}
                      data-mode={getCellMode('target_value')}
                    />
                    <span className={`pr-1 pl-0.5 pointer-events-none ok-tabular ${pctEmphasis ? 'text-ok-muted text-[12px] font-bold' : 'text-ok-faint text-[12px]'}`}>%</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </td>

        <td className="ecard-td-weight">
          <div
            className="spreadsheet-cell exercise-card__cell flex items-center text-ok-muted text-[12px] font-bold overflow-hidden"
            data-active={isCellActive('plannedWeight')}
            data-mode={getCellMode('plannedWeight')}
            onClick={handleCellClick}
          >
            <input
              type="number"
              data-field="plannedWeight"
              onKeyDown={(e) => handleKeyDown(e, idx, 'plannedWeight')}
              onFocus={() => handleFocusSelect(idx, 'plannedWeight')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'plannedWeight', e)}
              value={s.plannedWeight === null ? '' : s.plannedWeight}
              placeholder="W"
              onChange={(e) => updatePrescription(idx, { plannedWeight: e.target.value ? parseFloat(e.target.value) : null })}
              className="spreadsheet-input bg-transparent text-center w-full min-w-0 focus:outline-none spreadsheet-input--no-spin"
              data-mode={getCellMode('plannedWeight')}
            />
          </div>
        </td>

        <td className="ecard-zone--split ecard-td-e1rm">
          <div
            className="ecard-td-e1rm__slot"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleFocusSelect(idx, 'baseline_e1rm');
            }}
          >
          <div
            ref={e1rmAnchorRef}
            className="spreadsheet-cell exercise-card__cell exercise-card__cell--e1rm exercise-card__e1rm-anchor relative px-1"
            data-active={isE1rmCellActive}
            data-mode={getCellMode('baseline_e1rm') || getCellMode('dropPercent')}
            onClick={handleCellClick}
          >
            {hasDrop ? (
              <>
                <button
                  type="button"
                  className={`exercise-card__readout ok-tabular w-full cursor-pointer ${droppedE1RM > 0 ? 'text-ok' : 'text-ok-faint'}`}
                  title={e1rmEquationTitle}
                  onClick={(e) => { e.stopPropagation(); handleFocusSelect(idx, 'baseline_e1rm'); }}
                >
                  <span className="font-bold">{droppedE1RM.toFixed(1)}</span>
                  <span className={`text-[10px] font-bold ${dropTone}`}>
                    ({dropPctLabel})
                  </span>
                </button>
              </>
            ) : (
              <input
                type="number"
                data-field="baseline_e1rm"
                onKeyDown={(e) => handleKeyDown(e, idx, 'baseline_e1rm')}
                onFocus={() => handleFocusSelect(idx, 'baseline_e1rm')}
                onDoubleClick={(e) => handleDoubleClickAppend(idx, 'baseline_e1rm', e)}
                value={e1rmDisplay}
                placeholder="—"
                onChange={(e) => {
                  const val = e.target.value ? parseFloat(e.target.value) : undefined;
                  updatePrescription(idx, { baseline_e1rm: val });
                }}
                className="spreadsheet-input bg-transparent font-bold text-center w-full text-[12px] focus:outline-none spreadsheet-input--no-spin ok-tabular"
                data-mode={getCellMode('baseline_e1rm')}
                onClick={handleCellClick}
              />
            )}
            {isE1RmOutOfSync && !isE1rmCellActive ? (
              <button
                type="button"
                className="exercise-card__e1rm-addon cursor-pointer p-0.5"
                onClick={(e) => { e.stopPropagation(); setAutoAdjustPopover({ idx, suggestedWeight, suggestedE1RM, currentWeight: s.plannedWeight || 0, currentE1RM: currentPrescE1RM }); }}
                title="Adjust to today's performance"
              >
                <RefreshCw size={11} className="text-ok-amber" />
              </button>
            ) : !hasDrop && isCellActive('baseline_e1rm') ? (
              <button
                type="button"
                className="exercise-card__e1rm-addon text-[10px] font-bold text-ok-faint hover:text-ok-muted px-1"
                onClick={revealDrop}
                title="Add drop %"
              >
                +
              </button>
            ) : null}
          </div>
          </div>
        </td>

        {/* EXECUTED */}
        <td className="ecard-zone--exec-start ecard-td-reps">
          <div
            className="spreadsheet-cell exercise-card__cell flex items-center text-ok text-[12px] font-bold overflow-hidden"
            data-active={isCellActive('reps')}
            data-mode={getCellMode('reps')}
            onClick={handleCellClick}
          >
            <input
              type="number"
              data-field="reps"
              onKeyDown={(e) => handleKeyDown(e, idx, 'reps')}
              onFocus={() => handleFocusSelect(idx, 'reps')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'reps', e)}
              value={s.reps === null ? '' : s.reps}
              placeholder="R"
              onChange={(e) => handleLoggedChange(idx, 'reps', e.target.value ? parseInt(e.target.value) : null)}
              className="spreadsheet-input bg-transparent text-center w-full min-w-0 focus:outline-none spreadsheet-input--no-spin"
              data-mode={getCellMode('reps')}
            />
          </div>
        </td>

        <td className="ecard-td-rpe">
          <div
            className="spreadsheet-cell exercise-card__cell exercise-card__rpe-log-input flex items-center w-full"
            data-active={isCellActive('executedRpe')}
            data-mode={getCellMode('executedRpe')}
            onClick={handleCellClick}
          >
            <input
              type="number"
              step="0.5"
              data-field="executedRpe"
              onKeyDown={(e) => handleKeyDown(e, idx, 'executedRpe')}
              onFocus={() => handleFocusSelect(idx, 'executedRpe')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'executedRpe', e)}
              value={s.executedRpe || ''}
              placeholder="8"
              onChange={(e) => handleLoggedChange(idx, 'executedRpe', e.target.value ? parseFloat(e.target.value) : null)}
              className="spreadsheet-input bg-transparent text-[12px] font-bold text-center w-full min-w-0 focus:outline-none spreadsheet-input--no-spin"
              data-mode={getCellMode('executedRpe')}
            />
            {execPct > 0 && s.executedRpe ? (
              <span className="exercise-card__derived-pct" title="Derived from RPE + reps (read-only)">
                {execPct.toFixed(0)}%
              </span>
            ) : null}
          </div>
        </td>

        <td className="ecard-td-weight">
          <div
            className="spreadsheet-cell exercise-card__cell flex items-center text-ok text-[12px] font-bold overflow-hidden"
            data-active={isCellActive('actual')}
            data-mode={getCellMode('actual')}
            onClick={handleCellClick}
          >
            <input
              type="number"
              data-field="actual"
              onKeyDown={(e) => handleKeyDown(e, idx, 'actual')}
              onFocus={() => handleFocusSelect(idx, 'actual')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'actual', e)}
              value={s.actual === null ? '' : s.actual}
              placeholder="—"
              onChange={(e) => handleLoggedChange(idx, 'actual', e.target.value ? parseFloat(e.target.value) : null)}
              className="spreadsheet-input bg-transparent text-center w-full min-w-0 focus:outline-none spreadsheet-input--no-spin"
              data-mode={getCellMode('actual')}
            />
          </div>
        </td>

        <td className="ecard-td-e1rm-exec">
          <div className={`exercise-card__readout ok-tabular ${currentE1RM > 0 ? 'text-ok' : 'text-ok-faint'}`}>
            <span className="font-bold">
              {currentE1RM > 0 ? currentE1RM.toFixed(1) : '—'}
            </span>
            {execVsTopPct !== null && (
              <span className={`text-[10px] font-bold ${execVsTopPct >= 0 ? 'text-ok-green' : 'text-ok-red'}`}>
                ({execVsTopPct >= 0 ? '+' : ''}{execVsTopPct.toFixed(1)}%)
              </span>
            )}
          </div>
        </td>

        {/* ACTIONS */}
        <td className="ecard-td-actions">
          <div className="exercise-card__actions">
            <button type="button" onClick={() => onDuplicate(idx, s)} className="exercise-card__action-btn" title="Duplicate set">
              <Copy size={11} />
            </button>
            <button type="button" onClick={() => onDelete(idx)} className="exercise-card__action-btn exercise-card__action-btn--danger" title="Delete set">
              <Trash2 size={11} />
            </button>
            {s.actual ? (
              <span className="exercise-card__action-status" title="Logged"><Check size={10} className="text-ok-green shrink-0" /></span>
            ) : null}
          </div>
        </td>
      </tr>

      {autoAdjustPopover?.idx === idx && (
        <tr>
          <td colSpan={10} className="pt-1 pb-4">
            <div className="bg-ok-surface-2 border border-ok-amber rounded-[var(--ok-radius-md)] p-3 flex flex-col md:flex-row md:items-center gap-4 ml-8 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-ok-amber" />
              <div className="flex flex-col gap-2 pl-2">
                <div className="flex items-center gap-2 text-ok text-[12px] font-bold">
                  <RefreshCw size={12} className="text-ok-amber" />
                  <span>Adjust to today's performance?</span>
                </div>
                <div className="flex items-center gap-6 text-[11px] ok-tabular mt-1">
                  {(() => {
                    const deltaE1RM = autoAdjustPopover.suggestedE1RM - autoAdjustPopover.currentE1RM;
                    const deltaWeight = autoAdjustPopover.suggestedWeight - autoAdjustPopover.currentWeight;
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-ok-muted">Weight:</span>
                          <span className="text-ok-muted">{autoAdjustPopover.currentWeight}kg</span>
                          <span className="text-ok-faint">→</span>
                          <span className="text-ok font-bold">{autoAdjustPopover.suggestedWeight}kg</span>
                          <span className={`${deltaWeight >= 0 ? 'text-ok-green' : 'text-ok-red'} font-bold`}>
                            ({deltaWeight > 0 ? '+' : ''}{deltaWeight.toFixed(1)}kg)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-ok-muted">E1RM:</span>
                          <span className="text-ok-muted">{autoAdjustPopover.currentE1RM.toFixed(1)}</span>
                          <span className="text-ok-faint">→</span>
                          <span className="text-ok font-bold">{autoAdjustPopover.suggestedE1RM.toFixed(1)}</span>
                          <span className={`${deltaE1RM >= 0 ? 'text-ok-green' : 'text-ok-red'} font-bold`}>
                            ({deltaE1RM > 0 ? '+' : ''}{deltaE1RM.toFixed(1)})
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => applyAutoAdjust(idx, false)} className="bg-ok-surface-3 hover:bg-ok-surface-2 text-ok rounded px-3 py-2 text-[11px] font-bold transition-colors cursor-pointer border border-ok">This set</button>
                <button type="button" onClick={() => applyAutoAdjust(idx, true)} className="bg-ok-amber/15 hover:bg-ok-amber/25 text-ok-amber rounded px-3 py-2 text-[11px] font-bold transition-colors cursor-pointer">All remaining</button>
                <button type="button" onClick={() => setAutoAdjustPopover(null)} className="text-ok-muted hover:text-ok rounded px-2 py-2 text-[11px] font-bold transition-colors cursor-pointer">Dismiss</button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {e1rmPopover ? createPortal(e1rmPopover, document.body) : null}
    </React.Fragment>
  );
});

ExerciseSetRow.displayName = 'ExerciseSetRow';

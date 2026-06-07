import React, { forwardRef } from 'react';
import { Check, RefreshCw, Trash2 } from 'lucide-react';
import type { SetData, ExerciseData } from '../types';
import { calculateE1RM } from '../utils/mathUtils';
import { ActiveCell } from './useSpreadsheetNavigation';

export interface ExerciseSetRowProps {
  s: SetData;
  idx: number;
  exercise: ExerciseData;
  showToggles: boolean;
  activeCell: ActiveCell;
  autoAdjustPopover: {idx: number, suggestedWeight: number, suggestedE1RM: number, currentWeight: number, currentE1RM: number} | null;
  setAutoAdjustPopover: (p: {idx: number, suggestedWeight: number, suggestedE1RM: number, currentWeight: number, currentE1RM: number} | null) => void;
  updatePrescription: (idx: number, updates: Partial<SetData>) => void;
  handleLoggedChange: (idx: number, key: keyof SetData, val: any) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: string) => void;
  handleFocusSelect: (idx: number, field: string) => void;
  handleDoubleClickAppend: (idx: number, field: string, e: React.MouseEvent<HTMLInputElement>) => void;
  handleCellClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDuplicate: (idx: number, s: SetData) => void;
  onDelete: (idx: number) => void;
  applyAutoAdjust: (startIdx: number, updateAll: boolean) => void;
}

export const ExerciseSetRow = forwardRef<HTMLTableRowElement, ExerciseSetRowProps>(({
  s, idx, exercise, showToggles, activeCell, autoAdjustPopover, setAutoAdjustPopover,
  updatePrescription, handleLoggedChange, handleKeyDown, handleFocusSelect, 
  handleDoubleClickAppend, handleCellClick, onDuplicate, onDelete, applyAutoAdjust
}, ref) => {
  const currentE1RM = calculateE1RM(s.actual || 0, s.reps || 0, s.executedRpe || 0);
  const plannedE1RM = calculateE1RM(s.plannedWeight || 0, s.plannedReps || 0, s.plannedRpe || 0);
  
  let varianceNode = <span className="text-[#555] text-[10px]">—</span>;
  if (currentE1RM > 0 && plannedE1RM > 0) {
    const diff = ((currentE1RM - plannedE1RM) / plannedE1RM) * 100;
    const isPositive = diff >= 0;
    varianceNode = (
      <span className={`text-[9px] font-bold tracking-wider ${isPositive ? 'text-[#34C759]' : 'text-[#FF453A]'}`}>
        {isPositive ? '+' : ''}{diff.toFixed(1)}%
      </span>
    );
  }

  const topSetE1RM = exercise.sets[0] ? calculateE1RM(exercise.sets[0].actual || 0, exercise.sets[0].reps || 0, exercise.sets[0].executedRpe || 0) : 0;
  let executionVarianceNode = null;
  if (idx > 0 && currentE1RM > 0 && topSetE1RM > 0) {
    const diff = ((currentE1RM - topSetE1RM) / topSetE1RM) * 100;
    const isPositive = diff >= 0;
    executionVarianceNode = (
      <span className={`text-[9px] font-bold tracking-wider leading-none mb-1 ${isPositive ? 'text-[#34C759]' : 'text-[#FF453A]'}`}>
        {isPositive ? '+' : ''}{diff.toFixed(1)}%
      </span>
    );
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
  const droppedE1RM = s.dropPercent ? currentPrescE1RM * (1 + (s.dropPercent / 100)) : currentPrescE1RM;

  return (
    <React.Fragment>
      <tr ref={ref} className="align-middle">
        <td className="text-[#888] font-mono text-[11px]">{idx + 1}</td>
      
      {/* PRESCRIPTION COLUMNS */}
      <td className={`px-1 transition-all duration-300 ${showToggles ? 'min-w-[70px] w-[8%]' : 'min-w-[40px] w-[5%]'}`}>
        <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] flex items-center justify-between text-[#888] text-[11px] font-bold overflow-hidden focus-within:border-[#444] transition-colors h-[34px]" data-active={isCellActive('plannedReps')} data-mode={getCellMode('plannedReps')} onClick={handleCellClick}>
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => updatePrescription(idx, { plannedReps: Math.max(0, (s.plannedReps || 0) - 1) })}>▼</button>}
          <input 
            type="number" 
            data-field="plannedReps"
            onKeyDown={(e) => handleKeyDown(e, idx, 'plannedReps')}
            onFocus={() => handleFocusSelect(idx, 'plannedReps')}
            onDoubleClick={(e) => handleDoubleClickAppend(idx, 'plannedReps', e)}
            value={s.plannedReps === null ? '' : s.plannedReps} 
            placeholder="R"
            onChange={(e) => updatePrescription(idx, { plannedReps: e.target.value ? parseInt(e.target.value) : null })}
            className="spreadsheet-input bg-transparent text-[#E5E5E5] text-center w-full focus:outline-none placeholder-[#444] appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
            data-mode={getCellMode('plannedReps')}
          />
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => updatePrescription(idx, { plannedReps: (s.plannedReps || 0) + 1 })}>▲</button>}
        </div>
      </td>
      <td className={`px-1 transition-all duration-300 ${showToggles ? 'min-w-[140px] w-[16%]' : 'min-w-[90px] w-[11%]'}`}>
        <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] flex items-center justify-between focus-within:border-[#444] transition-colors h-[34px]" data-active={isCellActive('plannedRpe') || isCellActive('target_value')} data-mode={getCellMode('plannedRpe') || getCellMode('target_value')}>
          {showToggles && <button tabIndex={-1} className="px-1.5 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer rounded-l-[6px]" onClick={() => {
            if (s.intensity_type === 'PERCENT') updatePrescription(idx, { target_value: Math.max(0, (s.target_value || 0) - 1) });
            else updatePrescription(idx, { plannedRpe: Math.max(0, (s.plannedRpe || 0) - 0.5) });
          }}>▼</button>}
          <div className="flex items-center gap-1 h-full w-full py-1">
            {/* RPE Toggle Side */}
            <div 
              className={`h-full flex-1 flex items-center justify-center rounded-[4px] transition-colors duration-300 ${s.intensity_type !== 'PERCENT' ? 'bg-[#2A2A2D]' : 'bg-transparent'}`}
              onClick={handleCellClick}
            >
              <input 
                type="number"
                data-field="plannedRpe"
                onKeyDown={(e) => handleKeyDown(e, idx, 'plannedRpe')}
                value={s.plannedRpe || ''}
                placeholder="RPE"
                onFocus={() => {
                  if (s.intensity_type !== 'RPE') updatePrescription(idx, { intensity_type: 'RPE' });
                  handleFocusSelect(idx, 'plannedRpe');
                }}
                onDoubleClick={(e) => handleDoubleClickAppend(idx, 'plannedRpe', e)}
                onChange={(e) => updatePrescription(idx, { plannedRpe: e.target.value ? parseFloat(e.target.value) : null })}
                className={`spreadsheet-input bg-transparent text-center w-full focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors ${s.intensity_type !== 'PERCENT' ? 'text-[#E5E5E5] text-[11px] font-bold' : 'text-[#666] text-[10px]'}`} 
                data-mode={getCellMode('plannedRpe')}
              />
            </div>
            
            {/* % Toggle Side */}
            <div 
              className={`h-full flex-1 flex items-center justify-center rounded-[4px] transition-colors duration-300 overflow-hidden ${s.intensity_type === 'PERCENT' ? 'bg-[#2A2A2D]' : 'bg-transparent'}`}
              onClick={handleCellClick}
            >
              <input 
                type="number"
                data-field="target_value"
                onKeyDown={(e) => handleKeyDown(e, idx, 'target_value')}
                value={s.target_value || ''}
                placeholder={prescPct > 0 ? prescPct.toString() : ''}
                onFocus={() => {
                  if (s.intensity_type !== 'PERCENT') updatePrescription(idx, { intensity_type: 'PERCENT' });
                  handleFocusSelect(idx, 'target_value');
                }}
                onDoubleClick={(e) => handleDoubleClickAppend(idx, 'target_value', e)}
                onChange={(e) => updatePrescription(idx, { target_value: e.target.value ? parseFloat(e.target.value) : undefined })}
                className={`spreadsheet-input bg-transparent text-right w-full focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 transition-colors pl-1 pr-[2px] ${s.intensity_type === 'PERCENT' ? 'text-[#E5E5E5] text-[11px] font-bold' : 'text-[#666] text-[10px]'}`} 
                data-mode={getCellMode('target_value')}
              />
              <span className={`pr-1 pl-0.5 pointer-events-none transition-colors ${s.intensity_type === 'PERCENT' ? 'text-[#888] text-[10px] font-bold' : 'text-[#555] text-[9px]'}`}>%</span>
            </div>
          </div>
          {showToggles && <button tabIndex={-1} className="px-1.5 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer rounded-r-[6px]" onClick={() => {
            if (s.intensity_type === 'PERCENT') updatePrescription(idx, { target_value: (s.target_value || 0) + 1 });
            else updatePrescription(idx, { plannedRpe: (s.plannedRpe || 0) + 0.5 });
          }}>▲</button>}
        </div>
      </td>
      <td className={`px-1 relative transition-all duration-300 ${showToggles ? 'min-w-[90px] w-[12%]' : 'min-w-[50px] w-[8%]'}`}>
        <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] flex items-center justify-between text-[#888] text-[11px] font-bold overflow-hidden focus-within:border-[#444] transition-colors h-[34px]" data-active={isCellActive('plannedWeight')} data-mode={getCellMode('plannedWeight')} onClick={handleCellClick}>
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => updatePrescription(idx, { plannedWeight: Math.max(0, (s.plannedWeight || 0) - 2.5) })}>▼</button>}
          <div className="relative w-full flex items-center justify-center">
            <input 
              type="number" 
              data-field="plannedWeight"
              onKeyDown={(e) => handleKeyDown(e, idx, 'plannedWeight')}
              onFocus={() => handleFocusSelect(idx, 'plannedWeight')}
              onDoubleClick={(e) => handleDoubleClickAppend(idx, 'plannedWeight', e)}
              value={s.plannedWeight === null ? '' : s.plannedWeight} 
              placeholder="W"
              onChange={(e) => updatePrescription(idx, { plannedWeight: e.target.value ? parseFloat(e.target.value) : null })}
              className="spreadsheet-input bg-transparent text-[#E5E5E5] text-center w-full focus:outline-none placeholder-[#444] appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
              data-mode={getCellMode('plannedWeight')}
            />
          </div>
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => updatePrescription(idx, { plannedWeight: (s.plannedWeight || 0) + 2.5 })}>▲</button>}
        </div>
      </td>
      
      {/* E1RM (Middle Separator) - Weight Adjusting Drop % */}
      <td className={`px-1 relative transition-all duration-300 ${showToggles ? 'min-w-[110px] w-[14%]' : 'min-w-[80px] w-[10%]'}`}>
        <div className="flex flex-col items-center justify-center w-full h-full min-h-[34px]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center min-h-[34px] w-full">
            {/* Spacer to balance the grid and keep the box centered */}
            <div className="w-full"></div>
            
            {/* Base E1RM Box (Perfectly Centered) */}
            <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] min-h-[34px] w-full max-w-[75px] flex flex-col items-center justify-center py-1 focus-within:border-[#444] transition-colors relative" data-active={isCellActive('baseline_e1rm')} data-mode={getCellMode('baseline_e1rm')} onClick={handleCellClick}>
              <input
                type="number"
                data-field="baseline_e1rm"
                onKeyDown={(e) => handleKeyDown(e, idx, 'baseline_e1rm')}
                onFocus={() => handleFocusSelect(idx, 'baseline_e1rm')}
                onDoubleClick={(e) => handleDoubleClickAppend(idx, 'baseline_e1rm', e)}
                value={s.baseline_e1rm !== undefined ? Number(s.baseline_e1rm.toFixed(1)) : (plannedE1RM > 0 ? Number(plannedE1RM.toFixed(1)) : '')}
                placeholder="—"
                onChange={(e) => {
                  const val = e.target.value ? parseFloat(e.target.value) : undefined;
                  updatePrescription(idx, { baseline_e1rm: val });
                }}
                className="spreadsheet-input bg-transparent text-[#E5E5E5] text-[11px] font-bold text-center w-full focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                data-mode={getCellMode('baseline_e1rm')}
              />
              {!!s.dropPercent && s.dropPercent !== 0 && (
                <div className="text-[9px] font-bold tracking-wider text-[#AEAEB2] flex items-center justify-center gap-0.5 w-full pointer-events-none leading-none mt-0.5">
                  <span>→</span>
                  <span>{droppedE1RM.toFixed(1)}</span>
                </div>
              )}
              {isE1RmOutOfSync && (
                <div 
                  className="absolute -right-3 top-1/2 -translate-y-1/2 cursor-pointer z-10"
                  onClick={(e) => { e.stopPropagation(); setAutoAdjustPopover({ idx, suggestedWeight, suggestedE1RM, currentWeight: s.plannedWeight || 0, currentE1RM: currentPrescE1RM }); }}
                >
                  <RefreshCw size={11} className="text-orange-500 hover:text-orange-400" />
                </div>
              )}
            </div>
            
            {/* Drop % Box (Floating Right) */}
            <div className="flex items-center h-full pl-1.5 justify-start" data-active={isCellActive('dropPercent')} data-mode={getCellMode('dropPercent')} onClick={handleCellClick}>
              {showToggles && <button tabIndex={-1} className="px-0.5 text-[#444] hover:text-[#888] transition-colors cursor-pointer" onClick={() => updatePrescription(idx, { dropPercent: (s.dropPercent || 0) - 0.5 })}>▼</button>}
              <input
                type="number"
                data-field="dropPercent"
                onKeyDown={(e) => handleKeyDown(e, idx, 'dropPercent')}
                onFocus={() => handleFocusSelect(idx, 'dropPercent')}
                onDoubleClick={(e) => handleDoubleClickAppend(idx, 'dropPercent', e)}
                value={s.dropPercent || ''}
                placeholder="0"
                onChange={(e) => {
                  updatePrescription(idx, { dropPercent: e.target.value ? parseFloat(e.target.value) : undefined });
                }}
                className="spreadsheet-input bg-transparent text-[#FF453A] text-center w-6 text-[10px] font-bold tracking-wider focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                data-mode={getCellMode('dropPercent')}
              />
              <span className="text-[#FF453A] text-[9px] font-bold pr-0.5 pointer-events-none">%</span>
              {showToggles && <button tabIndex={-1} className="px-0.5 text-[#444] hover:text-[#888] transition-colors cursor-pointer" onClick={() => updatePrescription(idx, { dropPercent: (s.dropPercent || 0) + 0.5 })}>▲</button>}
            </div>
          </div>
        </div>
      </td>

      {/* EXECUTED COLUMNS */}
      <td className={`px-1 transition-all duration-300 ${showToggles ? 'min-w-[70px] w-[8%]' : 'min-w-[40px] w-[5%]'}`}>
        <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] flex items-center justify-between text-[#E5E5E5] text-[11px] font-bold overflow-hidden focus-within:border-[#444] transition-colors h-[34px]" data-active={isCellActive('reps')} data-mode={getCellMode('reps')} onClick={handleCellClick}>
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleLoggedChange(idx, 'reps', Math.max(0, (s.reps || 0) - 1))}>▼</button>}
          <input 
            type="number" 
            data-field="reps"
            onKeyDown={(e) => handleKeyDown(e, idx, 'reps')}
            onFocus={() => handleFocusSelect(idx, 'reps')}
            onDoubleClick={(e) => handleDoubleClickAppend(idx, 'reps', e)}
            value={s.reps === null ? '' : s.reps} 
            placeholder="R"
            onChange={(e) => handleLoggedChange(idx, 'reps', e.target.value ? parseInt(e.target.value) : null)}
            className="spreadsheet-input bg-transparent text-center w-full focus:outline-none placeholder-[#444] appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
            data-mode={getCellMode('reps')}
          />
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleLoggedChange(idx, 'reps', (s.reps || 0) + 1)}>▲</button>}
        </div>
      </td>
      <td className={`px-1 transition-all duration-300 ${showToggles ? 'min-w-[90px] w-[10%]' : 'min-w-[50px] w-[7%]'}`}>
        {/* Executed RPE Box */}
        <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] h-[34px] flex items-center justify-between focus-within:border-[#444] transition-colors relative" data-active={isCellActive('executedRpe')} data-mode={getCellMode('executedRpe')} onClick={handleCellClick}>
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleLoggedChange(idx, 'executedRpe', Math.max(0, (s.executedRpe || 0) - 0.5))}>▼</button>}
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
            className="spreadsheet-input bg-transparent text-[#E5E5E5] text-[11px] font-bold text-center w-full focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
            data-mode={getCellMode('executedRpe')}
          />
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleLoggedChange(idx, 'executedRpe', (s.executedRpe || 0) + 0.5)}>▲</button>}
        </div>
      </td>
      <td className={`px-1 transition-all duration-300 ${showToggles ? 'min-w-[90px] w-[12%]' : 'min-w-[50px] w-[8%]'}`}>
        <div className="spreadsheet-cell bg-[#18181A] border border-white/5 rounded-[6px] flex items-center justify-between text-[#E5E5E5] text-[11px] font-bold overflow-hidden focus-within:border-[#444] transition-colors h-[34px]" data-active={isCellActive('actual')} data-mode={getCellMode('actual')} onClick={handleCellClick}>
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleLoggedChange(idx, 'actual', Math.max(0, (s.actual || 0) - 2.5))}>▼</button>}
          <input 
            type="number" 
            data-field="actual"
            onKeyDown={(e) => handleKeyDown(e, idx, 'actual')}
            onFocus={() => handleFocusSelect(idx, 'actual')}
            onDoubleClick={(e) => handleDoubleClickAppend(idx, 'actual', e)}
            value={s.actual === null ? '' : s.actual} 
            placeholder="—"
            onChange={(e) => handleLoggedChange(idx, 'actual', e.target.value ? parseFloat(e.target.value) : null)}
            className="spreadsheet-input bg-transparent text-center w-full focus:outline-none placeholder-[#444] appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
            data-mode={getCellMode('actual')}
          />
          {showToggles && <button tabIndex={-1} className="px-2 py-2 text-[#444] hover:text-[#888] hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleLoggedChange(idx, 'actual', (s.actual || 0) + 2.5)}>▲</button>}
        </div>
      </td>
      <td className={`px-1 relative text-center transition-all duration-300 ${showToggles ? 'min-w-[90px] w-[12%]' : 'min-w-[60px] w-[10%]'}`}>
        {/* Executed % Text (ReadOnly) */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center h-full">
          <span className="text-[#888] text-[11px] font-bold cursor-default">
            {execPct > 0 ? execPct.toFixed(1) : ''}<span className="text-[10px]">%</span>
          </span>
        </div>
        <div className={`h-[34px] flex flex-col items-center justify-center transition-colors pl-6 ${currentE1RM > 0 ? 'text-[#E5E5E5]' : 'text-[#444]'}`}>
          <span className={`text-[11px] font-bold ${executionVarianceNode ? 'mt-1 leading-none' : ''}`}>
            {currentE1RM > 0 ? currentE1RM.toFixed(1) : '—'}
          </span>
          {executionVarianceNode}
        </div>
      </td>

      {/* ACTIONS */}
      <td className="px-2 text-center w-12">
        <button onClick={() => onDuplicate(idx, s)} 
          className="text-[#555] hover:text-white transition-colors cursor-pointer flex justify-center w-full" title="Duplicate">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </td>
      <td className="px-2 text-center w-12">
        <button onClick={() => onDelete(idx)} className="text-[#555] hover:text-[#FF453A] transition-colors cursor-pointer flex justify-center w-full" title="Delete">
          <Trash2 size={13} />
        </button>
      </td>
      <td className="px-1 text-center">
        {s.actual ? <Check size={12} className="text-[#34C759] mx-auto" /> : <span className="text-[#444]">—</span>}
      </td>
    </tr>

    {/* INLINE AUTO ADJUST BANNER */}
    {autoAdjustPopover?.idx === idx && (
      <tr>
        <td colSpan={13} className="pt-1 pb-4">
          <div className="bg-[#18181A] border border-orange-500/20 rounded-[8px] p-3 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg ml-8 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500"></div>
            <div className="flex flex-col gap-2 pl-2">
              <div className="flex items-center gap-2 text-white text-[12px] font-bold">
                <RefreshCw size={12} className="text-orange-500" />
                <span>Adjust to today's performance?</span>
              </div>
              <div className="flex items-center gap-6 text-[11px] font-mono mt-1">
                {(() => {
                  const deltaE1RM = autoAdjustPopover.suggestedE1RM - autoAdjustPopover.currentE1RM;
                  const deltaWeight = autoAdjustPopover.suggestedWeight - autoAdjustPopover.currentWeight;
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[#888]">Weight:</span>
                        <span className="text-[#AEAEB2]">{autoAdjustPopover.currentWeight}kg</span>
                        <span className="text-[#555]">→</span>
                        <span className="text-white font-bold">{autoAdjustPopover.suggestedWeight}kg</span>
                        <span className={`${deltaWeight >= 0 ? 'text-[#34C759]' : 'text-[#FF453A]'} font-bold`}>
                          ({deltaWeight > 0 ? '+' : ''}{deltaWeight.toFixed(1)}kg)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#888]">E1RM:</span>
                        <span className="text-[#AEAEB2]">{autoAdjustPopover.currentE1RM.toFixed(1)}</span>
                        <span className="text-[#555]">→</span>
                        <span className="text-white font-bold">{autoAdjustPopover.suggestedE1RM.toFixed(1)}</span>
                        <span className={`${deltaE1RM >= 0 ? 'text-[#34C759]' : 'text-[#FF453A]'} font-bold`}>
                          ({deltaE1RM > 0 ? '+' : ''}{deltaE1RM.toFixed(1)})
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => applyAutoAdjust(idx, false)} className="bg-white/10 hover:bg-white/20 text-white rounded px-3 py-2 text-[11px] font-bold transition-colors cursor-pointer">This set</button>
              <button onClick={() => applyAutoAdjust(idx, true)} className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded px-3 py-2 text-[11px] font-bold transition-colors cursor-pointer">All remaining</button>
              <button onClick={() => setAutoAdjustPopover(null)} className="text-[#888] hover:text-white rounded px-2 py-2 text-[11px] font-bold transition-colors cursor-pointer ml-1">Dismiss</button>
            </div>
          </div>
        </td>
      </tr>
    )}
    </React.Fragment>
  );
});

import { useState, useEffect, RefObject, MutableRefObject } from 'react';
import type { SetData } from '../types';

export const COLUMNS = ['plannedReps', 'plannedRpe', 'target_value', 'plannedWeight', 'baseline_e1rm', 'dropPercent', 'reps', 'executedRpe', 'actual'];

export type CellMode = 'NAV' | 'EDIT';
export type ActiveCell = { rowIdx: number; field: string; mode: CellMode } | null;

interface UseSpreadsheetNavigationProps {
  sets: SetData[];
  updatePrescription: (idx: number, updates: Partial<SetData>) => void;
  rowRefs: MutableRefObject<HTMLTableRowElement[]>;
  cardRef: RefObject<HTMLDivElement>;
}

export function useSpreadsheetNavigation({ sets, updatePrescription, rowRefs, cardRef }: UseSpreadsheetNavigationProps) {
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);

  // Clickaway listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isInsideCard = cardRef.current && cardRef.current.contains(target);
      const isCellOrButton = target.closest('.spreadsheet-cell') !== null || target.closest('button') !== null || target.tagName === 'INPUT';
      
      if (!isInsideCard || !isCellOrButton) {
        setActiveCell(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [cardRef]);

  // Focus effect
  useEffect(() => {
    if (activeCell) {
      const row = rowRefs.current[activeCell.rowIdx];
      if (row) {
        const input = row.querySelector(`input[data-field="${activeCell.field}"]`) as HTMLInputElement;
        if (input && document.activeElement !== input) {
          input.focus();
        }
      }
    }
  }, [activeCell, rowRefs]);

  const enterEditMode = (target: HTMLInputElement, rIdx: number, f: string) => {
    setActiveCell({ rowIdx: rIdx, field: f, mode: 'EDIT' });
    setTimeout(() => {
      try {
        target.type = 'text';
        target.setSelectionRange(target.value.length, target.value.length);
        target.type = 'number';
      } catch(err) {}
    }, 0);
  };

  const handleFocusSelect = (rowIndex: number, field: string) => {
    if (activeCell?.rowIdx !== rowIndex || activeCell?.field !== field) {
      setActiveCell({ rowIdx: rowIndex, field, mode: 'NAV' });
    }
  };

  const handleDoubleClickAppend = (rowIndex: number, field: string, e: React.MouseEvent<HTMLInputElement>) => {
    enterEditMode(e.target as HTMLInputElement, rowIndex, field);
  };

  const handleCellClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).closest('button')) return;
    const input = e.currentTarget.querySelector('input');
    if (input) input.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, field: string) => {
    const isNav = activeCell?.rowIdx === rowIndex && activeCell?.field === field && activeCell.mode === 'NAV';

    if (e.ctrlKey || e.metaKey) {
      if (isNav) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setActiveCell({ rowIdx: rowIndex, field: COLUMNS[COLUMNS.length - 1], mode: 'NAV' });
          return;
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setActiveCell({ rowIdx: rowIndex, field: COLUMNS[0], mode: 'NAV' });
          return;
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveCell({ rowIdx: sets.length - 1, field, mode: 'NAV' });
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveCell({ rowIdx: 0, field, mode: 'NAV' });
          return;
        }
      } else {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const target = e.target as HTMLInputElement;
          try {
            target.type = 'text';
            if (e.shiftKey) target.setSelectionRange(0, target.selectionEnd || 0);
            else target.setSelectionRange(0, 0);
            target.type = 'number';
          } catch(err) {}
          return;
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const target = e.target as HTMLInputElement;
          try {
            target.type = 'text';
            const len = target.value.length;
            if (e.shiftKey) target.setSelectionRange(target.selectionStart || 0, len);
            else target.setSelectionRange(len, len);
            target.type = 'number';
          } catch(err) {}
          return;
        }
      }
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (e.key === 'ArrowDown' && rowIndex < sets.length - 1) setActiveCell({ rowIdx: rowIndex + 1, field, mode: 'NAV' });
      if (e.key === 'ArrowUp' && rowIndex > 0) setActiveCell({ rowIdx: rowIndex - 1, field, mode: 'NAV' });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (rowIndex > 0) setActiveCell({ rowIdx: rowIndex - 1, field, mode: 'NAV' });
        else if (!isNav) setActiveCell({ rowIdx: rowIndex, field, mode: 'NAV' });
      } else {
        if (isNav) {
          enterEditMode(e.target as HTMLInputElement, rowIndex, field);
        } else {
          if (rowIndex < sets.length - 1) setActiveCell({ rowIdx: rowIndex + 1, field, mode: 'NAV' });
          else setActiveCell({ rowIdx: rowIndex, field, mode: 'NAV' });
        }
      }
      return;
    }
    
    const currentLogicalCol = (field === 'plannedRpe' || field === 'target_value') ? 'intensity' : field;
    const logicalColumns = COLUMNS.map(c => (c === 'plannedRpe' || c === 'target_value') ? 'intensity' : c).filter((v, i, a) => a.indexOf(v) === i);
    const currentIdx = logicalColumns.indexOf(currentLogicalCol);

    if (e.key === 'ArrowRight' && isNav) {
      e.preventDefault();
      if (currentIdx < logicalColumns.length - 1) {
        let nextField = logicalColumns[currentIdx + 1];
        if (nextField === 'intensity') {
          nextField = sets[rowIndex].intensity_type === 'PERCENT' ? 'target_value' : 'plannedRpe';
        }
        setActiveCell({ rowIdx: rowIndex, field: nextField, mode: 'NAV' });
      }
      return;
    }
    
    if (e.key === 'ArrowLeft' && isNav) {
      e.preventDefault();
      if (currentIdx > 0) {
        let nextField = logicalColumns[currentIdx - 1];
        if (nextField === 'intensity') {
          nextField = sets[rowIndex].intensity_type === 'PERCENT' ? 'target_value' : 'plannedRpe';
        }
        setActiveCell({ rowIdx: rowIndex, field: nextField, mode: 'NAV' });
      }
      return;
    }
    
    if (isNav && e.key.toLowerCase() === 't' && (field === 'plannedRpe' || field === 'target_value')) {
      e.preventDefault();
      const s = sets[rowIndex];
      const newType = s.intensity_type === 'PERCENT' ? 'RPE' : 'PERCENT';
      const newField = newType === 'PERCENT' ? 'target_value' : 'plannedRpe';
      updatePrescription(rowIndex, { intensity_type: newType });
      setActiveCell({ rowIdx: rowIndex, field: newField, mode: 'NAV' });
      return;
    }

    if (isNav && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const target = e.target as HTMLInputElement;
      try { target.select(); } catch (err) {}
      setActiveCell({ rowIdx: rowIndex, field, mode: 'EDIT' });
      return;
    }
    
    if (isNav && (e.key === 'Backspace' || e.key === 'Delete')) {
      const target = e.target as HTMLInputElement;
      target.value = '';
      try { target.select(); } catch (err) {}
      setActiveCell({ rowIdx: rowIndex, field, mode: 'EDIT' });
      return;
    }
    
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
      setActiveCell(null);
    }
  };

  return {
    activeCell,
    setActiveCell,
    handleKeyDown,
    handleFocusSelect,
    handleDoubleClickAppend,
    handleCellClick
  };
}

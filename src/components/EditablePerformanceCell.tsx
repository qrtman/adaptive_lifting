import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Minus, Plus, X } from 'lucide-react';
import {
  reduceCellKey,
  type CellKeyEffect,
  type SetGridBind,
} from '../services/sheetsCellKeyboard';

export const EditablePerformanceCell = ({
  value: rawValue,
  onChange,
  placeholder = "—",
  fieldKey,
  label,
  widthClass = "w-16",
  isLogged = false,
  isAuto = false,
  suggestedValue = null,
  step = 1,
  variant = "default",
  rowIndex,
  grid,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  fieldKey: string;
  label: string;
  widthClass?: string;
  isLogged?: boolean;
  isAuto?: boolean;
  suggestedValue?: string | null;
  step?: number;
  variant?: "default" | "transparent";
  rowIndex?: number;
  grid: SetGridBind;
}) => {
  const value = rawValue === "---" ? "" : rawValue;
  const [activeCell, setActiveCell] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [composing, setComposing] = useState(false);
  const displayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const blurAwayRef = useRef(false);

  const isEditing = !isMobile && grid.isActive && grid.mode === 'editing';
  const isSelected = !isMobile && grid.isActive && grid.mode === 'selected';
  const domId = rowIndex !== undefined ? `cell-${fieldKey}-${rowIndex}` : undefined;
  const editDefault = grid.editOverwrite && grid.editSeed !== undefined ? grid.editSeed : (value || '');

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || navigator.maxTouchPoints > 0);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useLayoutEffect(() => {
    if (isMobile || !grid.isActive) return;
    if (isEditing) {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      return;
    }
    if (blurAwayRef.current) {
      blurAwayRef.current = false;
      return;
    }
    displayRef.current?.focus({ preventScroll: true });
  }, [isMobile, grid.isActive, isEditing]);

  const handlePickerPreset = (presetValue: number | string) => {
    onChange(presetValue.toString());
  };

  const handlePickerStep = (isIncrement: boolean) => {
    const currentVal = parseFloat(value) || 0;
    let newVal;
    if (isIncrement) {
      newVal = currentVal + step;
    } else {
      newVal = Math.max(0, currentVal - step);
    }
    onChange(newVal.toString());
  };

  const getPresetsForField = () => {
    if (fieldKey.toLowerCase().includes('reps')) {
      return [1, 2, 3, 4, 5, 6, 8, 10];
    }
    if (fieldKey.toLowerCase().includes('rpe')) {
      return [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];
    }
    return [40, 60, 80, 100, 120, 140, 150, 160];
  };

  const applyEffect = (event: KeyboardEvent, effect: CellKeyEffect, currentDraft: string) => {
    if (effect.type === 'none' || effect.type === 'ignore' || effect.type === 'caret') {
      return;
    }
    if ('preventDefault' in effect && effect.preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (effect.type === 'noop') return;

    if (effect.type === 'move') {
      grid.onMove(grid.row, grid.col, effect.direction, effect.kind);
      return;
    }
    if (effect.type === 'beginEdit') {
      flushSync(() => {
        grid.onBeginEdit(grid.row, grid.col, effect.overwrite, effect.draft);
      });
      return;
    }
    if (effect.type === 'clear') {
      onChange('');
      return;
    }
    if (effect.type === 'commit') {
      skipBlurRef.current = true;
      onChange(currentDraft);
      grid.onCommit(grid.row, grid.col, currentDraft, effect.move, effect.kind);
      return;
    }
    if (effect.type === 'cancel') {
      skipBlurRef.current = true;
      grid.onCancel(grid.row, grid.col);
      return;
    }
    if (effect.type === 'copy') {
      void navigator.clipboard.writeText(value).catch(() => {});
      return;
    }
    if (effect.type === 'paste') {
      void navigator.clipboard.readText().then((text) => {
        const first = (text.split(/\r?\n/)[0] ?? '').replace(/\t/g, '');
        onChange(first);
      }).catch(() => {});
    }
  };

  const handleDisplayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isMobile) return;
    const effect = reduceCellKey(
      { mode: 'selected', composing },
      {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
      },
    );
    applyEffect(event, effect, value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const el = event.currentTarget;
    const effect = reduceCellKey(
      {
        mode: 'editing',
        composing: composing || event.nativeEvent.isComposing,
        caretAtStart: el.selectionStart === 0 && el.selectionEnd === 0,
        caretAtEnd: el.selectionStart === el.value.length && el.selectionEnd === el.value.length,
      },
      {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
      },
    );
    applyEffect(event, effect, el.value);
  };

  const handleClick = () => {
    if (isMobile) {
      setActiveCell(true);
      return;
    }
    if (isSelected) {
      grid.onBeginEdit(grid.row, grid.col, false);
    } else {
      grid.onSelect(grid.row, grid.col);
    }
  };

  const handleDoubleClick = () => {
    if (isMobile) return;
    grid.onBeginEdit(grid.row, grid.col, false);
  };

  const displayValue = value
    ? value
    : isAuto && suggestedValue
      ? suggestedValue
      : placeholder;

  const selectedRing = isSelected ? 'border-[var(--cal-accent)] ring-1 ring-[var(--cal-accent)]' : '';

  const sharedAttrs = {
    id: domId,
    'data-cell-id': grid.cellId,
    'data-testid': fieldKey,
    'data-grid-mode': grid.isActive && !isMobile ? grid.mode : undefined,
    'aria-label': label,
  };

  return (
    <>
      {isEditing ? (
        <input
          key={`${grid.cellId}-edit-${grid.editOverwrite ? grid.editSeed ?? '' : 'insert'}`}
          ref={inputRef}
          autoFocus
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          {...sharedAttrs}
          defaultValue={editDefault}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onBlur={(e) => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            const next = e.relatedTarget as HTMLElement | null;
            if (next && !next.closest('[data-cell-id]')) {
              blurAwayRef.current = true;
            }
            onChange(e.target.value);
            grid.onCommit(grid.row, grid.col, e.target.value);
          }}
          onKeyDown={handleInputKeyDown}
          className={`${variant === "transparent" ? "w-12 py-0 text-center text-xs" : `${widthClass} py-0 h-6 text-center text-xs`} bg-[var(--cal-surface-card)] border ${
            isLogged ? 'border-[var(--cal-success)] text-[var(--cal-success)]' : 'border-[var(--cal-accent)] text-[var(--cal-ink)]'
          } rounded-sm tnum focus:outline-none`}
        />
      ) : variant === "transparent" ? (
        <div
          ref={displayRef}
          {...sharedAttrs}
          tabIndex={isMobile ? -1 : (grid.tabStop ? 0 : -1)}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleDisplayKeyDown}
          onCopy={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', value);
          }}
          onPaste={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            const text = (e.clipboardData.getData('text/plain').split(/\r?\n/)[0] ?? '').replace(/\t/g, '');
            onChange(text);
          }}
          className={`${widthClass} h-6 flex items-center justify-center cursor-pointer select-none ${selectedRing}`}
        >
          <span className={`text-xs tnum ${value ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}`}>
            {value ? value : placeholder}
          </span>
        </div>
      ) : (
        <div
          ref={displayRef}
          {...sharedAttrs}
          tabIndex={isMobile ? -1 : (grid.tabStop ? 0 : -1)}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleDisplayKeyDown}
          onCopy={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', value);
          }}
          onPaste={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            const text = (e.clipboardData.getData('text/plain').split(/\r?\n/)[0] ?? '').replace(/\t/g, '');
            onChange(text);
          }}
          className={`${widthClass} h-6 rounded-sm text-center text-xs tnum cursor-pointer border flex items-center justify-center ${
            isSelected
              ? `border-[var(--cal-accent)] ring-1 ring-[var(--cal-accent)] ${isLogged && value ? 'text-[var(--cal-success)]' : value ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}`
              : isLogged
                ? value
                  ? 'border-[color-mix(in_srgb,var(--cal-success)_40%,transparent)] text-[var(--cal-success)]'
                  : 'border-[var(--cal-hairline)] text-[var(--cal-muted-soft)]'
                : value
                  ? 'border-[var(--cal-hairline)] text-[var(--cal-ink)]'
                  : isAuto && suggestedValue
                    ? 'border-dashed border-[color-mix(in_srgb,var(--cal-accent)_40%,transparent)] text-[color-mix(in_srgb,var(--cal-accent)_70%,transparent)]'
                    : 'border-[var(--cal-hairline)] text-[var(--cal-muted-soft)]'
          }`}
        >
          {displayValue}
        </div>
      )}

      <AnimatePresence>
        {activeCell && (
          <div className="fixed inset-0 z-50 flex items-end justify-center select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveCell(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="relative w-full max-w-md bg-zinc-950 border-t border-white/10 rounded-t-3xl shadow-2xl p-6 pb-12 z-10 flex flex-col space-y-6"
            >
              <div className="w-12 h-1 bg-white/15 rounded-full mx-auto" />

              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">
                    Quick Adjuster
                  </span>
                  <h3 className="text-xl font-black text-white uppercase tracking-wider">
                    {label}
                  </h3>
                </div>
                <button
                  onClick={() => setActiveCell(false)}
                  className="p-2 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-col items-center justify-center py-4 relative bg-white/[0.02] rounded-2xl border border-white/5 mx-2">
                <span className={`text-6xl font-black tracking-widest tnum select-none ${
                  isLogged ? 'text-[var(--cal-success)]' : 'text-[var(--cal-accent)]'
                }`}>
                  {value || suggestedValue || "—"}
                </span>
                {fieldKey.toLowerCase().includes('weight') && (
                  <span className="text-[12px] font-black text-[color-mix(in_srgb,var(--cal-accent)_80%,transparent)] uppercase tracking-widest mt-2">
                    KILOGRAMS (kg)
                  </span>
                )}
              </div>

              <div className="flex flex-col space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => handlePickerStep(false)}
                    className="flex-1 py-5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/5 hover:border-white/10 rounded-2xl flex items-center justify-center text-white transition-all cursor-pointer shadow-lg"
                  >
                    <Minus size={24} className="stroke-[3]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePickerStep(true)}
                    className="flex-1 py-5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/5 hover:border-white/10 rounded-2xl flex items-center justify-center text-white transition-all cursor-pointer shadow-lg"
                  >
                    <Plus size={24} className="stroke-[3]" />
                  </button>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Tap Preset
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {getPresetsForField().map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handlePickerPreset(preset)}
                        className={`py-3 rounded-xl text-center text-lg font-black transition-all cursor-pointer border ${
                          value === preset.toString()
                            ? isLogged
                              ? 'bg-[var(--cal-success)] border-[var(--cal-success)] text-[var(--cal-on-primary)] shadow-[0_0_15px_color-mix(in_srgb,var(--cal-success)_30%,transparent)]'
                              : 'bg-[var(--cal-accent)] border-[var(--cal-accent)] text-[var(--cal-on-primary)] shadow-[0_0_15px_color-mix(in_srgb,var(--cal-accent)_30%,transparent)]'
                            : 'bg-[var(--cal-surface-soft)] border-[var(--cal-hairline-soft)] text-[var(--cal-body)] hover:bg-[var(--cal-surface-card)] hover:border-[var(--cal-hairline)]'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveCell(false)}
                className="w-full py-4 bg-white/10 hover:bg-white/15 text-white font-black uppercase text-center rounded-2xl transition-all tracking-widest cursor-pointer text-[14px] font-sans border border-white/5"
              >
                Let's Lift
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

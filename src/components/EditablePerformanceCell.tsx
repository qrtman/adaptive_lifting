import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
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
  suffix = "",
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
  suffix?: string;
  rowIndex?: number;
  grid: SetGridBind;
}) => {
  const value = rawValue === "---" ? "" : rawValue;
  const [composing, setComposing] = useState(false);
  const displayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const blurAwayRef = useRef(false);

  const isEditing = grid.isActive && grid.mode === 'editing';
  const isSelected = grid.isActive && grid.mode === 'selected';
  const domId = rowIndex !== undefined ? `cell-${fieldKey}-${rowIndex}` : undefined;
  const editDefault = grid.editOverwrite && grid.editSeed !== undefined ? grid.editSeed : (value || '');

  useLayoutEffect(() => {
    if (!grid.isActive) return;
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
  }, [grid.isActive, isEditing]);

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
    if (isSelected) {
      grid.onBeginEdit(grid.row, grid.col, false);
    } else {
      grid.onSelect(grid.row, grid.col);
    }
  };

  const handleDoubleClick = () => {
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
    'data-grid-mode': grid.isActive ? grid.mode : undefined,
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
          tabIndex={grid.tabStop ? 0 : -1}
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
          tabIndex={grid.tabStop ? 0 : -1}
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
          {displayValue}{suffix ? <span className="ml-0.5 text-[var(--cal-muted)]">{suffix}</span> : null}
        </div>
      )}

    </>
  );
};

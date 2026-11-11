import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
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
  readOnly = false,
  suggestedValue = null,
  ghost = null,
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
  /** Selectable (moves, ranges, copy, paste-from-here) but never opens an editor. */
  readOnly?: boolean;
  suggestedValue?: string | null;
  /** Faint target shown while the cell is empty (e.g. the Plan value in a Log cell). Display only. */
  ghost?: string | null;
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

  // A key commit/cancel (Enter, Tab, Esc) sets skipBlurRef, but the input then unmounts
  // without a blur, so the flag would leak into the next edit of this cell and that edit
  // would be dropped on click-away. Every new edit session starts with it cleared.
  useLayoutEffect(() => {
    if (isEditing) skipBlurRef.current = false;
  }, [isEditing]);

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

  const copyText = () => (grid.copyText ? grid.copyText() : value);
  const pasteText = (text: string) => {
    if (grid.onPasteText) {
      grid.onPasteText(text);
      return;
    }
    onChange((text.split(/\r?\n/)[0] ?? '').replace(/\t/g, ''));
  };

  const applyEffect = (event: KeyboardEvent, effect: CellKeyEffect, currentDraft: string) => {
    if (effect.type === 'none' || effect.type === 'ignore' || effect.type === 'caret') {
      return;
    }
    if (effect.type === 'range') {
      // Esc is only claimed when a range actually collapsed.
      const handled = grid.onRangeCommand?.(effect.command) ?? false;
      if (handled || effect.preventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }
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
      if (readOnly) return;
      flushSync(() => {
        grid.onBeginEdit(grid.row, grid.col, effect.overwrite, effect.draft);
      });
      return;
    }
    if (effect.type === 'extend') {
      grid.onExtend?.(effect.direction);
      return;
    }
    if (effect.type === 'clear') {
      if (grid.onClearRange) grid.onClearRange();
      else onChange('');
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
      void navigator.clipboard?.writeText(copyText()).catch(() => {});
      return;
    }
    if (effect.type === 'paste') {
      void navigator.clipboard?.readText().then(pasteText).catch(() => {});
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

  // The table selects on mousedown (for drag ranges), so remember whether this cell was
  // already the single selected cell before that; only then does the click start editing.
  const wasSelectedRef = useRef<boolean | null>(null);
  const handleMouseDown = () => {
    wasSelectedRef.current = isSelected && !grid.inRange;
  };
  const handleClick = (event: MouseEvent) => {
    if (event.shiftKey) return;
    // No mousedown seen (keyboard/synthetic click): judge by the current selection.
    const wasSelected = wasSelectedRef.current ?? isSelected;
    wasSelectedRef.current = null;
    if (wasSelected) {
      if (!readOnly) grid.onBeginEdit(grid.row, grid.col, false);
    } else if (!isSelected) {
      grid.onSelect(grid.row, grid.col);
    }
  };

  const handleDoubleClick = () => {
    if (!readOnly) grid.onBeginEdit(grid.row, grid.col, false);
  };

  const showGhost = !value && Boolean(ghost);
  const displayValue = value
    ? value
    : showGhost
      ? ghost
      : isAuto && suggestedValue
        ? suggestedValue
        : placeholder;


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
          className={`${variant === "transparent" ? "w-12" : widthClass} sheet-cell sheet-cell--editing h-9 px-3 text-right text-sm tnum bg-[var(--cal-surface-card)] text-[var(--cal-ink)] outline-none`}
        />
      ) : variant === "transparent" ? (
        <div
          ref={displayRef}
          {...sharedAttrs}
          tabIndex={grid.tabStop ? 0 : -1}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleDisplayKeyDown}
          onCopy={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', copyText());
          }}
          onPaste={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            pasteText(e.clipboardData.getData('text/plain'));
          }}
          data-selected={isSelected ? 'true' : undefined}
          data-in-range={grid.inRange && !grid.isActive ? 'true' : undefined}
          className={`${widthClass} sheet-cell h-9 px-3 flex items-center justify-end cursor-cell select-none`}
        >
          <span className={`text-sm tnum ${value ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}`}>
            {value ? value : placeholder}
          </span>
        </div>
      ) : (
        <div
          ref={displayRef}
          {...sharedAttrs}
          tabIndex={grid.tabStop ? 0 : -1}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleDisplayKeyDown}
          onCopy={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', copyText());
          }}
          onPaste={(e) => {
            if (!isSelected) return;
            e.preventDefault();
            pasteText(e.clipboardData.getData('text/plain'));
          }}
          data-selected={isSelected ? 'true' : undefined}
          data-in-range={grid.inRange && !grid.isActive ? 'true' : undefined}
          data-logged={isLogged && value ? 'true' : undefined}
          data-ghost={showGhost ? 'true' : undefined}
          title={showGhost ? 'Plan target · Ctrl/Cmd+Enter to accept' : undefined}
          className={`${widthClass} sheet-cell h-9 px-3 flex items-center justify-end text-sm tnum cursor-cell select-none ${
            value
              ? 'text-[var(--cal-ink)]'
              : showGhost
                ? 'text-[color-mix(in_srgb,var(--cal-muted-soft)_50%,transparent)]'
                : isAuto && suggestedValue
                ? 'italic text-[color-mix(in_srgb,var(--cal-accent)_70%,transparent)]'
                : 'text-[var(--cal-muted-soft)]'
          }`}
        >
          {displayValue}{suffix && value ? <span className="ml-0.5 text-[var(--cal-muted)]">{suffix}</span> : null}
        </div>
      )}

    </>
  );
};

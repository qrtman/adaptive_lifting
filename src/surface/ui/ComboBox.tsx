import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  size,
  useFloating,
} from '@floating-ui/react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

type MenuListener = (id: string | null) => void;
const menuListeners = new Set<MenuListener>();
let openMenuId: string | null = null;

export function subscribeOpenMenu(fn: MenuListener) {
  menuListeners.add(fn);
  return () => { menuListeners.delete(fn); };
}

export function setOpenMenu(id: string | null) {
  openMenuId = id;
  menuListeners.forEach((fn) => fn(id));
}

export function getOpenMenu() {
  return openMenuId;
}

export function AnchoredMenu({
  open,
  onOpenChange,
  reference,
  testId,
  listId,
  label,
  children,
  minWidth,
  placement = 'bottom-start',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: HTMLElement | null;
  testId?: string;
  listId?: string;
  label?: string;
  children: ReactNode;
  minWidth?: number;
  placement?: 'bottom-start' | 'right-start';
}): ReactElement | null {
  const { refs, floatingStyles } = useFloating({
    open,
    onOpenChange,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(0),
      flip({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            minWidth: `${Math.max(rects.reference.width, minWidth ?? 220)}px`,
            maxHeight: `${Math.min(280, availableHeight)}px`,
          });
        },
      }),
    ],
  });

  useEffect(() => {
    refs.setReference(reference);
  }, [reference, refs]);

  if (!open) return null;
  return (
    <FloatingPortal>
      <div ref={refs.setFloating} style={floatingStyles} className={`z-50 ${placement === 'right-start' ? 'pl-1.5' : 'pt-1.5'}`}>
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          data-testid={testId}
          className="max-h-[inherit] overflow-auto bg-card border border-border rounded shadow-[var(--sticky-shadow)] py-1"
        >
          {children}
        </ul>
      </div>
    </FloatingPortal>
  );
}

export function MenuOption({
  active,
  selected,
  testId,
  onEnter,
  onPick,
  children,
}: {
  active: boolean;
  selected?: boolean;
  testId?: string;
  onEnter: () => void;
  onPick: () => void;
  children: ReactNode;
  key?: string;
}): ReactElement {
  return (
    <li
      role="option"
      aria-selected={selected ?? active}
      data-testid={testId}
      className={`min-h-8 px-2 flex items-center text-caption cursor-pointer ${
        active ? 'bg-cell-selected text-fg-strong' : 'text-fg hover:bg-cell-hover'
      }`}
      onMouseEnter={onEnter}
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
    >
      {children}
    </li>
  );
}

export type ComboFlags = {
  allowEmpty?: boolean;
  allowCreate?: boolean;
  emptyLabel?: string;
};

export type ComboRow = {
  value: string;
  label: string;
  create?: boolean;
};

export function matchComboOptions(query: string, options: string[], flags: ComboFlags = {}): ComboRow[] {
  const allowEmpty = Boolean(flags.allowEmpty);
  const allowCreate = Boolean(flags.allowCreate);
  const emptyLabel = flags.emptyLabel || 'None';
  const q = query.trim().toLowerCase();
  const rows: ComboRow[] = [];
  if (allowEmpty && !q) rows.push({ value: '', label: emptyLabel });
  const filtered = q ? options.filter((item) => item.toLowerCase().includes(q)) : options.slice();
  for (const item of filtered) rows.push({ value: item, label: item });
  const exact = options.some((item) => item.toLowerCase() === q);
  if (allowCreate && query.trim() && !exact) {
    rows.push({ value: query.trim(), label: `Create “${query.trim()}”`, create: true });
  }
  return rows;
}

export function ComboBox({
  label,
  value,
  onChange,
  options,
  testId,
  allowEmpty = false,
  allowCreate = false,
  emptyLabel = 'None',
  placeholder = '',
  disabled = false,
  autoFocus = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  testId: string;
  allowEmpty?: boolean;
  allowCreate?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    if (open) setOpenMenu(testId);
    return () => {
      if (getOpenMenu() === testId) setOpenMenu(null);
    };
  }, [open, testId]);

  useEffect(() => subscribeOpenMenu((id) => {
    if (id && id !== testId) setOpen(false);
  }), [testId]);

  const rows = useMemo(
    () => matchComboOptions(open ? draft : '', options, { allowEmpty, allowCreate, emptyLabel }),
    [allowCreate, allowEmpty, draft, emptyLabel, open, options],
  );

  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1));
  }, [active, rows.length]);

  const commit = (next: string) => {
    onChange(next);
    setDraft(next);
    setOpen(false);
  };

  const closeWithoutCommit = () => {
    setDraft(value);
    setOpen(false);
  };

  const finish = () => {
    const next = draft.trim();
    if (allowCreate) {
      commit(next);
      return;
    }
    if (options.includes(next) || (allowEmpty && next === '')) {
      commit(next);
      return;
    }
    closeWithoutCommit();
  };

  const maybeOpen = () => {
    if (matchComboOptions(draft, options, { allowEmpty, allowCreate, emptyLabel }).length) setOpen(true);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((index) => Math.min(rows.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (row) commit(row.value);
      else if (allowCreate && draft.trim()) commit(draft.trim());
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (open) closeWithoutCommit();
      else inputRef.current?.blur();
    }
  };

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-micro uppercase tracking-wider text-fg-subtle" htmlFor={`${testId}-input`}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={`${testId}-input`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required || undefined}
        data-testid={testId}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={open ? draft : value}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          onChange(next);
          setOpen(true);
          setActive(0);
        }}
        onFocus={maybeOpen}
        onClick={maybeOpen}
        onPointerEnter={() => {
          if (getOpenMenu() && getOpenMenu() !== testId) {
            inputRef.current?.focus();
            maybeOpen();
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && (event.currentTarget.contains(next) || (next as HTMLElement).closest?.('[role="listbox"]'))) return;
          finish();
        }}
        onKeyDown={onKey}
        className="h-8 w-full px-2 rounded bg-canvas border border-border text-caption text-fg-strong disabled:opacity-40"
      />
      <AnchoredMenu
        open={open && rows.length > 0}
        onOpenChange={setOpen}
        reference={inputRef.current}
        testId={`${testId}-listbox`}
        listId={listId}
        label={label}
        placement="right-start"
      >
        {rows.map((row, index) => (
          <MenuOption
            key={`${row.value}-${row.create ? 'new' : 'opt'}-${index}`}
            active={index === active}
            testId={row.create ? `${testId}-option-create` : `${testId}-option-${row.value || 'none'}`}
            onEnter={() => setActive(index)}
            onPick={() => commit(row.value)}
          >
            {row.label}
          </MenuOption>
        ))}
      </AnchoredMenu>
    </div>
  );
}

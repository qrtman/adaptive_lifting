import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

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
  if (allowEmpty) rows.push({ value: '', label: emptyLabel });
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
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

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

  const activeId = open && rows[active] ? `${testId}-opt-${active}` : undefined;

  return (
    <div ref={rootRef} className="flex flex-col gap-1 min-w-0">
      <label className="text-micro uppercase tracking-wider text-fg-subtle" htmlFor={`${testId}-input`}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={`${testId}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
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
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={(event) => {
            if (rootRef.current?.contains(event.relatedTarget as Node)) return;
            finish();
          }}
          onKeyDown={onKey}
          className="h-8 w-full px-2 rounded bg-canvas border border-border text-caption text-fg-strong disabled:opacity-40"
        />
        {open ? (
          <ul
            id={listId}
            role="listbox"
            data-testid={`${testId}-listbox`}
            className="absolute z-20 mt-0.5 max-h-48 w-full overflow-auto bg-card border border-border rounded shadow-[var(--sticky-shadow)]"
          >
            {rows.length === 0 ? (
              <li className="px-2 py-1.5 text-caption text-fg-muted">No matches</li>
            ) : (
              rows.map((row, index) => (
                <li
                  key={`${row.value}-${row.create ? 'new' : 'opt'}-${index}`}
                  id={`${testId}-opt-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-testid={row.create ? `${testId}-option-create` : `${testId}-option-${row.value || 'none'}`}
                  className={`px-2 py-1.5 text-caption cursor-pointer ${
                    index === active ? 'bg-cell-selected text-fg-strong' : 'text-fg hover:bg-cell-hover'
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(row.value);
                  }}
                >
                  {row.label}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

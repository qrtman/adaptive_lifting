import { useEffect, useRef, useState } from 'react';
import { MOVEMENT_PATTERNS, type MovementPattern } from '../../services/exerciseCatalog';

export function MovementPatternSelect({
  value,
  onChange,
  locked = false,
  id,
  collapsed = false,
}: {
  value?: MovementPattern | string | null;
  onChange: (value: MovementPattern) => void;
  locked?: boolean;
  id?: string;
  collapsed?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = (MOVEMENT_PATTERNS as readonly string[]).includes(value || '')
    ? (value as MovementPattern)
    : 'Misc';

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        data-testid={id ? `movement-pattern-${id}` : 'movement-pattern'}
        data-value={selected}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Pattern ${selected}`}
        disabled={locked}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className="h-5 max-w-[9rem] px-1.5 text-micro bg-cell border border-border rounded text-fg-muted truncate disabled:opacity-40"
      >
        {selected}
      </button>
      {open && !collapsed ? (
        <ul
          role="listbox"
          aria-label="Movement pattern"
          className="absolute z-20 mt-0.5 min-w-[12rem] max-h-56 overflow-auto bg-card border border-border rounded shadow-[var(--sticky-shadow)]"
        >
          {MOVEMENT_PATTERNS.map((pattern) => (
            <li
              key={pattern}
              role="option"
              aria-selected={pattern === selected}
              className={`px-2 py-1.5 text-caption cursor-pointer ${
                pattern === selected ? 'bg-cell-selected text-fg-strong' : 'text-fg hover:bg-cell-hover'
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(pattern);
                setOpen(false);
              }}
            >
              {pattern}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

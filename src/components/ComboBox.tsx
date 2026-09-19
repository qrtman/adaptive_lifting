import { useMemo, useState, type KeyboardEvent } from 'react';

const inputClass =
  'h-10 w-full min-w-0 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] placeholder:text-[var(--cal-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

const labelClass = 'text-[10px] uppercase tracking-wider text-[var(--cal-muted)] leading-4';

export function ComboBox({
  label,
  value,
  onChange,
  options,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const listId = `${testId}-listbox`;

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    const exact = options.some((option) => option.toLowerCase() === query);
    if (!query || exact) return options;
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [options, value]);

  const listOpen = open && filtered.length > 0;

  const moveHighlight = (delta: number) => {
    if (filtered.length === 0) return;
    setHighlightIndex((current) => {
      const next = current + delta;
      if (next < 0) return filtered.length - 1;
      if (next >= filtered.length) return 0;
      return next;
    });
  };

  const pick = (option: string) => {
    onChange(option);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightIndex(0);
        return;
      }
      moveHighlight(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightIndex(Math.max(filtered.length - 1, 0));
        return;
      }
      moveHighlight(-1);
      return;
    }
    if (event.key === 'Enter' && open && filtered.length > 0) {
      event.preventDefault();
      pick(filtered[Math.min(highlightIndex, filtered.length - 1)]);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <label className="flex w-full min-w-0 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <div className={`relative min-w-0 ${listOpen ? 'z-30' : ''}`}>
        <input
          data-testid={testId}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setHighlightIndex(0);
          }}
          onFocus={() => {
            setOpen(true);
            const match = filtered.findIndex((option) => option.toLowerCase() === value.trim().toLowerCase());
            setHighlightIndex(match >= 0 ? match : 0);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={inputClass}
        />
        {listOpen ? (
          <div
            id={listId}
            role="listbox"
            data-testid={listId}
            className="absolute z-30 mt-1 w-full max-h-40 overflow-y-auto p-1 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-elevated)] shadow-[var(--cal-shadow-lift)]"
          >
            {filtered.map((option, index) => {
              const active = index === highlightIndex;
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-testid={`${testId}-option-${option}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    active
                      ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]'
                      : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </label>
  );
}

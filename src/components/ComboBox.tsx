import { useMemo, useState, type KeyboardEvent } from 'react';

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
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#636366]">{label}</span>
      <div className="relative">
        <input
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
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
          className="h-8 w-full px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
        />
        {open && filtered.length > 0 ? (
          <div
            id={listId}
            role="listbox"
            data-testid={listId}
            className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto border border-white/10 rounded bg-[#131313]"
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
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => pick(option)}
                  className={`w-full px-2 py-1.5 text-left text-xs ${
                    active ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
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

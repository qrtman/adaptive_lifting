import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { filterCatalog, type CatalogExercise } from '../services/exerciseCatalog';
import { catalogLiftPayload, type NewLiftPayload } from '../features/plan/liftCopy';

/**
 * "Type a lift name…" row under the lifts (session sheet phase 5). Catalog search as in Add
 * lift; Enter adds and keeps typing here, Tab adds and moves into the new lift's first cell.
 * The full Add lift dialog stays for tier / pattern / variation choices.
 */
export function InlineAddLift({
  disabledReason,
  onAdd,
  onFocusLift,
  trailing,
}: {
  /** Shown at the end of the row (the "Browse lifts…" catalog dialog). */
  trailing?: ReactNode;
  /** Set when adding is not possible right now (offline, no rights); shown in the field. */
  disabledReason?: string | null;
  /** Adds the lift; resolves to its id (null when it failed). */
  onAdd: (payload: NewLiftPayload) => Promise<string | null>;
  onFocusLift: (liftId: string) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = query.trim();
  const matches = useMemo(() => (trimmed ? filterCatalog('', trimmed).slice(0, 6) : []), [trimmed]);
  const exact = matches.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  const options: Array<CatalogExercise | { name: string; custom: true }> = trimmed
    ? [...matches, ...(exact ? [] : [{ name: trimmed, custom: true as const }])]
    : [];
  const disabled = Boolean(disabledReason) || busy;

  const add = async (index: number, focusLift: boolean) => {
    const choice = options[Math.min(index, options.length - 1)];
    if (!choice || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const id = await onAdd(catalogLiftPayload('custom' in choice ? { name: choice.name } : choice));
      setQuery('');
      setHighlight(0);
      if (id && focusLift) onFocusLift(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add lift');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((i) => Math.min(options.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) && options.length > 0) {
      event.preventDefault();
      void add(highlight, event.key === 'Tab');
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  };

  return (
    <div className="relative" data-testid="inline-add-lift">
      <div className="flex h-10 items-center gap-2 border-t border-[var(--cal-hairline)] px-3 focus-within:bg-[color-mix(in_srgb,var(--cal-accent)_4%,transparent)]">
        <Plus size={14} aria-hidden="true" className="shrink-0 text-[var(--cal-muted)]" />
        <input
          role="combobox"
          aria-label="Add a lift by name"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options.length > 0 ? `${listId}-${Math.min(highlight, options.length - 1)}` : undefined}
          data-testid="inline-add-lift-input"
          value={query}
          disabled={disabled}
          placeholder={disabledReason ?? 'Type a lift name…'}
          onChange={(event) => { setQuery(event.target.value); setHighlight(0); }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--cal-ink)] outline-none placeholder:text-[var(--cal-muted)] disabled:cursor-not-allowed"
        />
        {busy ? <span className="text-[12px] text-[var(--cal-muted)]">Adding…</span> : null}
        {trailing}
      </div>
      {options.length > 0 ? (
        <div id={listId} role="listbox" aria-label="Lifts" data-testid="inline-add-lift-options"
          className="absolute left-0 top-10 z-30 flex w-[min(24rem,100%)] flex-col rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-elevated)] p-1 shadow-[var(--cal-shadow-lift)]">
          {options.map((option, index) => (
            <button
              key={'custom' in option ? `custom-${option.name}` : option.name}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlight}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void add(index, false)}
              className={`flex h-8 items-center justify-between gap-3 rounded-[var(--cal-radius-md)] px-2.5 text-left text-[13px] ${index === highlight ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]' : 'text-[var(--cal-body)]'}`}
            >
              <span className="truncate">{'custom' in option ? `Add “${option.name}”` : option.name}</span>
              <span className="shrink-0 text-[11px] text-[var(--cal-muted)]">{'custom' in option ? 'custom' : option.movementPattern}</span>
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--cal-muted)]">Enter adds · Tab adds and jumps to its sets</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-[12px] text-[var(--cal-error)]">{error}</p> : null}
    </div>
  );
}

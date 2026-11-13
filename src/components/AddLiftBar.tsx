import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiService } from '../services/api';
import { MOVEMENT_PATTERNS, filterCatalog, type CatalogExercise, type MovementPattern } from '../services/exerciseCatalog';
import { compileVariation, defaultModifiers } from '../services/liftVariation';
import { Plus } from 'lucide-react';
import { CenteredDialog } from './CenteredDialog';
import { optionDomId } from './LiftCatalogChoice';
import { LiftVariationPicker } from './LiftVariationPicker';
import { MovementPatternSelect } from './PrescriptionEditor';

type LiftTier = 'Comp' | 'Variation' | 'Accessory';

const TIER_LABEL: Record<LiftTier, string> = { Comp: 'Main lift', Variation: 'Variation', Accessory: 'Accessory' };
const PATTERN_LABEL: Record<MovementPattern, string> = {
  'Knee Dominant': 'Squat',
  'Hip Dominant': 'Hinge',
  'Horizontal Push': 'H push',
  'Vertical Push': 'V push',
  'Horizontal Pull': 'H pull',
  'Vertical Pull': 'V pull',
  Misc: 'Arms & misc',
  Weightlifting: 'Olympic',
};

const FIELD = 'h-9 w-full px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

type Picked =
  | { kind: 'catalog'; exercise: CatalogExercise }
  | { kind: 'custom' };

/**
 * Add lift in two steps: 1) pick an exercise (search, pattern chips, one list, or a custom
 * name); 2) set tier and modifiers with a live name preview. The dialog keeps one height,
 * so lists and steps scroll inside instead of resizing it.
 */
export function AddLiftBar({
  sessionId,
  onAdded,
  variant = 'bar',
}: {
  sessionId: string;
  onAdded: () => Promise<void> | void;
  /** "empty": the button for the empty-session prompt. "link": a quiet "Browse lifts…" inside the type-a-name row. "bar": legacy, below the lift list. */
  variant?: 'bar' | 'empty' | 'link';
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [search, setSearch] = useState('');
  const [pattern, setPattern] = useState<MovementPattern | ''>('');
  const [highlight, setHighlight] = useState(0);
  const [customName, setCustomName] = useState('');
  const [customPattern, setCustomPattern] = useState<MovementPattern>('Misc');
  const [tier, setTier] = useState<LiftTier>('Comp');
  const [variation, setVariation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => filterCatalog('', search).filter((item) => !pattern || item.movementPattern === pattern),
    [search, pattern],
  );
  const trimmed = search.trim();
  const offerCustom = trimmed.length > 0 && !options.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  const rowCount = options.length + (offerCustom ? 1 : 0);

  useEffect(() => { setHighlight(0); }, [search, pattern]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight]);

  const reset = () => {
    setPicked(null);
    setSearch('');
    setPattern('');
    setHighlight(0);
    setCustomName('');
    setCustomPattern('Misc');
    setTier('Comp');
    setVariation('');
    setError(null);
  };

  const pickCatalog = (exercise: CatalogExercise) => {
    setPicked({ kind: 'catalog', exercise });
    setTier(exercise.tier);
    setVariation(exercise.tier === 'Comp' ? compileVariation(exercise.name, defaultModifiers(exercise.liftCategory)) : exercise.name);
    setError(null);
  };

  const pickCustom = (name: string) => {
    setPicked({ kind: 'custom' });
    setCustomName(name);
    setCustomPattern(pattern || 'Misc');
    setTier('Accessory');
    setVariation(name.trim());
    setError(null);
  };

  const chooseRow = (index: number) => {
    if (index < options.length) pickCatalog(options[index]);
    else if (offerCustom) pickCustom(trimmed);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => Math.min(rowCount - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (rowCount > 0) chooseRow(Math.min(highlight, rowCount - 1));
    }
  };

  const selected = useMemo(() => {
    if (!picked) return null;
    if (picked.kind === 'catalog') return picked.exercise;
    const name = customName.trim();
    return name ? { name, category: 'User Defined' as const, movementPattern: customPattern, liftCategory: 'Other' as const, tier } : null;
  }, [picked, customName, customPattern, tier]);

  const preview = selected ? (variation || compileVariation(selected.name, defaultModifiers(selected.liftCategory))) : '';

  const addLift = async () => {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.addSessionExercise(sessionId, {
        title: selected.name,
        variation: preview || selected.name,
        tier,
        liftCategory: selected.liftCategory,
        movementPattern: selected.movementPattern,
      });
      await onAdded();
      setOpen(false);
      reset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add lift');
    } finally {
      setBusy(false);
    }
  };

  const step1 = (
    <div className="flex h-full min-h-0 flex-col gap-2 p-0.5" data-testid="add-lift-step-pick">
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="add-lift-results"
        aria-activedescendant={rowCount > 0 ? optionDomId('add-lift', Math.min(highlight, rowCount - 1)) : undefined}
        aria-label="Search exercises"
        data-testid="add-lift-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder="Search exercises, or type a new name"
        className={FIELD}
      />
      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]" role="group" aria-label="Movement pattern">
        {(['', ...MOVEMENT_PATTERNS] as const).map((value) => (
          <button
            key={value || 'all'}
            type="button"
            aria-pressed={pattern === value}
            data-testid={`add-lift-pattern-${value || 'all'}`}
            onClick={() => setPattern(value)}
            className={`h-7 px-2.5 shrink-0 rounded-full border text-[11px] font-medium transition-colors ${pattern === value
              ? 'border-[var(--cal-accent)] bg-[color-mix(in_srgb,var(--cal-accent)_14%,transparent)] text-[var(--cal-ink)]'
              : 'border-[var(--cal-hairline)] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}
          >
            {value ? PATTERN_LABEL[value] : 'All'}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        id="add-lift-results"
        role="listbox"
        aria-label="Exercises"
        data-testid="add-lift-results"
        className="min-h-0 flex-1 overflow-y-auto rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)]"
      >
        {options.map((item, index) => (
          <div
            key={item.name}
            id={optionDomId('add-lift', index)}
            data-index={index}
            role="option"
            aria-selected={index === highlight}
            data-testid={`add-lift-result-${item.name}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlight(index)}
            onClick={() => pickCatalog(item)}
            className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 border-b border-[var(--cal-hairline-soft)] last:border-b-0 ${index === highlight ? 'bg-[var(--cal-surface-soft)]' : ''}`}
          >
            <span className="min-w-0 truncate text-sm text-[var(--cal-ink)]">{item.name}</span>
            <span className="shrink-0 text-[10px] text-[var(--cal-muted)]" aria-hidden="true">{TIER_LABEL[item.tier]} · {PATTERN_LABEL[item.movementPattern]}</span>
          </div>
        ))}
        {offerCustom ? (
          <div
            id={optionDomId('add-lift', options.length)}
            data-index={options.length}
            role="option"
            aria-selected={highlight === options.length}
            data-testid="add-lift-custom"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlight(options.length)}
            onClick={() => pickCustom(trimmed)}
            className={`cursor-pointer px-3 py-2 text-sm text-[var(--cal-accent)] ${highlight === options.length ? 'bg-[var(--cal-surface-soft)]' : ''}`}
          >
            + Add “{trimmed}” as a custom lift
          </div>
        ) : null}
        {rowCount === 0 ? (
          <p className="px-3 py-3 text-xs text-[var(--cal-muted)]" data-testid="add-lift-no-results">No matches. Type a name to add a custom lift.</p>
        ) : null}
      </div>
      {!trimmed ? (
        <button type="button" data-testid="add-lift-custom-start" onClick={() => pickCustom('')} className="self-start text-xs text-[var(--cal-accent)] hover:underline">
          + Custom lift
        </button>
      ) : null}
    </div>
  );

  const step2 = selected || picked?.kind === 'custom' ? (
    <div className="flex flex-col gap-4 p-0.5" data-testid="add-lift-step-configure">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" data-testid="add-lift-back" onClick={() => setPicked(null)} className="h-7 shrink-0 px-2 rounded-[var(--cal-radius-md)] text-xs text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]">‹ Back</button>
        <p className="min-w-0 truncate text-sm font-semibold text-[var(--cal-ink)]" data-testid="add-lift-preview">{preview || 'Custom lift'}</p>
      </div>
      {picked?.kind === 'custom' ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[var(--cal-ink)]">Name</span>
            <input
              data-testid="add-lift-custom-name"
              autoFocus
              value={customName}
              onChange={(event) => { setCustomName(event.target.value); setVariation(event.target.value.trim()); }}
              placeholder="e.g. Hamstring Curl"
              className={FIELD}
            />
          </label>
          <MovementPatternSelect id="add-lift" value={customPattern} onChange={setCustomPattern} />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Tier">
        <span className="text-[11px] font-semibold text-[var(--cal-ink)]">Tier</span>
        <div className="inline-flex self-start rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] p-0.5">
          {(['Comp', 'Variation', 'Accessory'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={tier === value}
              data-testid={`add-lift-tier-${value}`}
              onClick={() => setTier(value)}
              className={`h-7 px-3 rounded-[var(--cal-radius-sm)] text-[11px] font-medium ${tier === value ? 'bg-[var(--cal-surface-strong)] text-[var(--cal-ink)]' : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}
            >
              {TIER_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      {selected ? (
        <LiftVariationPicker
          title={selected.name}
          variation={preview}
          liftCategory={selected.liftCategory}
          showName={false}
          onChange={(next) => { setVariation(next.variation); setTier((current) => current === 'Accessory' ? 'Accessory' : next.tier); }}
        />
      ) : null}
      {error ? <p className="text-xs text-[var(--cal-error)]" data-testid="add-lift-error">{error}</p> : null}
    </div>
  ) : null;

  return (
    <div className={variant === 'bar' ? 'py-3 border-t border-[var(--cal-hairline)]' : 'contents'}>
      {variant === 'link' ? (
        <button
          type="button"
          data-testid="add-lift"
          onClick={() => { reset(); setOpen(true); }}
          title="Pick from the catalog with tier, pattern and modifiers"
          className="inline-flex h-7 shrink-0 items-center rounded-[var(--cal-radius-md)] px-2 text-[12px] text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
        >
          Browse lifts…
        </button>
      ) : (
        <button
          type="button"
          data-testid="add-lift"
          onClick={() => { reset(); setOpen(true); }}
          className="inline-flex h-9 items-center gap-1.5 px-4 text-sm font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)]"
        >
          <Plus size={15} aria-hidden="true" />
          Add lift
        </button>
      )}
      {open ? (
        <CenteredDialog
          title="Add lift"
          subtitle={picked ? 'Set the tier and any modifiers.' : 'Pick an exercise.'}
          onClose={() => setOpen(false)}
          testId="add-lift-dialog"
          fixedHeight
          footer={(
            <>
              <button type="button" data-testid="add-lift-cancel" onClick={() => setOpen(false)} className="h-8 px-3 text-xs text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)]">Cancel</button>
              {picked ? (
                <button type="button" data-testid="add-lift-confirm" disabled={busy || !selected} onClick={() => void addLift()} className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-40">{busy ? 'Adding…' : 'Add lift'}</button>
              ) : null}
            </>
          )}
        >
          {picked ? step2 : step1}
        </CenteredDialog>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { CATALOG_EXERCISES, MOVEMENT_PATTERNS, filterCatalog, type CatalogExercise, type MovementPattern } from '../services/exerciseCatalog';
import { MovementPatternSelect } from './PrescriptionEditor';

const FIELD = 'h-8 px-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-xs text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';
const LABEL = 'text-[10px] uppercase tracking-wider text-[var(--cal-muted)]';
type LiftTier = 'Comp' | 'Variation' | 'Accessory';

export function LiftCatalogChoice({
  testPrefix, category, tier, movementPattern, search, exerciseName, customName,
  onCategoryChange, onTierChange, onMovementPatternChange, onSearchChange, onExerciseChange, onCustomNameChange,
}: {
  testPrefix: string;
  category: 'User Defined' | '';
  tier: LiftTier;
  movementPattern: MovementPattern;
  search: string;
  exerciseName: string;
  customName: string;
  onCategoryChange: (value: 'User Defined' | '') => void;
  onTierChange: (value: LiftTier) => void;
  onMovementPatternChange: (value: MovementPattern) => void;
  onSearchChange: (value: string) => void;
  onExerciseChange: (item: CatalogExercise) => void;
  onCustomNameChange: (value: string) => void;
}) {
  const userDefined = category === 'User Defined';
  const [patternFilter, setPatternFilter] = useState('');
  const options = useMemo(() => filterCatalog('', search).filter((item) => !patternFilter || item.movementPattern === patternFilter), [search, patternFilter]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [resultsOpen, setResultsOpen] = useState(false);

  useEffect(() => {
    const selectedIndex = options.findIndex((item) => item.name === exerciseName);
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [options, exerciseName]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (userDefined) return;
    if (event.key === 'Escape' && resultsOpen) {
      event.preventDefault();
      event.stopPropagation();
      setResultsOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!resultsOpen) setResultsOpen(true);
      setHighlightIndex((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = options[highlightIndex] ?? options[0];
      if (item) {
        onExerciseChange(item);
        onSearchChange('');
        setResultsOpen(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Exercise source</span>
          <select data-testid={`${testPrefix}-category`} value={userDefined ? 'User Defined' : ''} onChange={(event) => onCategoryChange(event.target.value as 'User Defined' | '')} className={FIELD}>
            <option value="">Catalog exercise</option>
            <option value="User Defined">User Defined</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Tier</span>
          <select data-testid={`${testPrefix}-tier`} value={tier} onChange={(event) => onTierChange(event.target.value as LiftTier)} className={FIELD}>
            <option value="Comp">Main Lift</option>
            <option value="Variation">Variation</option>
            <option value="Accessory">Accessory</option>
          </select>
        </label>
      </div>
      {!userDefined ? (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Search Exercises</span>
            <input
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={resultsOpen}
              aria-controls={`${testPrefix}-results`}
              aria-activedescendant={resultsOpen && options[highlightIndex] ? `${testPrefix}-option-${options[highlightIndex].name}` : undefined}
              aria-label="Search exercises"
              data-testid={`${testPrefix}-search`}
              value={search}
              onChange={(event) => { onSearchChange(event.target.value); setResultsOpen(true); }}
              onFocus={() => setResultsOpen(true)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search by exercise name"
              className={FIELD}
            />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Exercise name</span>
          <input data-testid={`${testPrefix}-custom-name`} value={customName} onChange={(event) => onCustomNameChange(event.target.value)} placeholder="e.g. Hamstring Curl" className={FIELD} />
        </label>
      )}
      {!userDefined && exerciseName ? (
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] px-2 py-1.5" data-testid={`${testPrefix}-selected-exercise`}>
          <span className="min-w-0 truncate text-xs text-[var(--cal-ink)]">Selected: <strong>{exerciseName}</strong></span>
          <button type="button" onClick={() => setResultsOpen(true)} className="shrink-0 text-[11px] text-[var(--cal-accent)] hover:underline">Change</button>
        </div>
      ) : null}
      {!userDefined && resultsOpen ? (
        <div id={`${testPrefix}-results`} role="listbox" aria-label="Catalog exercises" data-testid={`${testPrefix}-results`} className="max-h-40 overflow-y-auto cal-nested-card cal-nested-flush outline-none" data-elevated="true">
          {options.map((item, index) => (
            <div
              key={`${item.category}-${item.name}`}
              id={`${testPrefix}-option-${item.name}`}
              role="option"
              aria-selected={item.name === exerciseName}
              data-testid={`${testPrefix}-result-${item.name}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightIndex(index)}
              onClick={() => { onExerciseChange(item); onSearchChange(''); setResultsOpen(false); }}
              className={`w-full cursor-pointer px-2 py-2 text-left ${index === highlightIndex ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]' : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}
            >
              <span className="block text-xs">{item.name}</span>
              <span className="block text-[10px] text-[var(--cal-muted-soft)]" aria-hidden="true">{item.movementPattern}</span>
            </div>
          ))}
          {options.length === 0 ? <p className="px-2 py-2 text-xs text-[var(--cal-muted)]" data-testid={`${testPrefix}-no-results`}>No catalog matches. Change the movement pattern or search.</p> : null}
        </div>
      ) : null}
      {userDefined ? <MovementPatternSelect id={testPrefix} value={movementPattern} onChange={onMovementPatternChange} /> : (
        <label className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted-soft)]">Filter pattern</span>
          <select data-testid={`movement-pattern-${testPrefix}`} value={patternFilter} onChange={(event) => { setPatternFilter(event.target.value); setResultsOpen(true); }} className="h-7 max-w-[11rem] px-1 text-[11px] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] rounded text-[var(--cal-muted)]">
            <option value="">All patterns</option>
            {MOVEMENT_PATTERNS.map((pattern) => <option key={pattern} value={pattern}>{pattern}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export function catalogExercise(name: string): CatalogExercise | null {
  return CATALOG_EXERCISES.find((item) => item.name === name) ?? null;
}

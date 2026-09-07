import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { ExerciseData } from '../types';
import {
  CANONICAL_EXERCISES,
  MovementOption,
  LIFT_CATEGORIES,
  TIERS,
  TEMPO_OPTIONS,
  ROM_OPTIONS,
  GEAR_OPTIONS,
  LiftCategory,
  Tier,
  BuilderMovement,
  defaultMovement,
  composeExerciseName,
  buildExercise,
} from '../services/exerciseLibrary';
import { apiService } from '../services/api';

interface WorkoutBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (exercise: ExerciseData) => void;
}

type TierTab = 'All' | Tier | 'Custom';
const TIER_TABS: TierTab[] = ['All', 'Comp', 'Variation', 'Accessory', 'Custom'];

// Custom movements created this page-session, so they reappear on reopen even
// when the backend library is unavailable (offline-first).
const sessionCustomCache: MovementOption[] = [];

function mergeCustoms(...lists: MovementOption[][]): MovementOption[] {
  const byName = new Map<string, MovementOption>();
  for (const list of lists) {
    for (const opt of list) {
      byName.set(opt.name.toLowerCase(), opt);
    }
  }
  return [...byName.values()];
}

const Chip: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}> = ({ active, onClick, children, testId }) => {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`h-7 px-2 rounded text-[11px] border transition-colors ${
        active
          ? 'bg-mac-blue/15 border-mac-blue/60 text-white'
          : 'bg-[#161616] border-white/10 text-[#AEAEB2] hover:text-white hover:border-white/20'
      }`}
    >
      {children}
    </button>
  );
};

export function WorkoutBuilder({ isOpen, onClose, onCommit }: WorkoutBuilderProps) {
  const [search, setSearch] = useState('');
  const [tierTab, setTierTab] = useState<TierTab>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCustomSelection, setIsCustomSelection] = useState(false);
  const [movement, setMovement] = useState<BuilderMovement>(defaultMovement());
  const [customs, setCustoms] = useState<MovementOption[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setTierTab('All');
    setSelectedId(null);
    setIsCustomSelection(false);
    setMovement(defaultMovement());
    setCustoms(mergeCustoms(sessionCustomCache));

    let cancelled = false;
    apiService.fetchCustomExercises().then(rows => {
      if (cancelled) return;
      const mapped: MovementOption[] = (rows || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        liftCategory: (r.liftCategory as LiftCategory) || 'Other',
        tier: (r.tier as Tier) || 'Variation',
        source: 'custom' as const,
        tempoId: r.tempoId || undefined,
        romId: r.romId || undefined,
        gear: r.gear || [],
      }));
      setCustoms(mergeCustoms(sessionCustomCache, mapped));
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const results = useMemo(() => {
    const all: MovementOption[] = [...CANONICAL_EXERCISES, ...customs];
    const q = search.trim().toLowerCase();
    return all.filter(ex => {
      const tierOk =
        tierTab === 'All' ||
        (tierTab === 'Custom' ? ex.source === 'custom' : ex.tier === tierTab);
      const searchOk = q === '' || ex.name.toLowerCase().includes(q) || ex.liftCategory.toLowerCase().includes(q);
      return tierOk && searchOk;
    });
  }, [search, tierTab, customs]);

  const selectMovement = (opt: MovementOption) => {
    setSelectedId(opt.id);
    setIsCustomSelection(opt.source === 'custom');
    setMovement(m => ({
      ...m,
      baseName: opt.name,
      liftCategory: opt.liftCategory,
      tier: opt.tier,
      tempoId: opt.tempoId ?? 'standard',
      romId: opt.romId ?? 'full',
      gear: opt.gear ?? [],
    }));
  };

  const createCustom = () => {
    setSelectedId('custom');
    setIsCustomSelection(true);
    setMovement(m => ({ ...defaultMovement(search.trim() || m.baseName || 'Custom Movement'), tier: m.tier, liftCategory: m.liftCategory }));
  };

  const compiledName = composeExerciseName(movement);
  const canCommit = movement.baseName.trim().length > 0 && (selectedId !== null);

  const persistCustomIfNeeded = () => {
    if (!isCustomSelection) return;
    const name = movement.baseName.trim();
    if (!name) return;
    const option: MovementOption = {
      id: `custom-${name.toLowerCase()}`,
      name,
      liftCategory: movement.liftCategory,
      tier: movement.tier,
      source: 'custom',
      tempoId: movement.tempoId,
      romId: movement.romId,
      gear: movement.gear,
    };
    // Cache for immediate reuse this session (works offline)…
    const idx = sessionCustomCache.findIndex(o => o.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) sessionCustomCache[idx] = option;
    else sessionCustomCache.push(option);
    // …and persist to the owner-scoped backend library (offline-safe no-op on failure).
    void apiService.createCustomExercise({
      name,
      liftCategory: movement.liftCategory,
      tier: movement.tier,
      tempoId: movement.tempoId,
      romId: movement.romId,
      gear: movement.gear,
    });
  };

  const commit = () => {
    if (!canCommit) return;
    persistCustomIfNeeded();
    onCommit(buildExercise(movement));
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, movement, selectedId]);

  if (!isOpen) return null;

  const toggleGear = (g: string) =>
    setMovement(m => ({ ...m, gear: m.gear.includes(g) ? m.gear.filter(x => x !== g) : [...m.gear, g] }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
      data-testid="workout-builder"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[1200px] min-w-0 sm:min-w-[800px] h-[85dvh] bg-ink-900 border border-white/10 rounded-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-white/10">
          <h2 className="text-sm text-white">Add Exercise</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="workout-builder-close"
            className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Two-pane body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
          {/* Left: search + database */}
          <div className="min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-white/10">
            <div className="p-3 flex flex-col gap-2 shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#636366]" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search movements…"
                  data-testid="workout-builder-search"
                  className="w-full h-8 bg-[#161616] border border-white/10 rounded pl-8 pr-2 text-xs text-white placeholder:text-[#636366] focus:outline-none focus:border-mac-blue"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {TIER_TABS.map(t => (
                  <Chip key={t} active={tierTab === t} onClick={() => setTierTab(t)} testId={`builder-tiertab-${t}`}>
                    {t}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-1">
              {results.length === 0 ? (
                <div className="text-[11px] text-[#636366] px-1 py-4" data-testid="builder-empty-results">
                  No matching movements. Create a custom one below.
                </div>
              ) : (
                results.map(ex => (
                  <button
                    key={ex.id}
                    type="button"
                    data-testid={`builder-result-${ex.id}`}
                    onClick={() => selectMovement(ex)}
                    className={`text-left rounded border px-2 py-1.5 flex items-center justify-between gap-2 ${
                      selectedId === ex.id
                        ? 'bg-mac-blue/10 border-mac-blue/50'
                        : 'bg-[#161616] border-white/10 hover:border-white/20'
                    }`}
                  >
                    <span className="text-xs text-white truncate flex items-center gap-1">
                      {ex.source === 'custom' && (
                        <span className="text-[9px] uppercase tracking-wider text-mac-blue border border-mac-blue/40 rounded px-1">
                          Custom
                        </span>
                      )}
                      {ex.name}
                    </span>
                    <span className="text-[10px] font-mono text-[#AEAEB2] shrink-0">
                      {ex.liftCategory} · {ex.tier}
                    </span>
                  </button>
                ))
              )}

              <button
                type="button"
                onClick={createCustom}
                data-testid="builder-create-custom"
                className={`mt-1 text-left rounded border border-dashed px-2 py-1.5 flex items-center gap-2 ${
                  selectedId === 'custom'
                    ? 'bg-mac-blue/10 border-mac-blue/60 text-white'
                    : 'border-white/15 text-[#AEAEB2] hover:text-white hover:border-white/30'
                }`}
              >
                <Plus size={13} />
                <span className="text-xs truncate">
                  Create custom{search.trim() ? ` “${search.trim()}”` : ' movement'}
                </span>
              </button>
            </div>
          </div>

          {/* Right: parameter configurator */}
          <div className="min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">Base Name</span>
              <input
                value={movement.baseName}
                onChange={e => {
                  const v = e.target.value;
                  setMovement(m => ({ ...m, baseName: v }));
                  if (selectedId === null) setSelectedId('custom');
                }}
                placeholder="e.g. Squat"
                data-testid="builder-basename"
                className="h-8 bg-[#161616] border border-white/10 rounded px-2 text-xs text-white placeholder:text-[#636366] focus:outline-none focus:border-mac-blue"
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">Category</span>
              <div className="flex flex-wrap gap-1">
                {LIFT_CATEGORIES.map(c => (
                  <Chip
                    key={c}
                    active={movement.liftCategory === c}
                    onClick={() => setMovement(m => ({ ...m, liftCategory: c as LiftCategory }))}
                    testId={`builder-cat-${c}`}
                  >
                    {c}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">Tier</span>
              <div className="flex flex-wrap gap-1">
                {TIERS.map(t => (
                  <Chip
                    key={t}
                    active={movement.tier === t}
                    onClick={() => setMovement(m => ({ ...m, tier: t as Tier }))}
                    testId={`builder-tier-${t}`}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">Tempo</span>
              <div className="flex flex-wrap gap-1">
                {TEMPO_OPTIONS.map(t => (
                  <Chip
                    key={t.id}
                    active={movement.tempoId === t.id}
                    onClick={() => setMovement(m => ({ ...m, tempoId: t.id }))}
                    testId={`builder-tempo-${t.id}`}
                  >
                    {t.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">ROM</span>
              <div className="flex flex-wrap gap-1">
                {ROM_OPTIONS.map(r => (
                  <Chip
                    key={r.id}
                    active={movement.romId === r.id}
                    onClick={() => setMovement(m => ({ ...m, romId: r.id }))}
                    testId={`builder-rom-${r.id}`}
                  >
                    {r.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">Gear</span>
              <div className="flex flex-wrap gap-1">
                {GEAR_OPTIONS.map(g => (
                  <Chip key={g} active={movement.gear.includes(g)} onClick={() => toggleGear(g)} testId={`builder-gear-${g}`}>
                    {g}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#636366]">Compiled</span>
              <div
                className="min-h-8 bg-ink-800 border border-mac-blue/40 rounded px-2 py-1.5 text-xs text-white font-mono"
                data-testid="builder-compiled-name"
              >
                {compiledName}
              </div>
            </div>
          </div>
        </div>

        {/* Footer: commit the chosen movement (sets are authored in the exercise card) */}
        <div className="shrink-0 border-t border-white/10 p-3 flex items-center justify-between gap-2 bg-ink-900">
          <span className="text-[10px] text-[#636366]">
            Choose the movement · set prescription is built in the exercise card · Esc cancel · Ctrl+Enter add
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded text-xs bg-[#161616] border border-white/10 text-[#AEAEB2] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!canCommit}
              data-testid="builder-commit"
              className="h-8 px-3 rounded text-xs bg-mac-blue text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add to session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

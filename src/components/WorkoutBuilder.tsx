import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { ExerciseData } from '../types';
import {
  CANONICAL_EXERCISES,
  CanonicalExercise,
  LIFT_CATEGORIES,
  TIERS,
  TEMPO_OPTIONS,
  ROM_OPTIONS,
  GEAR_OPTIONS,
  PRESCRIPTION_MODES,
  PrescriptionMode,
  LiftCategory,
  Tier,
  BuilderMovement,
  BuilderPrescription,
  defaultMovement,
  defaultPrescription,
  composeExerciseName,
  prescriptionPreview,
  buildExercise,
} from '../services/exerciseLibrary';

interface WorkoutBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (exercise: ExerciseData) => void;
}

type TierTab = 'All' | Tier;
const TIER_TABS: TierTab[] = ['All', 'Comp', 'Variation', 'Accessory'];

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
  const [movement, setMovement] = useState<BuilderMovement>(defaultMovement());
  const [prescription, setPrescription] = useState<BuilderPrescription>(defaultPrescription());

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTierTab('All');
      setSelectedId(null);
      setMovement(defaultMovement());
      setPrescription(defaultPrescription());
    }
  }, [isOpen]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CANONICAL_EXERCISES.filter(ex => {
      const tierOk = tierTab === 'All' || ex.tier === tierTab;
      const searchOk = q === '' || ex.name.toLowerCase().includes(q) || ex.liftCategory.toLowerCase().includes(q);
      return tierOk && searchOk;
    });
  }, [search, tierTab]);

  const selectCanonical = (ex: CanonicalExercise) => {
    setSelectedId(ex.id);
    setMovement(m => ({ ...m, baseName: ex.name, liftCategory: ex.liftCategory, tier: ex.tier }));
    setPrescription(p => ({ ...p, baselineE1RM: ex.baselineE1RM }));
  };

  const createCustom = () => {
    setSelectedId('custom');
    setMovement(m => ({ ...defaultMovement(search.trim() || m.baseName || 'Custom Movement'), tier: m.tier, liftCategory: m.liftCategory }));
  };

  const compiledName = composeExerciseName(movement);
  const canCommit = movement.baseName.trim().length > 0 && (selectedId !== null);

  const commit = () => {
    if (!canCommit) return;
    onCommit(buildExercise(movement, prescription));
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
  }, [isOpen, movement, prescription, selectedId]);

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
                    onClick={() => selectCanonical(ex)}
                    className={`text-left rounded border px-2 py-1.5 flex items-center justify-between gap-2 ${
                      selectedId === ex.id
                        ? 'bg-mac-blue/10 border-mac-blue/50'
                        : 'bg-[#161616] border-white/10 hover:border-white/20'
                    }`}
                  >
                    <span className="text-xs text-white truncate">{ex.name}</span>
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

        {/* Footer: structured prescription injector */}
        <div className="shrink-0 border-t border-white/10 p-3 flex flex-col gap-2 bg-ink-900">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366] mr-1">Prescription</span>
            {PRESCRIPTION_MODES.map(m => (
              <Chip
                key={m.id}
                active={prescription.mode === m.id}
                onClick={() => setPrescription(p => ({ ...p, mode: m.id as PrescriptionMode }))}
                testId={`builder-mode-${m.id}`}
              >
                {m.label}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {prescription.mode !== 'AMRAP' && prescription.mode !== 'TOP_SET_BACKDOWN' && (
              <NumberField
                label="Sets"
                testId="builder-sets"
                value={prescription.sets}
                step={1}
                min={1}
                onChange={v => setPrescription(p => ({ ...p, sets: v }))}
              />
            )}
            <NumberField
              label="Reps"
              testId="builder-reps"
              value={prescription.reps}
              step={1}
              min={1}
              onChange={v => setPrescription(p => ({ ...p, reps: v }))}
            />
            <NumberField
              label={prescription.mode === 'PERCENTAGE' ? 'Target %' : 'Target RPE'}
              testId="builder-intensity"
              value={prescription.intensityValue}
              step={prescription.mode === 'PERCENTAGE' ? 1 : 0.5}
              min={0}
              onChange={v => setPrescription(p => ({ ...p, intensityValue: v }))}
            />
            {prescription.mode === 'TOP_SET_BACKDOWN' && (
              <>
                <NumberField
                  label="Backdowns"
                  testId="builder-backdown-sets"
                  value={prescription.backdownSets}
                  step={1}
                  min={0}
                  onChange={v => setPrescription(p => ({ ...p, backdownSets: v }))}
                />
                <NumberField
                  label="Drop %"
                  testId="builder-backdown-drop"
                  value={prescription.backdownDropPct}
                  step={1}
                  min={0}
                  onChange={v => setPrescription(p => ({ ...p, backdownDropPct: v }))}
                />
              </>
            )}
            <NumberField
              label="Baseline e1RM"
              testId="builder-baseline"
              value={prescription.baselineE1RM}
              step={2.5}
              min={0}
              onChange={v => setPrescription(p => ({ ...p, baselineE1RM: v }))}
            />
          </div>

          <div
            className="text-[11px] font-mono text-[#AEAEB2] bg-ink-800 border border-white/10 rounded px-2 py-1.5"
            data-testid="builder-preview"
          >
            {prescriptionPreview(prescription)}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#636366]">Esc to cancel · Ctrl+Enter to add</span>
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
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  testId?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#636366]">{label}</span>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, Number((value - step).toFixed(2))))}
          className="h-8 w-6 rounded-l bg-[#161616] border border-white/10 text-[#AEAEB2] hover:text-white"
        >
          −
        </button>
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          data-testid={testId}
          onChange={e => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
          className="h-8 w-14 bg-[#0C0F0F] border-y border-white/10 text-center text-xs text-white focus:outline-none focus:border-mac-blue"
        />
        <button
          type="button"
          onClick={() => onChange(Number((value + step).toFixed(2)))}
          className="h-8 w-6 rounded-r bg-[#161616] border border-white/10 text-[#AEAEB2] hover:text-white"
        >
          +
        </button>
      </div>
    </label>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import {
  BAR_OPTIONS,
  DEFAULT_TEMPO,
  GEAR_OPTIONS,
  LiftCategory,
  ROM_OPTIONS,
  compileVariation,
  defaultModifiers,
  formatTempo,
  parseModifiers,
  parseTempoParts,
  toggleGear,
  variationTier,
  type GearMod,
  type LiftModifiers,
  type RomMod,
} from '../services/liftVariation';

/** Tempo is eccentric-pause-concentric seconds. */
export const TEMPO_PRESETS: { label: string; tempo: string }[] = [
  { label: 'Normal', tempo: DEFAULT_TEMPO },
  { label: 'Paused', tempo: '1-2-1' },
  { label: 'Slow down', tempo: '3-0-1' },
  { label: 'Slow + pause', tempo: '3-2-1' },
];

const ROM_LABEL: Record<RomMod, string> = { Full: 'Full', Deficit: 'Deficit', Pin: 'Pin', Board: 'Board', Partial: 'Partial' };

function Toggle({
  label,
  pressed,
  disabled,
  testId,
  onClick,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
  key?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={`h-7 px-2.5 shrink-0 rounded-full border text-[11px] font-medium transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${pressed
        ? 'border-[var(--cal-accent)] bg-[color-mix(in_srgb,var(--cal-accent)_14%,transparent)] text-[var(--cal-ink)]'
        : 'border-[var(--cal-hairline)] text-[var(--cal-muted)] hover:border-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}
    >
      {label}
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0" role="group" aria-label={label}>
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-[var(--cal-ink)]">{label}</span>
        {hint ? <span className="text-[10px] text-[var(--cal-muted)]">{hint}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const TEMPO_RE = /^\s*(\d)\s*-\s*(\d)\s*-\s*(\d)\s*$/;

/** One field for eccentric-pause-concentric, plus presets. Invalid text reverts on blur. */
function TempoField({ tempo, disabled, onChange }: { tempo: string; disabled?: boolean; onChange: (next: string) => void }) {
  const normalized = formatTempo(...parseTempoParts(tempo));
  const [draft, setDraft] = useState(normalized);
  useEffect(() => setDraft(normalized), [normalized]);
  const commit = () => {
    const match = TEMPO_RE.exec(draft);
    if (!match) { setDraft(normalized); return; }
    const next = formatTempo(Number(match[1]), Number(match[2]), Number(match[3]));
    setDraft(next);
    if (next !== normalized) onChange(next);
  };
  return (
    <>
      <input
        aria-label="Tempo (eccentric-pause-concentric seconds)"
        data-testid="lift-tempo"
        inputMode="numeric"
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
        className="h-7 w-16 px-2 text-center text-xs tnum text-[var(--cal-ink)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] rounded-full disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
      />
      {TEMPO_PRESETS.map((preset) => (
        <Toggle
          key={preset.tempo}
          label={preset.label}
          pressed={normalized === preset.tempo}
          disabled={disabled}
          testId={`lift-tempo-${preset.tempo}`}
          onClick={() => onChange(preset.tempo)}
        />
      ))}
    </>
  );
}

export function LiftVariationPicker({
  title,
  variation,
  liftCategory = 'Other',
  locked = false,
  showName = true,
  onChange,
}: {
  title: string;
  variation: string;
  liftCategory?: LiftCategory;
  locked?: boolean;
  /** The add dialog shows the compiled name in its own header. */
  showName?: boolean;
  onChange: (next: { variation: string; tier: 'Comp' | 'Variation' }) => void;
}) {
  const mods = variation.trim() === title.trim()
    ? { ...defaultModifiers(liftCategory), bar: '' }
    : parseModifiers(variation, liftCategory);
  const bars = (BAR_OPTIONS[liftCategory] ?? BAR_OPTIONS.Other).filter((bar) => bar !== 'Standard');
  const gearOpts = GEAR_OPTIONS[liftCategory] ?? GEAR_OPTIONS.Other;

  const commit = (next: LiftModifiers) => {
    onChange({ variation: compileVariation(title, next), tier: variationTier(next) });
  };

  return (
    <div className="flex flex-col gap-3 min-w-0" data-testid="lift-constructor">
      {showName ? (
        <p className="text-xs font-medium text-[var(--cal-ink)] truncate" data-testid={`lift-name-${title}`}>
          {compileVariation(title, mods)}
        </p>
      ) : null}
      {bars.length > 0 ? (
        <Row label="Bar / style" hint="tap again to clear">
          {bars.map((bar) => (
            <Toggle
              key={bar}
              label={bar}
              pressed={mods.bar === bar}
              disabled={locked}
              testId={`lift-bar-${bar}`}
              onClick={() => commit({ ...mods, bar: mods.bar === bar ? '' : bar })}
            />
          ))}
        </Row>
      ) : null}
      <Row label="Tempo" hint="down-pause-up, seconds">
        <TempoField tempo={mods.tempo} disabled={locked} onChange={(tempo) => commit({ ...mods, tempo })} />
      </Row>
      <Row label="Range of motion">
        {ROM_OPTIONS.map((rom) => (
          <Toggle
            key={rom}
            label={ROM_LABEL[rom]}
            pressed={mods.rom === rom}
            disabled={locked}
            testId={`lift-rom-${rom}`}
            onClick={() => commit({ ...mods, rom })}
          />
        ))}
      </Row>
      <Row label="Equipment" hint="any">
        {gearOpts.map((item) => (
          <Toggle
            key={item}
            label={item}
            pressed={mods.gear.includes(item)}
            disabled={locked}
            testId={`lift-gear-${item}`}
            onClick={() => commit({ ...mods, gear: toggleGear(mods.gear, item as GearMod) })}
          />
        ))}
      </Row>
    </div>
  );
}

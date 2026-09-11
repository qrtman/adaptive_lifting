import type { ReactNode } from 'react';
import {
  BAR_OPTIONS,
  GEAR_OPTIONS,
  LiftCategory,
  ROM_OPTIONS,
  compileVariation,
  formatTempo,
  parseModifiers,
  parseTempoParts,
  toggleGear,
  variationTier,
  type GearMod,
  type LiftModifiers,
  type RomMod,
} from '../services/liftVariation';

function Chip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-6 px-1.5 text-[11px] rounded disabled:opacity-40 ${
        active ? 'text-white bg-white/15' : 'text-[#AEAEB2] hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#636366] w-10 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function TempoPart({
  value,
  disabled,
  label,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  label: string;
  onChange: (next: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      max={9}
      step={1}
      inputMode="numeric"
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-6 w-8 px-1 text-center text-xs font-mono bg-black border border-white/10 rounded text-white disabled:opacity-40"
    />
  );
}

export function LiftVariationPicker({
  title,
  variation,
  liftCategory = 'Other',
  locked = false,
  onChange,
}: {
  title: string;
  variation: string;
  liftCategory?: LiftCategory;
  locked?: boolean;
  onChange: (next: { variation: string; tier: 'Comp' | 'Variation' }) => void;
}) {
  const mods = parseModifiers(variation, liftCategory);
  const bars = BAR_OPTIONS[liftCategory] ?? BAR_OPTIONS.Other;
  const gearOpts = GEAR_OPTIONS[liftCategory] ?? GEAR_OPTIONS.Other;
  const [eccentric, pause, concentric] = parseTempoParts(mods.tempo);

  const commit = (next: LiftModifiers) => {
    onChange({
      variation: compileVariation(title, next),
      tier: variationTier(next),
    });
  };

  const setTempoPart = (index: 0 | 1 | 2, value: number) => {
    const parts: [number, number, number] = [eccentric, pause, concentric];
    parts[index] = value;
    commit({ ...mods, tempo: formatTempo(...parts) });
  };

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <p className="text-xs text-[#AEAEB2] truncate" data-testid={`lift-name-${title}`}>
        {compileVariation(title, mods)}
      </p>
      <Row label="Bar">
        {bars.map((bar) => (
          <Chip
            key={bar}
            label={bar}
            active={mods.bar === bar}
            disabled={locked}
            onClick={() => commit({ ...mods, bar })}
          />
        ))}
      </Row>
      <Row label="Tempo">
        <TempoPart label="Eccentric" value={eccentric} disabled={locked} onChange={(value) => setTempoPart(0, value)} />
        <span className="text-[10px] text-[#636366]">-</span>
        <TempoPart label="Pause" value={pause} disabled={locked} onChange={(value) => setTempoPart(1, value)} />
        <span className="text-[10px] text-[#636366]">-</span>
        <TempoPart label="Concentric" value={concentric} disabled={locked} onChange={(value) => setTempoPart(2, value)} />
      </Row>
      <Row label="ROM">
        {ROM_OPTIONS.map((rom) => (
          <Chip
            key={rom}
            label={rom}
            active={mods.rom === rom}
            disabled={locked}
            onClick={() => commit({ ...mods, rom: rom as RomMod })}
          />
        ))}
      </Row>
      <Row label="Gear">
        {gearOpts.map((item) => (
          <Chip
            key={item}
            label={item}
            active={mods.gear.includes(item)}
            disabled={locked}
            onClick={() => commit({ ...mods, gear: toggleGear(mods.gear, item as GearMod) })}
          />
        ))}
      </Row>
    </div>
  );
}

import type { ReactNode } from 'react';
import {
  BAR_OPTIONS,
  GEAR_OPTIONS,
  LiftCategory,
  ROM_OPTIONS,
  TEMPO_OPTIONS,
  compileVariation,
  parseModifiers,
  toggleGear,
  variationTier,
  type GearMod,
  type LiftModifiers,
  type RomMod,
  type TempoMod,
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

const TEMPO_LABEL: Record<TempoMod, string> = {
  Standard: 'Std',
  Paused: 'Pause',
  'Slow ecc': 'Slow',
  Iso: 'Iso',
};

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

  const commit = (next: LiftModifiers) => {
    onChange({
      variation: compileVariation(title, next),
      tier: variationTier(next),
    });
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
        {TEMPO_OPTIONS.map((tempo) => (
          <Chip
            key={tempo}
            label={TEMPO_LABEL[tempo]}
            active={mods.tempo === tempo}
            disabled={locked}
            onClick={() => commit({ ...mods, tempo: tempo as TempoMod })}
          />
        ))}
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

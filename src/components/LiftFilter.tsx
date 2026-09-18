import { useState, type ReactNode } from 'react';
import { MOVEMENT_PATTERNS } from '../services/exerciseCatalog';
import {
  LIFT_FILTER_LIFTS,
  LIFT_FILTER_TIERS,
  summarizeLiftFilter,
  type LiftFilterLift,
  type LiftFilterPattern,
  type LiftFilterState,
  type LiftFilterTier,
} from '../services/liftFilter';
import { CenteredDialog } from './CenteredDialog';

export type { LiftFilterState };

function Chip({
  facet,
  value,
  active,
  onClick,
}: {
  facet: 'lift' | 'pattern' | 'tier';
  value: string;
  active: boolean;
  onClick: () => void;
  key?: string;
}) {
  return (
    <button
      type="button"
      data-testid={`lift-filter-${facet}-${value}`}
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 px-2 text-[11px] rounded-[var(--cal-radius-md)] ${
        active
          ? 'text-[var(--cal-on-primary)] bg-[var(--cal-primary)]'
          : 'text-[var(--cal-muted)] bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]'
      }`}
    >
      {value}
    </button>
  );
}

function FacetRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted)]">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export function LiftFilter({
  value,
  onChange,
}: {
  value: LiftFilterState;
  onChange: (next: LiftFilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeLiftFilter(value);

  return (
    <>
      <button
        type="button"
        data-testid="lift-filter-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="h-7 max-w-[220px] px-2.5 text-xs font-medium truncate rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] text-[var(--cal-ink)] hover:bg-[var(--cal-surface-card)]"
        title={summary}
      >
        {summary}
      </button>
      {open ? (
        <CenteredDialog
          title="Filter lifts"
          subtitle="Category, pattern, and tier. Applied as you click."
          onClose={() => setOpen(false)}
          testId="lift-filter-dialog"
          footer={(
            <button
              type="button"
              data-testid="lift-filter-done"
              onClick={() => setOpen(false)}
              className="h-10 px-4 text-sm font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)]"
            >
              Done
            </button>
          )}
        >
          <div className="flex flex-col gap-3">
            <FacetRow label="Lift">
              {LIFT_FILTER_LIFTS.map((lift) => (
                <Chip
                  key={lift}
                  facet="lift"
                  value={lift}
                  active={value.lift === lift}
                  onClick={() => onChange({ ...value, lift: lift as LiftFilterLift })}
                />
              ))}
            </FacetRow>
            <FacetRow label="Pattern">
              <Chip
                facet="pattern"
                value="All"
                active={value.pattern === 'All'}
                onClick={() => onChange({ ...value, pattern: 'All' })}
              />
              {MOVEMENT_PATTERNS.map((pattern) => (
                <Chip
                  key={pattern}
                  facet="pattern"
                  value={pattern}
                  active={value.pattern === pattern}
                  onClick={() => onChange({ ...value, pattern: pattern as LiftFilterPattern })}
                />
              ))}
            </FacetRow>
            <FacetRow label="Tier">
              {LIFT_FILTER_TIERS.map((tier) => (
                <Chip
                  key={tier}
                  facet="tier"
                  value={tier}
                  active={value.tier === tier}
                  onClick={() => onChange({ ...value, tier: tier as LiftFilterTier })}
                />
              ))}
            </FacetRow>
          </div>
        </CenteredDialog>
      ) : null}
    </>
  );
}

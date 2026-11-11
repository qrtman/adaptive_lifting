import { useState, type ReactNode } from 'react';
import { MOVEMENT_PATTERNS } from '../services/exerciseCatalog';
import {
  LIFT_FILTER_LIFTS,
  LIFT_FILTER_TIERS,
  facetHasValue,
  isEmptyLiftFilter,
  summarizeLiftFilter,
  toggleLiftFilterChip,
  type LiftFilterFacet,
  type LiftFilterState,
} from '../services/liftFilter';
import { X } from 'lucide-react';
import { CenteredDialog } from './CenteredDialog';

export type { LiftFilterState };

/** Display text only: "Knee Dominant" → "Knee dominant". Stored values and test ids keep the original. */
export function sentenceCase(value: string): string {
  const [first, ...rest] = value.split(' ');
  return [first, ...rest.map((word) => word.toLowerCase())].join(' ');
}

function Chip({
  facet,
  value,
  active,
  onClick,
}: {
  facet: LiftFilterFacet;
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
      className={`h-8 px-3 shrink-0 rounded-full border text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${active
        ? 'border-[var(--cal-accent)] bg-[color-mix(in_srgb,var(--cal-accent)_14%,transparent)] font-medium text-[var(--cal-ink)]'
        : 'border-[var(--cal-hairline)] text-[var(--cal-muted)] hover:border-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}
    >
      {value === 'All' ? 'Any' : sentenceCase(value)}
    </button>
  );
}

function FacetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-3" role="group" aria-label={label}>
      <span className="pt-1.5 text-sm font-medium text-[var(--cal-ink)]">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function LiftFilter({
  value,
  onChange,
  emptyLabel,
}: {
  value: LiftFilterState;
  onChange: (next: LiftFilterState) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const empty = isEmptyLiftFilter(value);
  const summary = emptyLabel && empty
    ? emptyLabel
    : summarizeLiftFilter({ ...value, patterns: value.patterns.map(sentenceCase) as LiftFilterState['patterns'] });

  const toggle = (facet: LiftFilterFacet, chip: string) => {
    onChange(toggleLiftFilterChip(value, facet, chip));
  };
  const clearAll = () => onChange({ ...value, lifts: [], patterns: [], tiers: [] });

  return (
    <>
      <span className="inline-flex max-w-[260px] items-center">
        <button
          type="button"
          data-testid="lift-filter-open"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={`h-7 min-w-0 truncate border px-2.5 text-xs font-medium ${empty
            ? 'rounded-[var(--cal-radius-md)] border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)] text-[var(--cal-ink)] hover:bg-[var(--cal-surface-card)]'
            : 'rounded-l-[var(--cal-radius-md)] border-r-0 border-[var(--cal-accent)] bg-[color-mix(in_srgb,var(--cal-accent)_14%,transparent)] text-[var(--cal-ink)]'}`}
          title={summary}
        >
          {summary}
        </button>
        {!empty ? (
          <button
            type="button"
            data-testid="lift-filter-clear"
            aria-label="Clear lift filter"
            onClick={clearAll}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-r-[var(--cal-radius-md)] border border-l-0 border-[var(--cal-accent)] bg-[color-mix(in_srgb,var(--cal-accent)_14%,transparent)] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </span>
      {open ? (
        <CenteredDialog
          title="Filter lifts"
          subtitle="Changes apply right away."
          onClose={() => setOpen(false)}
          testId="lift-filter-dialog"
          footer={(
            <>
              <button
                type="button"
                data-testid="lift-filter-clear-all"
                disabled={empty}
                onClick={clearAll}
                className="mr-auto h-9 px-3 text-sm text-[var(--cal-muted)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Clear all
              </button>
              <button
                type="button"
                data-testid="lift-filter-done"
                onClick={() => setOpen(false)}
                className="h-9 px-4 text-sm font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)]"
              >
                Done
              </button>
            </>
          )}
        >
          <div className="flex flex-col gap-4">
            <FacetRow label="Lift">
              {LIFT_FILTER_LIFTS.map((lift) => (
                <Chip
                  key={lift}
                  facet="lift"
                  value={lift}
                  active={facetHasValue(value, 'lift', lift)}
                  onClick={() => toggle('lift', lift)}
                />
              ))}
            </FacetRow>
            <FacetRow label="Pattern">
              <Chip
                facet="pattern"
                value="All"
                active={facetHasValue(value, 'pattern', 'All')}
                onClick={() => toggle('pattern', 'All')}
              />
              {MOVEMENT_PATTERNS.map((pattern) => (
                <Chip
                  key={pattern}
                  facet="pattern"
                  value={pattern}
                  active={facetHasValue(value, 'pattern', pattern)}
                  onClick={() => toggle('pattern', pattern)}
                />
              ))}
            </FacetRow>
            <FacetRow label="Tier">
              {LIFT_FILTER_TIERS.map((tier) => (
                <Chip
                  key={tier}
                  facet="tier"
                  value={tier}
                  active={facetHasValue(value, 'tier', tier)}
                  onClick={() => toggle('tier', tier)}
                />
              ))}
            </FacetRow>
          </div>
        </CenteredDialog>
      ) : null}
    </>
  );
}

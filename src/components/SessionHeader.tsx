import { Check, ChevronLeft, Pencil } from 'lucide-react';
import { formatPlanLabel, formatSessionDate, isPlaceholderTitle, sessionHeadline } from '../features/plan/sessionLabels';

type HeaderSession = {
  title: string;
  date: string;
  dayLabel?: string | null;
  weekLabel?: string | null;
  blockLabel?: string | null;
};

/**
 * Session page header (session sheet phase 1). The Day slot is the large line and the
 * optional Name sits beside it as a small subtitle. Date · Week · Block · set count and
 * Edit share one meta line; the day note follows when there is one. No session tonnage:
 * it mixes different lifts. Without a Day, the Name (or Week) leads as before.
 */
export function SessionHeader({
  session,
  backLabel,
  onBack,
  onEdit,
  canEdit,
  editDisabledReason,
  finished,
  locked,
  onComplete,
  setCount,
  dayNote,
}: {
  session: HeaderSession;
  setCount: number;
  dayNote?: string | null;
  backLabel: string;
  onBack: () => void;
  onEdit: () => void;
  canEdit: boolean;
  editDisabledReason?: string;
  finished: boolean;
  locked: boolean;
  onComplete: () => void;
}) {
  const day = formatPlanLabel('Day', session.dayLabel);
  const week = formatPlanLabel('Week', session.weekLabel);
  const block = formatPlanLabel('Block', session.blockLabel);
  const named = !isPlaceholderTitle(session.title);
  // Day leads when there is one; otherwise the name, else "Week n" (sessionHeadline).
  const headline = day ?? sessionHeadline(session);
  const subtitle = day && named ? session.title.trim() : null;
  const headlineIsWeek = !day && !named && Boolean(week);
  const labels = headlineIsWeek
    ? block
    : [week, block].filter(Boolean).join(' · ') || 'No block/week';
  const note = dayNote?.trim();

  return (
    <header
      id="training-focus"
      className="sticky top-0 z-20 -mx-3 mb-3 border-b border-[var(--cal-hairline)] bg-[var(--cal-canvas)] px-3 pb-3 pt-2 sm:-mx-4 sm:px-4"
    >
      <button
        type="button"
        aria-label="Back"
        data-testid="session-back"
        onClick={onBack}
        className="-ml-2 inline-flex h-9 items-center gap-1 rounded-[var(--cal-radius-md)] px-2 text-sm text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cal-accent)]"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        {backLabel}
      </button>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h1 className="flex min-w-0 flex-1 basis-64 flex-wrap items-baseline gap-x-2.5 break-words">
          <span data-testid="session-name" className="text-2xl font-semibold tracking-tight text-[var(--cal-ink)]">{headline}</span>
          {subtitle ? (
            <span data-testid="session-title-sub" className="text-[15px] font-medium text-[var(--cal-muted)]">{subtitle}</span>
          ) : null}
        </h1>
        {finished ? (
          <span
            data-testid="session-finished-badge"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--cal-success)_14%,transparent)] px-3 text-sm font-medium text-[var(--cal-ink)]"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--cal-success)]" />
            Finished
          </span>
        ) : (
          <button
            type="button"
            data-testid="session-complete"
            disabled={locked}
            onClick={onComplete}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--cal-radius-md)] bg-[var(--cal-primary)] px-4 text-sm font-medium text-[var(--cal-on-primary)] hover:bg-[var(--cal-primary-active)] disabled:opacity-40"
          >
            <Check size={15} aria-hidden="true" />
            Complete session
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--cal-body)]">
        <span data-testid="session-date">{formatSessionDate(session.date)}</span>
        {labels ? (
          <>
            <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">·</span>
            <span data-testid="session-labels">{labels}</span>
          </>
        ) : null}
        <span aria-hidden="true" className="text-[var(--cal-muted-soft)]">·</span>
        <span data-testid="session-set-count" className="tnum">{setCount} {setCount === 1 ? 'set' : 'sets'}</span>
        <button
          type="button"
          data-testid="session-edit"
          onClick={onEdit}
          disabled={!canEdit}
          title={!canEdit ? editDisabledReason : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--cal-radius-md)] px-2.5 text-[13px] text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cal-accent)]"
        >
          <Pencil size={13} aria-hidden="true" />
          Edit
        </button>
      </div>
      {note ? (
        <p data-testid="session-day-note" className="mt-1 text-[13px] text-[var(--cal-body)]">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--cal-muted)]">Day note</span>{' '}
          {note}
        </p>
      ) : null}
    </header>
  );
}

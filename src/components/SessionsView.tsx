import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { WorkoutData } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useSync } from '../contexts/SyncContext';
import { getRecentBlock, getUiPref, UI_KEYS } from '../storage/uiPrefs';
import { LiftFilter } from './LiftFilter';
import {
  exercisePassesFilter,
  isEmptyLiftFilter,
  workoutPassesFilter,
  type LiftFilterState,
} from '../services/liftFilter';
import { NewSessionDialog } from './NewSessionDialog';
import { EditSessionDialog } from './EditSessionDialog';
import {
  buildBlockClipboard,
  buildDayClipboard,
  buildWeekClipboard,
  groupLabeledSessions,
  type CopyClipboard,
} from '../features/plan/copyClipboard';
import { formatPlanLabel, isDayLikeTitle } from '../features/plan/sessionLabels';
import { formatSessionStatusMeta, formatSetReadout, getLoggedLiftSummary } from '../features/plan/sessionSetReadout';
import { sortByFirstSession, weekBoardRows } from '../features/plan/weekBoard';
import { buildPreviousWeekLiftSummaries, formatSigned, metricChange, type LoggedLiftSummary } from '../features/plan/sessionComparison';

interface SessionsViewProps {
  onViewSession: (workout: WorkoutData, microId: string) => void;
  onDeleteSession: (workout: WorkoutData) => void | Promise<void>;
  filter: LiftFilterState;
  onFilterChange: (value: LiftFilterState) => void;
  onStartCopy: (clip: CopyClipboard) => void;
}

type SessionEntry = { workout: WorkoutData; microId: string };
type WeekGroup = { weekLabel: string; items: SessionEntry[] };
type BlockChoice = {
  key: string;
  label: string;
  blockLabel: string | null;
  weeks: WeekGroup[];
  noWeek: SessionEntry[];
  all: SessionEntry[];
  latestDate: string;
};
type DisplayMode = 'plan' | 'log' | 'both';
type Metric = 'e1rm' | 'tonnage' | 'avgInt';
type CompareVisibility = Record<Metric, boolean>;
const allComparisons: CompareVisibility = { e1rm: true, tonnage: true, avgInt: true };
const sessionDate = (entry: SessionEntry) => entry.workout.date;

function Delta({ current, previous, digits, unit, relative }: {
  current: number | null;
  previous: number | null;
  digits: number;
  unit: string;
  relative?: boolean;
}) {
  const change = metricChange(current, previous, digits);
  if (!change) return null;
  const color = change.amount > 0 ? 'text-[var(--cal-success)]' : change.amount < 0 ? 'text-[var(--cal-error)]' : 'text-[var(--cal-muted)]';
  return <span className={color}>{formatSigned(change.amount, digits)}{unit}{relative ? ` (${formatSigned(change.relativePct, 1)}%)` : ''}</span>;
}

const weekCardClass =
  'p-[var(--cal-space-xs)] flex flex-col gap-[var(--cal-space-xs)] min-w-0';

const blockCardClass =
  'flex flex-col gap-[var(--cal-space-sm)]';

const copyBtnClass =
  'h-8 px-2 rounded-[var(--cal-radius-md)] text-left text-[11px] text-[var(--cal-ink)] hover:bg-[var(--cal-surface-strong)] disabled:opacity-40';

const actionMenuClass =
  'absolute right-0 top-full z-20 min-w-32 rounded border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-1 flex flex-col items-stretch gap-1 shadow-sm';

function SessionCard({
  workout,
  active,
  canCopy,
  selected,
  filter,
  mode,
  comparison,
  compareVisibility,
  onOpen,
  onDelete,
  onToggleSelected,
  onCopyTo,
  onEdit,
}: {
  workout: WorkoutData;
  active: boolean;
  canCopy: boolean;
  selected: boolean;
  filter: LiftFilterState;
  mode: DisplayMode;
  comparison: ReadonlyMap<string, LoggedLiftSummary>;
  compareVisibility: CompareVisibility;
  onOpen: () => void;
  onDelete: () => void;
  onToggleSelected: (checked: boolean) => void;
  onCopyTo: () => void;
  onEdit: () => void;
  key?: string;
}) {
  const dayLabel = formatPlanLabel('Day', workout.dayLabel);
  const title = workout.title?.trim() || '';
  const headline = dayLabel ? dayLabel : title || 'Session';
  const secondaryTitle = dayLabel && title && !isDayLikeTitle(title) && title.toLowerCase() !== dayLabel.toLowerCase() ? title : null;
  const statusMeta = formatSessionStatusMeta(workout.status, workout.tonnage);
  const visibleExercises = isEmptyLiftFilter(filter)
    ? workout.exercises
    : workout.exercises.filter((ex) => exercisePassesFilter(ex, filter));
  const showPlan = mode !== 'log';
  const showLog = mode !== 'plan';
  return (
    <div
      data-testid={`sessions-card-${workout.id}`}
      data-elevated={active ? 'true' : undefined}
      className={`cal-nested-card relative flex flex-col gap-[var(--cal-space-xs)] ${
        active ? 'ring-1 ring-[color-mix(in_srgb,var(--cal-accent)_45%,transparent)]' : ''
      }`}
    >
      <button
        type="button"
        data-testid={`sessions-open-${workout.id}`}
        onClick={onOpen}
        className="text-left flex flex-col gap-1.5 hover:opacity-90 min-w-0 pr-8"
      >
        <div className="flex items-start justify-between gap-2 min-h-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-[var(--cal-ink)] truncate">
              {headline}
            </p>
            {secondaryTitle ? <p className="text-[11px] text-[var(--cal-muted)] truncate">{secondaryTitle}</p> : null}
            <p className="text-[11px] tnum text-[var(--cal-muted)] truncate">{workout.date}</p>
          </div>
          <span className="text-[10px] tnum text-[var(--cal-muted)] shrink-0 pt-0.5">{statusMeta || 'Planned'}</span>
        </div>
        {visibleExercises.length > 0 ? (
          <div className={`grid ${showPlan && showLog ? 'grid-cols-[1rem_minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-[1rem_minmax(0,1fr)]'} gap-x-2 gap-y-0.5 min-w-0`}>
            <span className="text-[10px] text-[var(--cal-muted-soft)]">#</span>
            {showPlan && <span
              data-testid={`sessions-plan-h-${workout.id}`}
              className="text-[10px] text-[var(--cal-muted)] text-right"
            >
              Plan
            </span>}
            {showLog && <span
              data-testid={`sessions-log-h-${workout.id}`}
              className="text-[10px] text-[var(--cal-muted)] text-right"
            >
              Log
            </span>}
            {visibleExercises.map((ex) => {
              const planRows = mode === 'log' ? [] : ex.sets.filter((set) => set.scope !== 'log');
              const logRows = mode === 'plan' ? [] : ex.sets.filter((set) => set.scope !== 'plan');
              const rowCount = Math.max(planRows.length, logRows.length);
              const { topE1RM, tonnage, avgIntensityPct } = getLoggedLiftSummary(ex.sets);
              const previous = comparison.get(ex.id);
              return (
                <Fragment key={ex.id}>
                  <div className={`${showPlan && showLog ? 'col-span-3' : 'col-span-2'} flex flex-col gap-0.5 min-w-0 pt-1`}>
                    <span className="min-w-0 text-[11px] font-medium text-[var(--cal-ink)] truncate" title={ex.title}>
                      {ex.title}
                    </span>
                    {topE1RM != null || tonnage != null || avgIntensityPct != null ? (
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tnum text-[var(--cal-muted)] min-w-0">
                        {topE1RM != null ? <span className="whitespace-nowrap" data-testid={`sessions-lift-e1rm-${ex.id}`} title="Highest logged e1RM for this lift">e1RM {Math.round(topE1RM)} kg {compareVisibility.e1rm && <Delta current={topE1RM} previous={previous?.topE1RM ?? null} digits={0} unit=" kg" relative />}</span> : null}
                        {tonnage != null ? <span className="whitespace-nowrap" data-testid={`sessions-lift-tonnage-${ex.id}`} title="Logged weight × reps for this lift">Tonnage {tonnage.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg {compareVisibility.tonnage && <Delta current={tonnage} previous={previous?.tonnage ?? null} digits={2} unit=" kg" relative />}</span> : null}
                        {avgIntensityPct != null ? <span className="whitespace-nowrap" data-testid={`sessions-lift-avg-int-${ex.id}`} title="Average intensity of logged sets with RPE">Avg int {avgIntensityPct}% {compareVisibility.avgInt && <Delta current={avgIntensityPct} previous={previous?.avgIntensityPct ?? null} digits={0} unit="%" />}</span> : null}
                      </span>
                    ) : null}
                  </div>
                  {Array.from({ length: Math.max(rowCount, 1) }).map((_, index) => {
                    const planSet = planRows[index];
                    const logSet = logRows[index];
                    const planned = planSet ? formatSetReadout(planSet.plannedWeight, planSet.plannedReps, planSet.plannedRpe) : '—';
                    const logged = logSet ? formatSetReadout(logSet.actual, logSet.reps, logSet.executedRpe) : '—';
                    const rowKey = `${planSet?.id ?? 'no-plan'}-${logSet?.id ?? 'no-log'}-${index}`;
                    return (
                      <Fragment key={rowKey}>
                        <span className="tnum text-[10px] text-[var(--cal-muted-soft)]">{index + 1}</span>
                        {showPlan && <span
                          data-testid={planSet ? `sessions-set-plan-${planSet.id}` : undefined}
                          className="tnum text-[11px] text-[var(--cal-muted)] text-right whitespace-nowrap"
                        >
                          {planned}
                        </span>}
                        {showLog && <span
                          data-testid={logSet ? `sessions-set-log-${logSet.id}` : undefined}
                          className={`tnum text-[11px] text-right whitespace-nowrap ${
                            logged === '—' ? 'text-[var(--cal-muted-soft)]' : 'text-[var(--cal-ink)]'
                          }`}
                        >
                          {logged}
                        </span>}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        ) : <p className="text-[11px] text-[var(--cal-muted)]">No lifts yet</p>}
      </button>
      <details className="absolute right-2 top-2 text-[11px] text-[var(--cal-muted)]" aria-label="Session actions">
        <summary data-testid={`sessions-actions-${workout.id}`} className="cursor-pointer list-none rounded px-2 py-1 hover:bg-[var(--cal-surface-soft)]" aria-label="Session actions">•••</summary>
        <div className={actionMenuClass}>
        <label className="flex items-center gap-1 text-[11px] text-[var(--cal-muted)]">
          <input
            type="checkbox"
            data-testid={`sessions-select-${workout.id}`}
            checked={selected}
            disabled={!canCopy}
            onChange={(event) => onToggleSelected(event.target.checked)}
            className="accent-[var(--cal-accent)]"
          />
          Select
        </label>
        <button
          type="button"
          data-testid={`sessions-copy-to-${workout.id}`}
          disabled={!canCopy}
          onClick={onCopyTo}
          className={`h-7 px-2 text-[11px] rounded-[var(--cal-radius-md)] disabled:opacity-40 ${
            canCopy
              ? 'text-[var(--cal-ink)] bg-[var(--cal-surface-strong)] hover:opacity-90'
              : 'text-[var(--cal-muted)] bg-[var(--cal-surface-soft)]'
          }`}
        >
          Copy to
        </button>
        <button
          type="button"
          data-testid={`sessions-edit-${workout.id}`}
          onClick={onEdit}
          className="h-7 px-2 text-[11px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] rounded-[var(--cal-radius-md)]"
        >
          Edit
        </button>
        <button
          type="button"
          data-testid={`sessions-delete-${workout.id}`}
          onClick={onDelete}
          className="h-7 px-2 text-[11px] text-[var(--cal-error)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)]"
        >
          Delete
        </button>
        </div>
      </details>
    </div>
  );
}

function WeekRow({
  rowKey,
  weekLabel,
  count,
  canCopy,
  onCopyWeek,
}: {
  rowKey: string;
  weekLabel: string;
  count: number;
  canCopy: boolean;
  onCopyWeek: () => void;
}) {
  return (
    <div
      data-testid={`sessions-week-row-${rowKey}`}
      className="px-[var(--cal-space-xxs)] flex flex-col gap-2"
    >
      <div className="min-h-7 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-[var(--cal-ink)]">Week {weekLabel}</h4>
        <span className="sr-only">{count} sessions</span>
        <details className="relative text-[11px] text-[var(--cal-muted)]">
          <summary data-testid={`sessions-week-actions-${rowKey}`} className="cursor-pointer list-none rounded px-2 py-1 hover:bg-[var(--cal-surface-soft)]" aria-label={`Week ${weekLabel} actions`}>•••</summary>
          <div className={actionMenuClass}>
            <button
              type="button"
              data-testid={`sessions-copy-week-${rowKey}`}
              disabled={!canCopy}
              onClick={onCopyWeek}
              className={copyBtnClass}
            >
              Copy week
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

function RestDayRow({ date }: { date: string }) {
  return (
    <div
      data-testid={`sessions-rest-${date}`}
      className="px-3 py-1 text-[10px] text-[var(--cal-muted-soft)] flex items-center justify-between gap-2"
    >
      <span className="tnum">{date}</span>
      <span>Rest day</span>
    </div>
  );
}

function BlockHeader({
  blockLabel,
  count,
  canCopy,
  onCopyBlock,
}: {
  blockLabel: string;
  count: number;
  canCopy: boolean;
  onCopyBlock: () => void;
}) {
  return (
    <div
      data-testid={`sessions-block-row-${blockLabel}`}
      className="min-h-8 px-[var(--cal-space-xxs)] flex items-center justify-between gap-2"
    >
      <h3 className="text-sm font-semibold tracking-tight text-[var(--cal-ink)]">Block {blockLabel}</h3>
      <div className="flex items-center gap-2">
        <details className="relative text-[11px] text-[var(--cal-muted)]">
          <summary data-testid={`sessions-block-actions-${blockLabel}`} className="cursor-pointer list-none rounded px-2 py-1 hover:bg-[var(--cal-surface-soft)]" aria-label={`Block ${blockLabel} actions`}>•••</summary>
          <div className={actionMenuClass}>
            <button
              type="button"
              data-testid={`sessions-copy-block-${blockLabel}`}
              disabled={!canCopy}
              onClick={onCopyBlock}
              className={copyBtnClass}
            >
              Copy block
            </button>
          </div>
        </details>
        <span className="sr-only">{count} sessions</span>
      </div>
    </div>
  );
}

export function SessionsView({
  onViewSession,
  onDeleteSession,
  filter,
  onFilterChange,
  onStartCopy,
}: SessionsViewProps) {
  const {
    microcycles,
    activeWorkoutId,
    reloadMicrocycles,
    activeAthleteId,
    planAthleteId,
  } = usePeriodization();
  const { isOnline } = useSync();

  const [editingSession, setEditingSession] = useState<WorkoutData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('both');
  const [compareVisibility, setCompareVisibility] = useState<CompareVisibility>(allComparisons);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const expectedScrollRef = useRef(new Map<HTMLElement, number>());
  const [scrollWidth, setScrollWidth] = useState(0);
  const [scrollViewportWidth, setScrollViewportWidth] = useState(0);
  const [activeWeekHeaders, setActiveWeekHeaders] = useState<{ label: string; width: number }[]>([]);
  const [activeBlockLabel, setActiveBlockLabel] = useState<string | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);
  const [blockSelection, setBlockSelection] = useState<{ athleteId: string | null; key: string } | null>(null);
  const { user } = useAuth();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';

  const allSessions = useMemo(() => {
    const entries: SessionEntry[] = [];
    microcycles.forEach((micro) => {
      micro.workouts.forEach((workout) => {
        entries.push({ workout, microId: micro.id });
      });
    });
    return entries
      .filter(({ workout }) => workoutPassesFilter(workout, filter))
      .sort((a, b) => a.workout.date.localeCompare(b.workout.date));
  }, [microcycles, filter]);

  const comparisons = useMemo(
    () => buildPreviousWeekLiftSummaries(microcycles.flatMap((micro) => micro.workouts)),
    [microcycles],
  );

  const groupedSessions = useMemo(
    () => groupLabeledSessions<SessionEntry>(allSessions, (entry) => entry.workout),
    [allSessions],
  );
  const blockChoices = useMemo((): BlockChoice[] => {
    const named = groupedSessions.blocks.map((block) => ({
      key: `block:${block.blockLabel}`,
      label: `Block ${block.blockLabel}`,
      blockLabel: block.blockLabel,
      weeks: block.weeks,
      noWeek: block.noWeek,
      all: block.all,
      latestDate: block.all.at(-1)?.workout.date || '',
    })).sort((a, b) => a.latestDate.localeCompare(b.latestDate) || a.label.localeCompare(b.label));
    const unassigned = [...groupedSessions.weeksNoBlock.flatMap((week) => week.items), ...groupedSessions.unlabeled]
      .sort((a, b) => a.workout.date.localeCompare(b.workout.date));
    if (unassigned.length === 0) return named;
    return [...named, {
      key: 'unassigned',
      label: 'Unassigned',
      blockLabel: null,
      weeks: groupedSessions.weeksNoBlock,
      noWeek: groupedSessions.unlabeled,
      all: unassigned,
      latestDate: unassigned.at(-1)?.workout.date || '',
    }];
  }, [groupedSessions]);
  const defaultBlockKey = [...blockChoices].reverse().find((choice) => choice.blockLabel)?.key || blockChoices[0]?.key || '';
  const selectedBlockKey = blockSelection?.athleteId === planAthleteId && blockChoices.some((choice) => choice.key === blockSelection.key)
    ? blockSelection.key
    : defaultBlockKey;
  const selectedBlockIndex = blockChoices.findIndex((choice) => choice.key === selectedBlockKey);
  const selectedBlock = blockChoices[selectedBlockIndex];
  const occupiedDates = useMemo(
    () => new Set(microcycles.flatMap((micro) => micro.workouts.map((workout) => workout.date))),
    [microcycles],
  );

  const showCoachSelectAthlete = isCoach && !activeAthleteId;
  const [showNewSession, setShowNewSession] = useState(false);
  const canCopy = isOnline && !showCoachSelectAthlete;

  useEffect(() => {
    expectedScrollRef.current.clear();
    setSelectedIds(new Set());
    const content = contentRef.current;
    if (content) {
      content.scrollTop = 0;
      const board = content.querySelector<HTMLElement>('.sessions-week-board');
      if (board) board.scrollLeft = 0;
    }
    if (scrollbarRef.current) scrollbarRef.current.scrollLeft = 0;
    setHeaderOffset(0);
  }, [planAthleteId, selectedBlockKey]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const board = () => content.querySelector<HTMLElement>('.sessions-week-board');
    const updateHeaders = () => {
      const threshold = content.getBoundingClientRect().top + 1;
      const current = board();
      const rect = current?.getBoundingClientRect();
      if (!current || !rect || rect.top > threshold || rect.bottom <= threshold) {
        setActiveWeekHeaders([]);
        setActiveBlockLabel(null);
        return;
      }
      setActiveBlockLabel(current.dataset.blockLabel || '');
      const weeks: Element[] = Array.from(current.children);
      setActiveWeekHeaders(weeks.map((week) => ({
        label: week.querySelector('h4')?.textContent || '',
        width: (week as HTMLElement).getBoundingClientRect().width,
      })));
      setHeaderOffset(current.scrollLeft);
    };
    const updateSize = () => {
      setScrollWidth(board()?.scrollWidth || 0);
      setScrollViewportWidth(board()?.clientWidth || 0);
      updateHeaders();
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(content);
    const current = board();
    if (current) observer.observe(current);
    content.addEventListener('scroll', updateHeaders, { passive: true });
    updateSize();
    return () => {
      observer.disconnect();
      content.removeEventListener('scroll', updateHeaders);
    };
  }, [groupedSessions, selectedBlockKey]);

  const syncHorizontalScroll = (source: HTMLElement, left: number) => {
    const expected = expectedScrollRef.current;
    if (expected.get(source) === left) {
      expected.delete(source);
      return;
    }
    expected.delete(source);
    const content = contentRef.current;
    if (!content) return;
    const targets = [scrollbarRef.current, content.querySelector<HTMLElement>('.sessions-week-board')];
    targets.forEach((target) => {
      if (target && target !== source && target.scrollLeft !== left) {
        expected.set(target, Math.min(left, target.scrollWidth - target.clientWidth));
        target.scrollLeft = left;
      }
    });
    const threshold = content.getBoundingClientRect().top + 1;
    const activeBoard = content.querySelector<HTMLElement>('.sessions-week-board');
    const rect = activeBoard?.getBoundingClientRect();
    setHeaderOffset(rect && rect.top <= threshold && rect.bottom > threshold ? activeBoard.scrollLeft : 0);
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const startDayCopy = (workouts: WorkoutData[]) => {
    if (!canCopy || workouts.length === 0) return;
    onStartCopy(buildDayClipboard(workouts, getRecentBlock(planAthleteId)));
  };

  const startWeekCopy = (entries: SessionEntry[]) => {
    const workouts = entries.map(({ workout }) => workout);
    if (!canCopy || workouts.length === 0) return;
    onStartCopy(buildWeekClipboard(workouts, getRecentBlock(planAthleteId)));
  };

  const startBlockCopy = (entries: SessionEntry[], blockLabel: string) => {
    const workouts = entries.map(({ workout }) => workout);
    if (!canCopy || workouts.length === 0) return;
    onStartCopy(buildBlockClipboard(workouts, blockLabel));
  };

  const renderSessionCard = ({ workout, microId }: SessionEntry) => (
    <SessionCard
      key={workout.id}
      workout={workout}
      active={activeWorkoutId === workout.id}
      canCopy={canCopy}
      selected={selectedIds.has(workout.id)}
      filter={filter}
      mode={displayMode}
      comparison={comparisons}
      compareVisibility={compareVisibility}
      onOpen={() => onViewSession(workout, microId)}
      onToggleSelected={(checked) => toggleSelected(workout.id, checked)}
      onCopyTo={() => startDayCopy([workout])}
      onEdit={() => setEditingSession(workout)}
      onDelete={() => void onDeleteSession(workout)}
    />
  );

  const renderWeeks = (weeks: Array<{ weekLabel: string; items: SessionEntry[] }>, blockLabel: string) => {
    const ordered = sortByFirstSession(weeks, sessionDate);
    return (
      <div
        data-testid={`sessions-week-board-${blockLabel || 'no-block'}`}
        data-block-label={blockLabel}
        className="sessions-week-board grid grid-flow-col gap-[var(--cal-space-xs)] overflow-x-auto overscroll-x-contain min-w-0 pb-1"
        style={{ gridAutoColumns: 'minmax(min(100%, 20rem), 1fr)' }}
        onScroll={(event) => syncHorizontalScroll(event.currentTarget, event.currentTarget.scrollLeft)}
      >
        {ordered.map((week, index) => {
          const rowKey = `${blockLabel || '_'}::${week.weekLabel}`;
          const nextWeekDate = ordered[index + 1]?.items[0]?.workout.date;
          return (
            <div key={rowKey} className={weekCardClass}>
              <WeekRow
                rowKey={rowKey}
                weekLabel={week.weekLabel}
                count={week.items.length}
                canCopy={canCopy}
                onCopyWeek={() => startWeekCopy(week.items)}
              />
              <div className="flex flex-col gap-[var(--cal-space-xs)]">
                {weekBoardRows(week.items, nextWeekDate, sessionDate, occupiedDates).map((row) =>
                  row.kind === 'session'
                    ? renderSessionCard(row.item)
                    : <Fragment key={`rest-${row.date}`}><RestDayRow date={row.date} /></Fragment>,
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col relative h-full min-w-0 overflow-hidden bg-[var(--cal-canvas)]">
      <div data-testid="sessions-toolbar" className="relative z-30 shrink-0 px-[var(--cal-space-sm)] py-[var(--cal-space-sm)] flex flex-col gap-2 border-b border-[var(--cal-hairline)] bg-[var(--cal-canvas)] sm:flex-row sm:items-center sm:justify-between">
            {!showCoachSelectAthlete ? (
              <div className="flex flex-wrap items-center gap-2 order-first sm:order-last">
                {selectedBlock ? (
                  <div role="group" aria-label="Block navigation" className="inline-flex h-8 items-center rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] text-[11px] text-[var(--cal-ink)]">
                    <button type="button" data-testid="sessions-block-prev" aria-label="Previous block" disabled={selectedBlockIndex <= 0} onClick={() => setBlockSelection({ athleteId: planAthleteId, key: blockChoices[selectedBlockIndex - 1].key })} className="h-full px-2 disabled:opacity-40">‹</button>
                    <select data-testid="sessions-block-picker" aria-label="Block" value={selectedBlockKey} onChange={(event) => setBlockSelection({ athleteId: planAthleteId, key: event.target.value })} className="h-full max-w-32 bg-[var(--cal-canvas)] font-semibold outline-none">
                      {blockChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
                    </select>
                    <button type="button" data-testid="sessions-block-next" aria-label="Next block" disabled={selectedBlockIndex >= blockChoices.length - 1} onClick={() => setBlockSelection({ athleteId: planAthleteId, key: blockChoices[selectedBlockIndex + 1].key })} className="h-full px-2 disabled:opacity-40">›</button>
                  </div>
                ) : null}
                <button
                  type="button"
                  data-testid="sessions-add"
                  onClick={() => setShowNewSession(true)}
                  className="h-8 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-accent)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity"
                >
                  Add session
                </button>
                {selectedIds.size > 0 ? (
                  <button
                    type="button"
                    data-testid="sessions-copy-selected"
                    disabled={!canCopy}
                    onClick={() => {
                      const selected = allSessions
                        .filter(({ workout }) => selectedIds.has(workout.id))
                        .map(({ workout }) => workout);
                      startDayCopy(selected);
                    }}
                    className="h-8 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-strong)] text-[var(--cal-ink)] text-[11px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    Copy selected
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 order-last sm:order-first">
              <LiftFilter value={filter} onChange={onFilterChange} emptyLabel="All lifts" />
              <div className="inline-flex rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] p-0.5" role="group" aria-label="Sessions display">
                {(['plan', 'log', 'both'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-testid={`sessions-mode-${option}`}
                    aria-pressed={displayMode === option}
                    onClick={() => setDisplayMode(option)}
                    className={`h-7 px-2 rounded-[var(--cal-radius-sm)] text-[11px] font-medium ${displayMode === option ? 'bg-[var(--cal-surface-strong)] text-[var(--cal-ink)]' : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}
                  >
                    {option === 'plan' ? 'Plan' : option === 'log' ? 'Log' : 'Both'}
                  </button>
                ))}
              </div>
              <details className="relative text-[11px] text-[var(--cal-muted)]">
                <summary data-testid="sessions-compare-open" className="h-8 px-3 flex items-center cursor-pointer rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] hover:text-[var(--cal-ink)]">Compare</summary>
                <div className="absolute left-0 top-full z-30 mt-1 min-w-44 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-2 shadow-sm flex flex-col gap-2" aria-label="Compare metrics">
                  {([['e1rm', 'e1RM'], ['tonnage', 'Tonnage'], ['avgInt', 'Avg int']] as const).map(([metric, label]) => (
                    <label key={metric} className="flex items-center justify-between gap-3 text-[var(--cal-ink)]">
                      {label}
                      <input type="checkbox" role="switch" aria-label={`Compare ${label}`} data-testid={`sessions-compare-${metric}`} checked={compareVisibility[metric]} onChange={(event) => setCompareVisibility((previous) => ({ ...previous, [metric]: event.target.checked }))} />
                    </label>
                  ))}
                  <div className="flex gap-2 border-t border-[var(--cal-hairline)] pt-2">
                    <button type="button" data-testid="sessions-compare-show-all" onClick={() => setCompareVisibility({ ...allComparisons })}>Show all</button>
                    <button type="button" data-testid="sessions-compare-hide-all" onClick={() => setCompareVisibility({ e1rm: false, tonnage: false, avgInt: false })}>Hide all</button>
                  </div>
                </div>
              </details>
            </div>
            {!showCoachSelectAthlete && !isOnline ? (
              <p data-testid="copy-offline" className="w-full text-[10px] text-[var(--cal-warning)] order-last">
                Connect to copy sessions.
              </p>
            ) : null}
      </div>
      <div ref={contentRef} data-testid="sessions-content" className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        {activeWeekHeaders.length > 0 ? (
          <div data-testid="sessions-sticky-weeks" className="sticky top-0 z-20 h-0 overflow-visible">
            <div className="overflow-hidden border-b border-[var(--cal-hairline)] bg-[var(--cal-canvas)]">
              <div className="h-5 px-[var(--cal-space-sm)] flex items-center text-[11px] font-semibold text-[var(--cal-ink)]">
                {activeBlockLabel ? `Block ${activeBlockLabel}` : 'Unassigned'}
              </div>
              <div className="px-[var(--cal-space-sm)] overflow-hidden">
                <div className="flex gap-[var(--cal-space-xs)]" style={{ transform: `translateX(-${headerOffset}px)` }}>
                  {activeWeekHeaders.map((week, index) => (
                    <div key={`${week.label}-${index}`} className="h-5 shrink-0 px-[var(--cal-space-xs)] flex items-center text-[11px] font-semibold text-[var(--cal-ink)]" style={{ width: week.width }}>
                      {week.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="space-y-[var(--cal-space-sm)] px-[var(--cal-space-sm)] pt-[var(--cal-space-sm)] pb-[var(--cal-space-lg)]">
          {showCoachSelectAthlete ? (
            <div
              data-testid="sessions-empty"
              className="border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-6 text-center bg-[var(--cal-surface-soft)]"
            >
              <p className="text-sm text-[var(--cal-ink)] mb-1">Select an athlete</p>
              <p className="text-xs text-[var(--cal-muted)]">Use the athlete switcher in the sidebar to load a plan.</p>
            </div>
          ) : allSessions.length === 0 && !isEmptyLiftFilter(filter) ? (
            <p data-testid="sessions-filter-empty" className="text-xs text-[var(--cal-muted)] px-[var(--cal-space-xxs)]">
              No matching sessions.
            </p>
          ) : allSessions.length === 0 ? (
            <div
              data-testid="sessions-empty"
              className="border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-6 text-center bg-[var(--cal-surface-soft)]"
            >
              <p className="text-sm text-[var(--cal-ink)] mb-1">No sessions yet</p>
              <p className="text-xs text-[var(--cal-muted)]">Add session. Block/Week can wait.</p>
            </div>
          ) : (
            selectedBlock ? (
              <section key={selectedBlock.key} className="flex flex-col gap-[var(--cal-space-xs)] min-w-0">
                {selectedBlock.blockLabel ? (
                  <BlockHeader
                    blockLabel={selectedBlock.blockLabel}
                    count={selectedBlock.all.length}
                    canCopy={canCopy}
                    onCopyBlock={() => startBlockCopy(selectedBlock.all, selectedBlock.blockLabel!)}
                  />
                ) : (
                  <h3 className="min-h-8 px-[var(--cal-space-xxs)] flex items-center text-sm font-semibold text-[var(--cal-ink)]">Unassigned</h3>
                )}
                <div className={`${blockCardClass} min-w-0`}>
                  {selectedBlock.weeks.length > 0 ? renderWeeks(selectedBlock.weeks, selectedBlock.blockLabel || '') : null}
                  {selectedBlock.noWeek.length > 0 ? (
                    <section className="flex flex-col gap-[var(--cal-space-xs)]">
                      <h4 className="px-[var(--cal-space-xxs)] text-xs font-semibold text-[var(--cal-ink)]">{selectedBlock.blockLabel ? 'No Week' : 'No Block or Week'}</h4>
                      <div className="grid gap-[var(--cal-space-xs)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
                        {selectedBlock.noWeek.map((entry) => renderSessionCard(entry))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </section>
            ) : null
          )}
        </div>
      </div>
      {scrollWidth > scrollViewportWidth ? (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-[var(--cal-canvas)] px-[var(--cal-space-sm)]" data-testid="sessions-scrollbar-wrap">
          <div ref={scrollbarRef} data-testid="sessions-scrollbar" className="overflow-x-scroll overflow-y-hidden" onScroll={(event) => syncHorizontalScroll(event.currentTarget, event.currentTarget.scrollLeft)}>
            <div style={{ width: scrollWidth, height: 1 }} />
          </div>
        </div>
      ) : (
        <div ref={scrollbarRef} className="hidden" />
      )}
      {showNewSession && (
        <NewSessionDialog
          date={new Date().toISOString().slice(0, 10)}
          allowDateEdit
          athleteId={planAthleteId}
          initialBlockLabel={selectedBlock ? selectedBlock.blockLabel || '' : undefined}
          onClose={() => setShowNewSession(false)}
          onCreated={async () => {
            await reloadMicrocycles(planAthleteId);
            setShowNewSession(false);
          }}
        />
      )}
      {editingSession && (
        <EditSessionDialog
          session={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={async () => {
            await reloadMicrocycles(planAthleteId);
            setEditingSession(null);
          }}
          onDeleted={async () => {
            await reloadMicrocycles(planAthleteId);
            setEditingSession(null);
          }}
        />
      )}
    </div>
  );
}

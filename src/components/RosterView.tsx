import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Archive, RefreshCw, Search, Trash2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import type { DashboardMode } from '../navigation';
import { ApiRequestError, apiService, type CoachingHistorySnapshot, type PastAthlete, type RosterAthlete } from '../services/api';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';

type RosterViewState = 'loading' | 'ready' | 'error' | 'permission-denied';

const buttonClass = 'inline-flex h-11 sm:h-8 items-center justify-center gap-1.5 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] px-2.5 text-[12px] font-medium text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

function utcDate(value: string | null): string {
  return value ? value.slice(0, 10) : 'date unavailable';
}

export function RosterView({ onNavigate }: { onNavigate: (mode: DashboardMode) => void }) {
  const { user } = useAuth();
  const { activeAthleteId, setActiveAthleteId, setMicrocycles, setActiveWorkoutId, setActiveMicrocycleId } = usePeriodization();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const [athletes, setAthletes] = useState<RosterAthlete[]>([]);
  const [query, setQuery] = useState('');
  const [viewState, setViewState] = useState<RosterViewState>(isCoach ? 'loading' : 'permission-denied');
  const [errorMessage, setErrorMessage] = useState('');
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [pastAthletes, setPastAthletes] = useState<PastAthlete[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastLoaded, setPastLoaded] = useState(false);
  const [pastError, setPastError] = useState('');
  const [archive, setArchive] = useState<CoachingHistorySnapshot | null>(null);
  const [archiveLoadingId, setArchiveLoadingId] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const loadRoster = useCallback(async () => {
    if (!isCoach) {
      setViewState('permission-denied');
      return;
    }
    setViewState('loading');
    setErrorMessage('');
    try {
      const data = await apiService.fetchRoster();
      setAthletes(data.slice().sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, undefined, { sensitivity: 'base' })));
      setViewState('ready');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 403) {
        setViewState('permission-denied');
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Could not load the roster.');
        setViewState('error');
      }
    }
  }, [isCoach]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const filteredAthletes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return athletes;
    return athletes.filter((athlete) => athlete.email.toLocaleLowerCase().includes(normalized) || (athlete.displayName || '').toLocaleLowerCase().includes(normalized));
  }, [athletes, query]);

  const loadPastAthletes = useCallback(async () => {
    setPastLoading(true);
    setPastError('');
    try {
      setPastAthletes(await apiService.fetchPastAthletes());
    } catch (error) {
      setPastError(error instanceof Error ? error.message : 'Could not load past athletes.');
    } finally {
      setPastLoading(false);
      setPastLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (tab === 'past' && !pastLoading && !pastLoaded) void loadPastAthletes();
  }, [tab, pastLoading, pastLoaded, loadPastAthletes]);

  const openAthlete = (athleteId: string) => {
    setActiveAthleteId(athleteId);
    onNavigate('calendar');
  };

  const unlinkAthlete = async (athlete: RosterAthlete) => {
    const label = athlete.displayName?.trim() || athlete.email;
    const confirmed = window.confirm(
      `Unlink ${label}? You will lose access to their live plan. A read-only snapshot of workouts through the unlink date (UTC) will remain under Past athletes. Their plan stays in their account.`,
    );
    if (!confirmed) return;
    setUnlinkingId(athlete.id);
    setActionMessage('');
    setErrorMessage('');
    try {
      const result = await apiService.unlinkAthlete(athlete.id);
      setAthletes((current) => current.filter((item) => item.id !== athlete.id));
      if (activeAthleteId === athlete.id) {
        setMicrocycles([]);
        setActiveAthleteId(null);
        setActiveWorkoutId(null);
        setActiveMicrocycleId(null);
      }
      setActionMessage(result.cacheCleared
        ? `${label} was unlinked. Their workout snapshot is available under Past athletes.`
        : `${label} was unlinked, but this browser could not clear its cached live plan. Refresh before continuing.`);
      if (tab === 'past') await loadPastAthletes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not unlink this athlete.');
    } finally {
      setUnlinkingId(null);
    }
  };

  const openArchive = async (athlete: PastAthlete) => {
    if (!athlete.archiveAvailable) return;
    setArchiveLoadingId(athlete.relationshipId);
    setArchiveError('');
    setArchive(null);
    try {
      setArchive(await apiService.fetchCoachingHistory(athlete.relationshipId));
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Could not load this workout history.');
    } finally {
      setArchiveLoadingId(null);
    }
  };

  const filteredPastAthletes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return pastAthletes;
    return pastAthletes.filter((athlete) => athlete.email.toLocaleLowerCase().includes(normalized) || (athlete.displayName || '').toLocaleLowerCase().includes(normalized));
  }, [pastAthletes, query]);

  return (
    <section className="flex-1 overflow-y-auto p-4 sm:p-6" aria-labelledby="roster-title">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="roster-title" className="text-lg font-semibold tracking-tight text-[var(--cal-ink)]">Roster</h1>
            <p className="mt-1 text-sm text-[var(--cal-muted)]">Find a linked athlete and open their plan.</p>
          </div>
          {isCoach && viewState === 'ready' && tab === 'active' && (
            <button type="button" className={buttonClass} onClick={() => void loadRoster()} disabled={viewState === 'loading'}>
              <RefreshCw size={14} className={viewState === 'loading' ? 'animate-spin' : ''} />
              Refresh
            </button>
          )}
        </header>

        {viewState === 'permission-denied' ? (
          <div className="rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-5" role="alert" data-testid="roster-permission-denied">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-[var(--cal-warning)]" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-medium text-[var(--cal-ink)]">Roster is for coaches</h2>
                <p className="mt-1 text-sm text-[var(--cal-muted)]">Your athlete account can open its own plan from Calendar or Sessions.</p>
                <button type="button" className={`${buttonClass} mt-3`} onClick={() => onNavigate('calendar')}>Go to Calendar</button>
              </div>
            </div>
          </div>
        ) : viewState === 'loading' ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--cal-muted)]" role="status" data-testid="roster-loading">
            <RefreshCw size={15} className="animate-spin text-[var(--cal-accent)]" aria-hidden="true" />
            Loading linked athletes…
          </div>
        ) : viewState === 'error' ? (
          <div className="rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-5" role="alert" data-testid="roster-error">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-[var(--cal-error)]" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-[var(--cal-ink)]">Could not load linked athletes.</p>
                {errorMessage && <p className="mt-1 text-xs text-[var(--cal-muted)]">{errorMessage}</p>}
                <button type="button" className={`${buttonClass} mt-3`} onClick={() => void loadRoster()}>Try again</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex gap-2 border-b border-[var(--cal-hairline)]" role="tablist" aria-label="Roster views">
              <button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => { setTab('active'); setArchive(null); setQuery(''); }} className={`h-11 px-3 text-sm border-b-2 ${tab === 'active' ? 'border-[var(--cal-accent)] text-[var(--cal-ink)]' : 'border-transparent text-[var(--cal-muted)]'}`}>Active athletes</button>
              <button type="button" role="tab" aria-selected={tab === 'past'} onClick={() => { setTab('past'); setArchive(null); setQuery(''); }} className={`h-11 px-3 text-sm border-b-2 ${tab === 'past' ? 'border-[var(--cal-accent)] text-[var(--cal-ink)]' : 'border-transparent text-[var(--cal-muted)]'}`}>Past athletes</button>
            </div>
            {actionMessage && <p className="mb-3 text-sm text-[var(--cal-success)]" role="status">{actionMessage}</p>}
            {errorMessage && <p className="mb-3 text-sm text-[var(--cal-error)]" role="alert">{errorMessage}</p>}
            {tab === 'active' && (athletes.length === 0 ? (
          <div className="rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-5" data-testid="roster-empty">
            <div className="flex items-start gap-3">
              <Users size={18} className="mt-0.5 text-[var(--cal-muted)]" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-medium text-[var(--cal-ink)]">No linked athletes yet</h2>
                <p className="mt-1 max-w-xl text-sm text-[var(--cal-muted)]">Athletes join your roster by entering a coach code. Generate or manage the code in Security.</p>
                <button type="button" className={`${buttonClass} mt-3`} onClick={() => onNavigate('security')}>
                  Open Security <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--cal-muted)]" data-testid="roster-count">{athletes.length} {athletes.length === 1 ? 'athlete' : 'athletes'}</p>
              <label className="relative block w-full sm:w-64">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--cal-muted)]" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search athletes"
                  data-testid="roster-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search athletes"
                  className="h-11 sm:h-8 w-full rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] pl-8 pr-2 text-xs text-[var(--cal-ink)] placeholder:text-[var(--cal-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
                />
              </label>
            </div>

            <ul className="divide-y divide-[var(--cal-hairline)] border-y border-[var(--cal-hairline)]" aria-label="Linked athletes" data-testid="roster-list">
              {filteredAthletes.map((athlete) => (
                <li key={athlete.id} className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    data-testid={`roster-athlete-${athlete.id}`}
                    aria-current={athlete.id === activeAthleteId ? 'true' : undefined}
                    onClick={() => openAthlete(athlete.id)}
                    className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 text-left hover:bg-[var(--cal-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cal-accent)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--cal-ink)]">{athlete.displayName?.trim() || athlete.email}</span>
                      {athlete.displayName?.trim() && <span className="mt-0.5 block truncate text-[11px] text-[var(--cal-muted)]">{athlete.email}</span>}
                      <span className="mt-0.5 block text-[11px] text-[var(--cal-muted)]">Linked</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--cal-muted)]">
                      Open Calendar <ArrowRight size={13} aria-hidden="true" />
                    </span>
                  </button>
                  <button type="button" className={buttonClass} onClick={() => void unlinkAthlete(athlete)} disabled={unlinkingId !== null} aria-label={`Unlink ${athlete.displayName?.trim() || athlete.email}`}>
                    {unlinkingId === athlete.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    <span>Unlink</span>
                  </button>
                </li>
              ))}
              {filteredAthletes.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-[var(--cal-muted)]" data-testid="roster-no-matches">
                  No athletes match “{query.trim()}”.
                </li>
              )}
            </ul>
          </div>
        ))}
            {tab === 'past' && (archive ? (
              <section data-testid="past-athlete-archive">
                <button type="button" className={`${buttonClass} mb-3`} onClick={() => setArchive(null)}><ArrowLeft size={14} /> Past athletes</button>
                <h2 className="text-base font-semibold text-[var(--cal-ink)]">{archive.athlete.displayName?.trim() || archive.athlete.email}</h2>
                <p className="mt-1 text-xs text-[var(--cal-muted)]">Read-only snapshot through {archive.throughDate} (UTC). Edits and activity after unlinking are not included.</p>
                {archive.microcycles.flatMap((microcycle) => microcycle.workouts).length === 0 ? (
                  <p className="mt-4 rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] p-4 text-sm text-[var(--cal-muted)]">No workouts were recorded during this coaching link.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-[var(--cal-hairline)] border-y border-[var(--cal-hairline)]">
                    {archive.microcycles.flatMap((microcycle) => microcycle.workouts).map((workout) => (
                      <li key={workout.id} className="py-3">
                        <h3 className="text-sm font-medium text-[var(--cal-ink)]">{workout.title} <span className="font-normal text-[var(--cal-muted)]">· {workout.date}</span></h3>
                        <div className="mt-2 space-y-2">
                          {workout.exercises.map((exercise) => (
                            <div key={exercise.id} className="rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] p-2">
                              <p className="text-xs font-medium text-[var(--cal-ink)]">{exercise.title} {exercise.variation}</p>
                              <div className="mt-1 space-y-0.5">
                                {exercise.sets.map((set, index) => (
                                  <p key={set.id} className="text-[11px] text-[var(--cal-muted)] tnum">
                                    Set {index + 1}: Plan {set.plannedWeight ?? '—'} × {set.plannedReps ?? '—'}{set.plannedRpe != null ? ` @ ${set.plannedRpe}` : ''} · Log {set.actual ?? '—'} × {set.reps ?? '—'}{set.executedRpe != null ? ` @ ${set.executedRpe}` : ''}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-[var(--cal-muted)]">Read-only workout snapshots from ended coaching links.</p>
                  <div className="flex items-center gap-2">
                    <label className="relative block w-full sm:w-64">
                      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--cal-muted)]" aria-hidden="true" />
                      <input type="search" aria-label="Search past athletes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search past athletes" className="h-11 w-full rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] pl-8 pr-2 text-xs text-[var(--cal-ink)]" />
                    </label>
                    <button type="button" className={buttonClass} onClick={() => void loadPastAthletes()} disabled={pastLoading}><RefreshCw size={14} className={pastLoading ? 'animate-spin' : ''} />Refresh</button>
                  </div>
                </div>
                {pastError && <p role="alert" className="mb-3 text-sm text-[var(--cal-error)]">{pastError}</p>}
                {archiveError && <p role="alert" className="mb-3 text-sm text-[var(--cal-error)]">{archiveError}</p>}
                {pastLoading ? <p role="status" className="py-8 text-center text-sm text-[var(--cal-muted)]">Loading past athletes…</p> : filteredPastAthletes.length === 0 ? (
                  <div className="rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-5 text-sm text-[var(--cal-muted)]"><Archive size={17} className="mb-2" />No past athletes yet.</div>
                ) : (
                  <ul className="divide-y divide-[var(--cal-hairline)] border-y border-[var(--cal-hairline)]" aria-label="Past athletes">
                    {filteredPastAthletes.map((athlete) => (
                      <li key={athlete.relationshipId} className="flex items-center justify-between gap-3 px-3 py-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--cal-ink)]">{athlete.displayName?.trim() || athlete.email}</span>
                          {athlete.displayName?.trim() && <span className="block truncate text-[11px] text-[var(--cal-muted)]">{athlete.email}</span>}
                          <span className="block text-[11px] text-[var(--cal-muted)]">Unlinked {utcDate(athlete.endedAt)} (UTC)</span>
                          {!athlete.archiveAvailable && <span className="block text-[11px] text-[var(--cal-warning)]">No snapshot exists for this older link.</span>}
                        </span>
                        <button type="button" className={buttonClass} onClick={() => void openArchive(athlete)} disabled={!athlete.archiveAvailable || archiveLoadingId !== null}>
                          {archiveLoadingId === athlete.relationshipId ? <RefreshCw size={14} className="animate-spin" /> : <Archive size={14} />}
                          View history
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

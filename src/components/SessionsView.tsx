import { useEffect, useMemo, useState } from 'react';
import { ExerciseData, WorkoutData } from '../types';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { apiService } from '../services/api';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';

interface SessionsViewProps {
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: LiftFilterValue;
  onFilterChange: (value: LiftFilterValue) => void;
}

type SessionEntry = { workout: WorkoutData; microId: string };

function liftAbbrev(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('squat')) return 'SQ';
  if (t.includes('bench')) return 'BP';
  if (t.includes('dead')) return 'DL';
  return title.slice(0, 3).toUpperCase();
}

function liftColor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('squat')) return 'text-[#007aff]';
  if (t.includes('bench')) return 'text-[#54e083]';
  if (t.includes('dead')) return 'text-[#F5A623]';
  return 'text-[#AEAEB2]';
}

function setLine(ex: ExerciseData): { planned: string; logged: string | null } {
  const set = ex.sets[0];
  const planned = `${set?.plannedWeight ?? '—'}×${set?.plannedReps ?? '—'}@${set?.plannedRpe ?? '—'}`;
  if (set?.actual != null && Number(set.actual) > 0) {
    return {
      planned,
      logged: `${set.actual}×${set.reps ?? '—'}@${set.executedRpe ?? '—'}`,
    };
  }
  return { planned, logged: null };
}

function workoutPassesFilter(w: WorkoutData, filter: LiftFilterValue): boolean {
  if (filter === 'All') return true;
  const hasSquat = w.exercises.some(e => e.title.toLowerCase().includes('squat'));
  const hasBench = w.exercises.some(e => e.title.toLowerCase().includes('bench'));
  const hasDeadlift = w.exercises.some(e => e.title.toLowerCase().includes('deadlift') || e.title.toLowerCase().includes('dead'));
  if (filter === 'Squat') return hasSquat;
  if (filter === 'Bench') return hasBench;
  if (filter === 'Deadlift') return hasDeadlift;
  return false;
}

function sessionGroupKey(workout: WorkoutData): string {
  const block = workout.blockLabel?.trim() || '';
  const week = workout.weekLabel?.trim() || '';
  if (!block && !week) return 'Ungrouped';
  return `${block}/${week}`;
}

function sessionGroupLabel(key: string): string {
  if (key === 'Ungrouped') return 'Ungrouped';
  const [block, week] = key.split('/');
  const parts = [];
  if (block) parts.push(`Block ${block}`);
  if (week) parts.push(`Week ${week}`);
  return parts.join(' · ') || key;
}

export function SessionsView({
  onViewSession,
  filter,
  onFilterChange,
}: SessionsViewProps) {
  const {
    microcycles,
    activeWorkoutId,
    reloadMicrocycles,
    activeAthleteId,
  } = usePeriodization();

  const [labelDrafts, setLabelDrafts] = useState<Record<string, { block: string; week: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const isCoach = getUiPref(UI_KEYS.role)?.toUpperCase() === 'COACH';

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

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, SessionEntry[]>();
    for (const entry of allSessions) {
      const key = sessionGroupKey(entry.workout);
      const list = groups.get(key) || [];
      list.push(entry);
      groups.set(key, list);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    });
    return keys.map((key) => ({ key, label: sessionGroupLabel(key), entries: groups.get(key)! }));
  }, [allSessions]);

  useEffect(() => {
    const drafts: Record<string, { block: string; week: string }> = {};
    allSessions.forEach(({ workout }) => {
      drafts[workout.id] = {
        block: workout.blockLabel || '',
        week: workout.weekLabel || '',
      };
    });
    setLabelDrafts(drafts);
  }, [allSessions]);

  const saveLabels = async (workoutId: string) => {
    const draft = labelDrafts[workoutId];
    if (!draft) return;
    setSavingId(workoutId);
    try {
      await apiService.updateSession(workoutId, {
        blockLabel: draft.block.trim() || null,
        weekLabel: draft.week.trim() || null,
      });
      await reloadMicrocycles(activeAthleteId);
    } catch (err) {
      console.error(err);
      alert('Failed to save session labels');
    } finally {
      setSavingId(null);
    }
  };

  const showCoachSelectAthlete = isCoach && !activeAthleteId;
  const [creating, setCreating] = useState(false);
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newTitle, setNewTitle] = useState('Session');
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateSession = async () => {
    if (showCoachSelectAthlete) return;
    setCreating(true);
    setCreateError(null);
    try {
      await apiService.createSession({
        date: newDate,
        title: newTitle.trim() || 'Session',
        athleteId: activeAthleteId || undefined,
      });
      await reloadMicrocycles(activeAthleteId);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex relative h-full overflow-hidden bg-[#0A0A0A]">
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2 pb-8">
          <div className="h-7 px-1 flex items-center justify-between gap-2">
            <LiftFilter value={filter} onChange={onFilterChange} />
          </div>

          {!showCoachSelectAthlete && (
            <div className="border border-white/10 rounded p-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-[#636366]">Date</span>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-7 px-2 rounded bg-[#0A0A0A] border border-white/10 text-[11px] text-white"
                />
              </label>
              <label className="flex flex-col gap-0.5 flex-1 min-w-[140px]">
                <span className="text-[10px] text-[#636366]">Title</span>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="h-7 px-2 rounded bg-[#0A0A0A] border border-white/10 text-[11px] text-white"
                />
              </label>
              <button
                type="button"
                data-testid="sessions-add"
                onClick={handleCreateSession}
                disabled={creating || !newDate}
                className="h-7 px-3 rounded bg-[#007AFF]/20 text-[#007AFF] text-[11px] hover:bg-[#007AFF]/30 disabled:opacity-50"
              >
                {creating ? 'Adding…' : 'Add session'}
              </button>
              {createError && <p className="w-full text-[10px] text-red-400">{createError}</p>}
            </div>
          )}

          {showCoachSelectAthlete ? (
            <div
              data-testid="sessions-empty"
              className="border border-white/10 rounded p-6 text-center"
            >
              <p className="text-sm text-white mb-1">Select an athlete</p>
              <p className="text-xs text-[#AEAEB2]">Use the athlete switcher in the sidebar to load a plan.</p>
            </div>
          ) : allSessions.length === 0 ? (
            <div
              data-testid="sessions-empty"
              className="border border-white/10 rounded p-6 text-center"
            >
              <p className="text-sm text-white mb-1">No sessions yet</p>
              <p className="text-xs text-[#AEAEB2]">Add a dated session above. Block/Week labels can be set anytime.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groupedSessions.map(({ key, label, entries }) => (
                <section key={key} className="border border-white/10 rounded overflow-hidden">
                  <div className="h-8 px-3 border-b border-white/10 flex items-center justify-between bg-[#131313]">
                    <h4 className="text-xs text-white">{label}</h4>
                    <span className="text-[10px] font-mono text-[#AEAEB2]">{entries.length} session{entries.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="p-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {entries.map(({ workout, microId }) => {
                      const draft = labelDrafts[workout.id] || { block: '', week: '' };
                      const isWorkoutActive = activeWorkoutId === workout.id;
                      return (
                        <div
                          key={workout.id}
                          data-testid={`sessions-card-${workout.id}`}
                          className={`border rounded p-2 flex flex-col gap-2 ${
                            isWorkoutActive
                              ? 'bg-[#161616] border-[#007AFF]/50'
                              : 'bg-[#161616] border-white/10'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onViewSession(workout, microId)}
                            className="text-left flex flex-col gap-1 hover:opacity-90"
                          >
                            <div className="flex items-center justify-between gap-2 h-6">
                              <span className="text-xs text-white truncate">
                                {workout.date} · {workout.title}
                              </span>
                              <span className="text-[10px] font-mono text-[#AEAEB2] shrink-0">
                                {workout.status} · {workout.tonnage}kg
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {workout.exercises.map(ex => {
                                const { planned, logged } = setLine(ex);
                                return (
                                  <div
                                    key={ex.id}
                                    className="flex items-center gap-2 font-mono text-[11px] leading-tight min-h-5"
                                  >
                                    <span className={`${liftColor(ex.title)} w-6 shrink-0`}>
                                      {liftAbbrev(ex.title)}
                                    </span>
                                    <span className="text-white truncate flex-1 min-w-0" title={ex.title}>
                                      {ex.title}
                                    </span>
                                    <span className="text-[#AEAEB2] shrink-0">{planned}</span>
                                    <span className={`shrink-0 ${logged ? 'text-white' : 'text-[#636366]'}`}>
                                      {logged ?? '—'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </button>
                          <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-white/5">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-[#636366]">Block</span>
                              <input
                                type="text"
                                value={draft.block}
                                onChange={(e) => setLabelDrafts(prev => ({
                                  ...prev,
                                  [workout.id]: { ...draft, block: e.target.value },
                                }))}
                                className="h-7 w-20 px-2 rounded bg-[#0A0A0A] border border-white/10 text-[11px] text-white"
                              />
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-[#636366]">Week</span>
                              <input
                                type="text"
                                value={draft.week}
                                onChange={(e) => setLabelDrafts(prev => ({
                                  ...prev,
                                  [workout.id]: { ...draft, week: e.target.value },
                                }))}
                                className="h-7 w-20 px-2 rounded bg-[#0A0A0A] border border-white/10 text-[11px] text-white"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => saveLabels(workout.id)}
                              disabled={savingId === workout.id}
                              className="h-7 px-2 rounded bg-[#007AFF]/20 text-[#007AFF] text-[11px] hover:bg-[#007AFF]/30 disabled:opacity-50"
                            >
                              {savingId === workout.id ? 'Saving…' : 'Save labels'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

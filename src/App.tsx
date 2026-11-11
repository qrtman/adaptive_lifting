import { useState, useEffect, useMemo, useRef, type ComponentProps, type RefObject } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { CalendarView } from './components/CalendarView';
import { SessionsView } from './components/SessionsView';
import { AppShell } from './components/AppShell';
import { ExerciseCard } from './components/ExerciseCard';
import { AccessoryLedger } from './components/AccessoryLedger';
import { LoginView } from './components/LoginView';
import { TelegramLinkPanel } from './components/TelegramLinkPanel';
import { SheetsPublishPanel } from './components/SheetsPublishPanel';
import { InsightsView } from './components/InsightsView';
import { SecurityView } from './components/SecurityView';
import { RosterView } from './components/RosterView';
import { AddLiftBar } from './components/AddLiftBar';
import { EditSessionDialog } from './components/EditSessionDialog';
import { SessionHeader } from './components/SessionHeader';
import { WeekRail } from './components/WeekRail';
import { Lock } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useAccountAccess } from './contexts/AccessContext';
import { shouldDisableCoachAction } from './services/accessUi';
import { usePeriodization } from './contexts/PeriodizationContext';
import { apiService } from './services/api';
import { UI_KEYS, getUiPref, setUiPref, setRecentBlock } from './storage/uiPrefs';
import { parseLiftFilter, type LiftFilterState } from './services/liftFilter';
import { readThemePref, applyThemeToDocument, setThemePref, toggleTheme } from './theme/themePref';
import type { ThemePreference } from './theme/themePref';
import { isDashboardModeAvailable, parseAppLocation, writeAppLocation, type DashboardMode } from './navigation';
import { type CopyClipboard } from './features/plan/copyClipboard';
import { formatPlanLabel, isPlaceholderTitle, sessionHeadline } from './features/plan/sessionLabels';
import { buildWeekRail, sessionSetCount, type RailSession } from './features/plan/weekRail';
import { isWorkoutCompleted, splitWorkoutExercises, type LiftMetaPatch } from './types';
import { useSync } from './contexts/SyncContext';
import { useCollapsedLifts } from './features/plan/useCollapsedLifts';
import { sessionReadOnlyReason } from './features/plan/sessionReadOnly';

type SortableExerciseCardProps = ComponentProps<typeof ExerciseCard> & {
  value: string;
  reorderContainerRef: RefObject<HTMLDivElement | null>;
  canReorder?: boolean;
};

function SortableExerciseCard({ value, reorderContainerRef, canReorder = true, ...props }: SortableExerciseCardProps) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      as="div"
      value={value}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={reorderContainerRef}
      layout="position"
      layoutDependency={props.minimized}
      className="relative"
    >
      <ExerciseCard
        {...props}
        dragControls={canReorder ? dragControls : undefined}
      />
    </Reorder.Item>
  );
}

export default function App() {
  const { user, checking } = useAuth();
  const { canProgram } = useAccountAccess();
  const {
    microcycles,
    activeWorkoutId,
    setActiveWorkoutId,
    setActiveMicrocycleId,
    activeWorkout,
    updateExerciseSets,
    finishSession,
    reloadMicrocycles,
    planAthleteId,
    viewingOwnPlan,
    setActiveAthleteId,
  } = usePeriodization();
  // Coaching access gates other athletes' plans only; a coach's own training is always theirs to edit.
  const coachCanProgram = !shouldDisableCoachAction(String(user?.role || '').toUpperCase() === 'COACH' && !viewingOwnPlan, canProgram);

  const [initialLocation] = useState(() => parseAppLocation());

  const [currentView, setCurrentView] = useState<'dashboard' | 'session'>(() => {
    if (initialLocation.mode === 'roster') return 'dashboard';
    const saved = getUiPref(UI_KEYS.appView);
    return saved === 'session' ? 'session' : 'dashboard';
  });

  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() => initialLocation.mode);
  const [focusAthleteScope, setFocusAthleteScope] = useState(() => initialLocation.panel === 'athlete-scope');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = getUiPref(UI_KEYS.sidebarCollapsed);
    // First visit on a phone-width screen: start collapsed so content is usable.
    if (stored === null) return typeof window !== 'undefined' && window.innerWidth < 768;
    return stored === '1';
  });
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePref());

  const [filter, setFilter] = useState<LiftFilterState>(() => parseLiftFilter(getUiPref(UI_KEYS.liftFilter)));
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [copyClipboard, setCopyClipboard] = useState<CopyClipboard | null>(null);
  const [mainLiftOrder, setMainLiftOrder] = useState<string[]>([]);
  const reorderContainerRef = useRef<HTMLDivElement>(null);
  const sessionDayLabel = formatPlanLabel('Day', activeWorkout?.dayLabel);
  const sessionWeekLabel = formatPlanLabel('Week', activeWorkout?.weekLabel);
  const sessionBlockLabel = formatPlanLabel('Block', activeWorkout?.blockLabel);
  // An unnamed session's title already reads "Day 1 · Week 2"; don't repeat it below.
  const headlineShowsSlot = Boolean(activeWorkout && isPlaceholderTitle(activeWorkout.title) && (sessionDayLabel || sessionWeekLabel));
  const workoutExercises = activeWorkout ? splitWorkoutExercises(activeWorkout.exercises) : null;
  const { lockedWorkoutIds, isOnline } = useSync();
  const isCoachAccount = String(user?.role || '').toUpperCase() === 'COACH';
  // Week rail: the other days of this session's Block/Week (session sheet phase 1).
  const weekRail = useMemo(() => buildWeekRail(microcycles, activeWorkoutId), [microcycles, activeWorkoutId]);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (currentView !== 'session' || !user) return;
    let cancelled = false;
    apiService.fetchDayNotes(isCoachAccount ? planAthleteId : undefined)
      .then((notes) => {
        if (cancelled) return;
        setDayNotes(Object.fromEntries(notes.filter((n) => n.body?.trim()).map((n) => [n.date, n.body])));
      })
      .catch(() => { if (!cancelled) setDayNotes({}); });
    return () => { cancelled = true; };
  }, [currentView, user, isCoachAccount, planAthleteId]);
  const assignToWeek = async (session: RailSession) => {
    if (weekRail?.kind !== 'week') return;
    try {
      await apiService.updateSession(session.workout.id, { weekLabel: weekRail.weekLabel, blockLabel: weekRail.blockLabel });
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign the week');
    }
  };
  const readOnlyReason = sessionReadOnlyReason(activeWorkout, lockedWorkoutIds);
  const sessionFinished = activeWorkout ? isWorkoutCompleted(activeWorkout.status) : false;
  const sessionLocked = readOnlyReason !== null;

  useEffect(() => {
    const mainIds = workoutExercises?.main.map((exercise) => exercise.id) ?? [];
    setMainLiftOrder((current) => {
      const next = [
      ...current.filter((id) => mainIds.includes(id)),
      ...mainIds.filter((id) => !current.includes(id)),
      ];
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [activeWorkout?.id, activeWorkout?.exercises]);

  const orderedMainExercises = (workoutExercises?.main ?? []).slice().sort((a, b) => {
    const aIndex = mainLiftOrder.indexOf(a.id);
    const bIndex = mainLiftOrder.indexOf(b.id);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
  // Lift cards are open unless collapsed; collapse is remembered per lift on this device.
  const { isCollapsed, setCollapsed, setMany: setManyCollapsed } = useCollapsedLifts();
  const allLiftIds = activeWorkout ? activeWorkout.exercises.map((exercise) => exercise.id) : [];
  const anyLiftOpen = allLiftIds.some((liftId) => !isCollapsed(liftId));

  useEffect(() => {
    if (initialLocation.athleteId) setActiveAthleteId(initialLocation.athleteId);
  }, [initialLocation.athleteId, setActiveAthleteId]);

  useEffect(() => {
    if (initialLocation.athleteId) setActiveAthleteId(initialLocation.athleteId);
  }, [initialLocation.athleteId, setActiveAthleteId]);

  useEffect(() => {
    setUiPref(UI_KEYS.appView, currentView);
  }, [currentView]);

  useEffect(() => {
    setUiPref(UI_KEYS.dashboardMode, dashboardMode);
    writeAppLocation({
      mode: dashboardMode,
      athleteId: planAthleteId,
      panel: focusAthleteScope ? 'athlete-scope' : null,
    });
  }, [dashboardMode, planAthleteId, focusAthleteScope]);

  useEffect(() => {
    setUiPref(UI_KEYS.sidebarCollapsed, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    setUiPref(UI_KEYS.liftFilter, JSON.stringify(filter));
  }, [filter]);

  useEffect(() => {
    applyThemeToDocument(theme);
    setThemePref(theme);
  }, [theme]);

  useEffect(() => {
    if (focusAthleteScope && sidebarCollapsed) setSidebarCollapsed(false);
  }, [focusAthleteScope, sidebarCollapsed]);

  useEffect(() => {
    setCopyClipboard(null);
  }, [planAthleteId]);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseAppLocation();
      setDashboardMode(next.mode);
      setCurrentView('dashboard');
      if (next.athleteId) setActiveAthleteId(next.athleteId);
      if (next.panel === 'athlete-scope') setFocusAthleteScope(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setActiveAthleteId]);

  const handleNavigate = (mode: DashboardMode) => {
    if (!isDashboardModeAvailable(mode)) return;
    setDashboardMode(mode);
    setCurrentView('dashboard');
    if (mode !== 'calendar') setFocusAthleteScope(false);
  };

  const startCopy = (clip: CopyClipboard) => {
    const uniqueBlocks = [...new Set(Object.values(clip.sourceBlocks).filter(Boolean))];
    if (uniqueBlocks.length === 1) setRecentBlock(planAthleteId, uniqueBlocks[0]);
    else if (clip.targetBlockLabel) setRecentBlock(planAthleteId, clip.targetBlockLabel);
    setCopyClipboard(clip);
    setDashboardMode('calendar');
    setCurrentView('dashboard');
  };

  const clearCopy = () => setCopyClipboard(null);

  const handleViewSession = (workout: { id: string }, microId: string) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setCurrentView('session');
    
    setTimeout(() => {
      const el = document.getElementById('training-focus');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleDeleteSession = async (workout: { id: string; title?: string }) => {
    if (!window.confirm(`Delete ${sessionHeadline(workout)}?`)) return;
    try {
      await apiService.deleteSession(workout.id);
      await reloadMicrocycles(planAthleteId);
      if (activeWorkoutId === workout.id) {
        setActiveWorkoutId(null);
        setCurrentView('dashboard');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete session');
    }
  };

  const handleRemoveLift = async (exerciseId: string) => {
    if (!activeWorkout) return;
    try {
      await apiService.removeSessionExercise(activeWorkout.id, exerciseId);
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove lift');
      throw err;
    }
  };

  const handleUpdateLift = async (exerciseId: string, patch: LiftMetaPatch) => {
    if (!activeWorkout) return;
    try {
      await apiService.updateSessionExercise(activeWorkout.id, exerciseId, patch);
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update lift');
      throw err;
    }
  };

  const handleReorderLifts = async (orderedMainIds: string[]) => {
    if (!activeWorkout || !coachCanProgram) return;
    setMainLiftOrder(orderedMainIds);
    const mainIds = new Set(workoutExercises?.main.map((exercise) => exercise.id) ?? []);
    let nextMainIndex = 0;
    const fullOrder = activeWorkout.exercises.map((exercise) => {
      if (!mainIds.has(exercise.id)) return exercise.id;
      return orderedMainIds[nextMainIndex++];
    });
    try {
      await apiService.updateSessionExercise(activeWorkout.id, orderedMainIds[0], { order: fullOrder });
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      setMainLiftOrder(workoutExercises?.main.map((exercise) => exercise.id) ?? []);
      alert(err instanceof Error ? err.message : 'Failed to reorder lifts');
    }
  };

  if (!user && checking) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[var(--cal-canvas)]" role="status" aria-live="polite" data-testid="auth-checking">
        <span className="text-xs text-[var(--cal-muted)]">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <AppShell
      dashboardMode={dashboardMode}
      onNavigate={handleNavigate}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
      focusAthleteScope={focusAthleteScope}
      onAthleteScopeFocused={() => setFocusAthleteScope(false)}
      theme={theme}
      onToggleTheme={() => setTheme((current) => toggleTheme(current))}
    >
        <AnimatePresence mode="wait">
          {currentView === 'dashboard' ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex-1 flex overflow-hidden relative">
                {dashboardMode === 'calendar' ? (
                  <CalendarView 
                    onViewSession={handleViewSession}
                    onDeleteSession={handleDeleteSession}
                    filter={filter}
                    onFilterChange={setFilter}
                    copyClipboard={copyClipboard}
                    onStartCopy={startCopy}
                    onClearCopy={clearCopy}
                  />
                ) : dashboardMode === 'sessions' ? (
                  <SessionsView 
                    onViewSession={handleViewSession}
                    onDeleteSession={handleDeleteSession}
                    filter={filter}
                    onFilterChange={setFilter}
                    onStartCopy={startCopy}
                  />
                ) : dashboardMode === 'insights' ? (
                  <InsightsView />
                ) : dashboardMode === 'roster' ? (
                  <RosterView onNavigate={handleNavigate} />
                ) : dashboardMode === 'security' ? (
                  <SecurityView />
                ) : isDashboardModeAvailable('integrations') ? (
                  <div className="flex flex-col gap-4 p-4 w-full overflow-y-auto">
                    <TelegramLinkPanel />
                    <SheetsPublishPanel />
                  </div>
                ) : null}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="session"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex-1 overflow-y-auto bg-[var(--cal-canvas)]"
            >
              {activeWorkout ? (
                <div className="mx-auto flex w-full max-w-[1480px] gap-6 px-3 pb-8 sm:px-4">
                  {weekRail ? (
                    <WeekRail
                      model={weekRail}
                      activeId={activeWorkout.id}
                      notes={dayNotes}
                      onOpen={(session) => handleViewSession(session.workout, session.microId)}
                      canAssign={coachCanProgram && isOnline}
                      assignDisabledReason={!isOnline ? 'Connect to change labels.' : 'Active coaching access is required to edit athlete programming.'}
                      onAssign={(session) => { void assignToWeek(session); }}
                      onAssignWeek={() => setEditSessionOpen(true)}
                    />
                  ) : null}
                  <div className="mx-auto w-full min-w-0 max-w-[1200px] flex-1">
                  <SessionHeader
                    session={activeWorkout}
                    setCount={sessionSetCount(activeWorkout)}
                    dayNote={dayNotes[activeWorkout.date]}
                    backLabel={dashboardMode === 'sessions' ? 'Sessions' : 'Calendar'}
                    onBack={() => {
                      setEditSessionOpen(false);
                      setCurrentView('dashboard');
                    }}
                    onEdit={() => setEditSessionOpen(true)}
                    canEdit={coachCanProgram}
                    editDisabledReason="Active coaching access is required to edit athlete programming."
                    finished={sessionFinished}
                    locked={sessionLocked}
                    onComplete={async () => {
                      if (sessionLocked) return;
                      try {
                        await finishSession('COMPLETED');
                        setCurrentView('dashboard');
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Failed to complete session');
                      }
                    }}
                  />
                  {weekRail ? (
                    <WeekRail
                      variant="strip"
                      model={weekRail}
                      activeId={activeWorkout.id}
                      notes={dayNotes}
                      onOpen={(session) => handleViewSession(session.workout, session.microId)}
                      canAssign={false}
                      onAssign={() => undefined}
                      onAssignWeek={() => setEditSessionOpen(true)}
                    />
                  ) : null}

                  {readOnlyReason ? (
                    <p
                      data-testid="session-readonly"
                      role="status"
                      className="mb-3 flex items-center gap-2 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)] px-3 py-2 text-[13px] text-[var(--cal-body)]"
                    >
                      <Lock size={14} aria-hidden="true" className="shrink-0 text-[var(--cal-muted)]" />
                      Session locked by another writer — read-only until the lock is released
                    </p>
                  ) : null}

                  <div>
                    {activeWorkout.exercises.length === 0 && (
                      <div
                        data-testid="session-empty-lifts"
                        className="flex flex-col items-center justify-center gap-1 rounded-[var(--cal-radius-lg)] border border-dashed border-[var(--cal-hairline)] px-4 py-12 text-center"
                      >
                        <p className="text-base font-semibold text-[var(--cal-ink)]">No lifts yet</p>
                        <p className="text-sm text-[var(--cal-muted)]">Add squat, bench, deadlift or any accessory.</p>
                        {!sessionLocked && coachCanProgram ? (
                          <div className="mt-3">
                            <AddLiftBar sessionId={activeWorkout.id} variant="empty" onAdded={() => reloadMicrocycles(planAthleteId)} />
                          </div>
                        ) : null}
                      </div>
                    )}
                    {allLiftIds.length >= 2 ? (
                      <div className="mx-2 mb-1 flex justify-end">
                        <button
                          type="button"
                          data-testid="toggle-all-lifts"
                          onClick={() => setManyCollapsed(allLiftIds, anyLiftOpen)}
                          className="inline-flex h-7 items-center rounded-[var(--cal-radius-md)] px-2 text-[13px] text-[var(--cal-muted)] transition-colors hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
                        >
                          {anyLiftOpen ? 'Collapse all' : 'Expand all'}
                        </button>
                      </div>
                    ) : null}
                    <Reorder.Group
                      as="div"
                      axis="y"
                      ref={reorderContainerRef}
                      values={orderedMainExercises.map((exercise) => exercise.id)}
                      onReorder={(next) => { if (coachCanProgram && !sessionLocked) void handleReorderLifts(next); }}
                    >
                    {orderedMainExercises.map((ex) => {
                      return (
                      <SortableExerciseCard
                        key={ex.id}
                        value={ex.id}
                        reorderContainerRef={reorderContainerRef}
                        canReorder={coachCanProgram && !sessionLocked}
                        locked={sessionLocked}
                        id={ex.id}
                        title={ex.title}
                        variation={ex.variation}
                        tags={ex.tags}
                        tier={ex.tier}
                        liftCategory={ex.liftCategory}
                        movementPattern={ex.movementPattern}
                        liftNote={ex.liftNote}
                        initialSets={ex.sets}
                        minimized={isCollapsed(ex.id)}
                        onMinimizedChange={(value) => setCollapsed(ex.id, value)}
                        canEditPlan={coachCanProgram}
                        onUpdateSets={(updatedSets) => updateExerciseSets(ex.id, updatedSets)}
                        onUpdateMeta={coachCanProgram ? (patch) => handleUpdateLift(ex.id, patch) : undefined}
                        onRemove={coachCanProgram ? () => handleRemoveLift(ex.id) : undefined}
                      />
                    );
                    })}
                    </Reorder.Group>

                    <AccessoryLedger
                      exercises={workoutExercises?.accessories ?? []}
                      isCollapsed={isCollapsed}
                      onCollapsedChange={setCollapsed}
                      locked={sessionLocked}
                      onUpdateSets={updateExerciseSets}
                      canEditPlan={coachCanProgram}
                      onUpdateMeta={coachCanProgram ? handleUpdateLift : undefined}
                      onRemove={coachCanProgram ? handleRemoveLift : undefined}
                    />

                    {sessionLocked ? null : coachCanProgram ? (
                      activeWorkout.exercises.length === 0 ? null : (
                        <AddLiftBar sessionId={activeWorkout.id} onAdded={() => reloadMicrocycles(planAthleteId)} />
                      )
                    ) : (
                      <p className="px-2 py-3 text-xs text-[var(--cal-muted)]" role="note">Active coaching access is required to edit athlete programming.</p>
                    )}
                  </div>
                  {editSessionOpen && (
                    <EditSessionDialog
                      session={activeWorkout}
                      onClose={() => setEditSessionOpen(false)}
                      onSaved={async () => {
                        await reloadMicrocycles(planAthleteId);
                        setEditSessionOpen(false);
                      }}
                      onDeleted={async () => {
                        await reloadMicrocycles(planAthleteId);
                        setActiveWorkoutId(null);
                        setEditSessionOpen(false);
                        setCurrentView('dashboard');
                      }}
                    />
                  )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col justify-center items-center text-center py-20 px-4">
                    <p className="text-sm text-[var(--cal-ink)]">No session open</p>
                    <p className="text-xs text-[var(--cal-muted)] mt-2">Pick a day on the calendar or a session in the list.</p>
                    <button 
                      onClick={() => setCurrentView('dashboard')}
                      className="mt-6 h-8 px-3 bg-[var(--cal-primary)] text-[var(--cal-on-primary)] rounded-[var(--cal-radius-md)] text-sm"
                    >
                      Back
                    </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
    </AppShell>
  );
}

import { useState, useEffect, useRef, type ComponentProps, type RefObject } from 'react';
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
import { useAuth } from './contexts/AuthContext';
import { usePeriodization } from './contexts/PeriodizationContext';
import { apiService } from './services/api';
import { UI_KEYS, getUiPref, setUiPref, setRecentBlock } from './storage/uiPrefs';
import { parseLiftFilter, type LiftFilterState } from './services/liftFilter';
import { readThemePref, applyThemeToDocument, setThemePref, toggleTheme } from './theme/themePref';
import type { ThemePreference } from './theme/themePref';
import { parseAppLocation, writeAppLocation, type DashboardMode } from './navigation';
import { type CopyClipboard } from './features/plan/copyClipboard';
import { formatPlanLabel } from './features/plan/sessionLabels';
import { splitWorkoutExercises, type LiftMetaPatch } from './types';

type SortableExerciseCardProps = ComponentProps<typeof ExerciseCard> & {
  value: string;
  reorderContainerRef: RefObject<HTMLDivElement | null>;
};

function SortableExerciseCard({ value, reorderContainerRef, ...props }: SortableExerciseCardProps) {
  const dragControls = useDragControls();
  const [minimized, setMinimized] = useState(props.initialMinimized ?? true);

  return (
    <Reorder.Item
      as="div"
      value={value}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={reorderContainerRef}
      layout="position"
      layoutDependency={minimized}
      className="relative"
    >
      <ExerciseCard
        {...props}
        initialMinimized={minimized}
        onMinimizedChange={setMinimized}
        dragControls={dragControls}
      />
    </Reorder.Item>
  );
}

export default function App() {
  const { user } = useAuth();
  const {
    activeWorkoutId,
    setActiveWorkoutId,
    setActiveMicrocycleId,
    activeWorkout,
    updateExerciseSets,
    finishSession,
    reloadMicrocycles,
    planAthleteId,
    setActiveAthleteId,
  } = usePeriodization();

  const [initialLocation] = useState(() => parseAppLocation());

  const [currentView, setCurrentView] = useState<'dashboard' | 'session'>(() => {
    if (initialLocation.mode === 'roster') return 'dashboard';
    const saved = getUiPref(UI_KEYS.appView);
    return saved === 'session' ? 'session' : 'dashboard';
  });

  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() => initialLocation.mode);
  const [focusAthleteScope, setFocusAthleteScope] = useState(() => initialLocation.panel === 'athlete-scope');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getUiPref(UI_KEYS.sidebarCollapsed) === '1');
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePref());

  const [filter, setFilter] = useState<LiftFilterState>(() => parseLiftFilter(getUiPref(UI_KEYS.liftFilter)));
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [copyClipboard, setCopyClipboard] = useState<CopyClipboard | null>(null);
  const [mainLiftOrder, setMainLiftOrder] = useState<string[]>([]);
  const reorderContainerRef = useRef<HTMLDivElement>(null);
  const sessionDayLabel = formatPlanLabel('Day', activeWorkout?.dayLabel);
  const sessionWeekLabel = formatPlanLabel('Week', activeWorkout?.weekLabel);
  const sessionBlockLabel = formatPlanLabel('Block', activeWorkout?.blockLabel);
  const workoutExercises = activeWorkout ? splitWorkoutExercises(activeWorkout.exercises) : null;

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
    if (!window.confirm(`Delete ${workout.title || 'this session'}?`)) return;
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
    if (!activeWorkout) return;
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
                ) : (
                  <div className="flex flex-col gap-4 p-4 w-full overflow-y-auto">
                    <TelegramLinkPanel />
                    <SheetsPublishPanel />
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="session"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex-1 overflow-y-auto p-1 bg-[var(--cal-canvas)]"
            >
              {activeWorkout ? (
                <>
                  <div id="training-focus" className="min-h-8 flex flex-wrap items-start justify-between gap-2 px-1">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                        <button 
                          onClick={() => {
                            setEditSessionOpen(false);
                            setCurrentView('dashboard');
                          }}
                          className="text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] shrink-0 mt-1"
                        >
                          Back
                        </button>
                        <div className="min-w-0 flex-1">
                          <p data-testid="session-name" className="text-lg font-semibold tracking-tight text-[var(--cal-ink)] break-words">
                            {activeWorkout.title}
                          </p>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                            <p data-testid="session-labels" className="min-w-0 rounded-[var(--cal-radius-sm)] bg-[var(--cal-surface-2)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--cal-ink)]">
                              {[sessionDayLabel, sessionWeekLabel, sessionBlockLabel].filter(Boolean).join(' · ')}
                              {sessionDayLabel && !sessionWeekLabel && !sessionBlockLabel ? ' · ' : null}
                              {!sessionWeekLabel && !sessionBlockLabel ? 'No block/week' : null}
                            </p>
                            <button
                              type="button"
                              data-testid="session-edit"
                              onClick={() => setEditSessionOpen(true)}
                              className="h-6 px-1.5 text-[11px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <p data-testid="workout-tonnage" className="flex w-36 shrink-0 items-baseline justify-end gap-1 text-right text-[11px] font-semibold text-[var(--cal-ink)]">
                        <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted-soft)]">Tonnage</span>
                        <span className="tnum">{activeWorkout.tonnage.toLocaleString()} kg</span>
                      </p>
                      <button
                        type="button"
                        data-testid="session-complete"
                        onClick={async () => {
                          try {
                            await finishSession('COMPLETED');
                            setCurrentView('dashboard');
                          } catch (err) {
                            alert(err instanceof Error ? err.message : 'Failed to complete session');
                          }
                        }}
                        className="h-7 px-2 text-[11px] bg-[var(--cal-primary)] text-[var(--cal-on-primary)] rounded-[var(--cal-radius-md)]"
                      >
                        Complete
                      </button>
                    </div>
                  </div>

                  <div>
                    {activeWorkout.exercises.length === 0 && (
                      <p className="px-2 py-6 text-xs text-[var(--cal-muted)]" data-testid="session-empty-lifts">
                        No lifts yet. Add squat, bench, or deadlift.
                      </p>
                    )}
                    <Reorder.Group
                      as="div"
                      axis="y"
                      ref={reorderContainerRef}
                      values={orderedMainExercises.map((exercise) => exercise.id)}
                      onReorder={(next) => void handleReorderLifts(next)}
                    >
                    {orderedMainExercises.map((ex) => {
                      return (
                      <SortableExerciseCard
                        key={ex.id}
                        value={ex.id}
                        reorderContainerRef={reorderContainerRef}
                        id={ex.id}
                        title={ex.title}
                        variation={ex.variation}
                        tags={ex.tags}
                        tier={ex.tier}
                        liftCategory={ex.liftCategory}
                        movementPattern={ex.movementPattern}
                        liftNote={ex.liftNote}
                        initialSets={ex.sets}
                        onUpdateSets={(updatedSets) => updateExerciseSets(ex.id, updatedSets)}
                        onUpdateMeta={(patch) => handleUpdateLift(ex.id, patch)}
                        onRemove={() => handleRemoveLift(ex.id)}
                      />
                    );
                    })}
                    </Reorder.Group>

                    <AccessoryLedger
                      exercises={workoutExercises?.accessories ?? []}
                      onUpdateSets={updateExerciseSets}
                      onUpdateMeta={handleUpdateLift}
                      onRemove={handleRemoveLift}
                    />

                    <AddLiftBar
                      sessionId={activeWorkout.id}
                      onAdded={() => reloadMicrocycles(planAthleteId)}
                    />
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
                        setEditSessionOpen(false);
                        setCurrentView('dashboard');
                      }}
                    />
                  )}
                </>
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

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarView } from './components/CalendarView';
import { SessionsView } from './components/SessionsView';
import { AppShell } from './components/AppShell';
import { ExerciseCard } from './components/ExerciseCard';
import { LoginView } from './components/LoginView';
import { TelegramLinkPanel } from './components/TelegramLinkPanel';
import { SheetsPublishPanel } from './components/SheetsPublishPanel';
import { InsightsView } from './components/InsightsView';
import { SecurityView } from './components/SecurityView';
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

export default function App() {
  const { user, roleMode, setRoleMode } = useAuth();
  const {
    activeWorkoutId,
    setActiveWorkoutId,
    setActiveMicrocycleId,
    activeWorkout,
    updateExerciseSets,
    finishSession,
    resetPlan,
    reloadMicrocycles,
    planAthleteId,
    setActiveAthleteId,
  } = usePeriodization();

  const [initialLocation] = useState(() => parseAppLocation());

  const [currentView, setCurrentView] = useState<'dashboard' | 'session'>(() => {
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
  const sessionDayLabel = formatPlanLabel('Day', activeWorkout?.dayLabel);
  const sessionWeekLabel = formatPlanLabel('Week', activeWorkout?.weekLabel);
  const sessionBlockLabel = formatPlanLabel('Block', activeWorkout?.blockLabel);

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

  const handleUpdateLift = async (exerciseId: string, patch: { variation?: string; tier?: 'Comp' | 'Variation' | 'Accessory'; movementPattern?: string }) => {
    if (!activeWorkout) return;
    try {
      await apiService.updateSessionExercise(activeWorkout.id, exerciseId, patch);
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update lift');
    }
  };

  const handleMoveLift = async (exerciseId: string, move: 'up' | 'down') => {
    if (!activeWorkout) return;
    try {
      await apiService.updateSessionExercise(activeWorkout.id, exerciseId, { move });
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to move lift');
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
      onResetPlan={async () => {
        if (window.confirm('Reset plan? This clears all sessions and logged sets.')) {
          await resetPlan();
          window.location.reload();
        }
      }}
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
                    filter={filter}
                    onFilterChange={setFilter}
                    copyClipboard={copyClipboard}
                    onStartCopy={startCopy}
                    onClearCopy={clearCopy}
                  />
                ) : dashboardMode === 'sessions' ? (
                  <SessionsView 
                    onViewSession={handleViewSession}
                    filter={filter}
                    onFilterChange={setFilter}
                    onStartCopy={startCopy}
                  />
                ) : dashboardMode === 'insights' ? (
                  <InsightsView />
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
                  <div id="training-focus" className="min-h-8 flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <button 
                          onClick={() => {
                            setEditSessionOpen(false);
                            setCurrentView('dashboard');
                          }}
                          className="text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] shrink-0"
                        >
                          Back
                        </button>
                        <p data-testid="session-name" className="text-base font-semibold tracking-tight text-[var(--cal-ink)] truncate max-w-[220px]">
                          {activeWorkout.title}
                        </p>
                        <p data-testid="session-labels" className="flex items-baseline gap-2 min-w-0">
                          {sessionDayLabel ? (
                            <span className="text-sm font-semibold text-[var(--cal-ink)] truncate">
                              {sessionDayLabel}
                            </span>
                          ) : null}
                          {sessionWeekLabel ? (
                            <span className="text-sm font-semibold text-[var(--cal-ink)] truncate">
                              {sessionWeekLabel}
                            </span>
                          ) : null}
                          {sessionBlockLabel ? (
                            <span className="text-[11px] text-[var(--cal-body)] truncate">
                              {sessionBlockLabel}
                            </span>
                          ) : null}
                          {!sessionWeekLabel && !sessionBlockLabel ? (
                            <span className="text-[11px] text-[var(--cal-muted)]">No block/week</span>
                          ) : null}
                        </p>
                        <p data-testid="workout-tonnage" className="text-[11px] text-[var(--cal-muted)] tnum shrink-0">
                          {activeWorkout.tonnage}kg
                        </p>
                        <button
                          type="button"
                          data-testid="session-edit"
                          onClick={() => setEditSessionOpen(true)}
                          className="h-7 px-2 text-[11px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                        >
                          Edit
                        </button>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setRoleMode('coach')}
                        className={`h-7 px-2 text-[11px] ${
                          roleMode === 'coach' ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted)]'
                        }`}
                      >
                        Coach
                      </button>
                      <button
                        onClick={() => setRoleMode('athlete')}
                        className={`h-7 px-2 text-[11px] ${
                          roleMode === 'athlete' ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted)]'
                        }`}
                      >
                        Athlete
                      </button>
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
                    {activeWorkout.exercises.map((ex, index) => (
                      <ExerciseCard 
                        key={ex.id}
                        id={ex.id}
                        title={ex.title}
                        variation={ex.variation}
                        tags={ex.tags}
                        tier={ex.tier}
                        liftCategory={ex.liftCategory}
                        movementPattern={ex.movementPattern}
                        initialSets={ex.sets}
                        onUpdateSets={(updatedSets) => updateExerciseSets(ex.id, updatedSets)}
                        onUpdateMeta={(patch) => handleUpdateLift(ex.id, patch)}
                        onRemove={() => handleRemoveLift(ex.id)}
                        onMoveUp={index > 0 ? () => handleMoveLift(ex.id, 'up') : undefined}
                        onMoveDown={index < activeWorkout.exercises.length - 1 ? () => handleMoveLift(ex.id, 'down') : undefined}
                        roleMode={roleMode}
                      />
                    ))}

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

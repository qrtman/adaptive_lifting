import { useState, useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { LoginView } from './components/LoginView';
import { TelegramLinkPanel } from './components/TelegramLinkPanel';
import { SheetsPublishPanel } from './components/SheetsPublishPanel';
import { InsightsView } from './components/InsightsView';
import { SecurityView } from './components/SecurityView';
import { useAuth } from './contexts/AuthContext';
import { usePeriodization } from './contexts/PeriodizationContext';
import { UI_KEYS, getUiPref, setUiPref } from './storage/uiPrefs';
import { parseAppLocation, writeAppLocation, type DashboardMode } from './navigation';
import { CalendarWorkspace } from './features/calendar/CalendarWorkspace';
import { SessionsListMode } from './features/sessions/SessionsListMode';
import { BP_WEEK_STRIP } from './surface/breakpoints';
import type { WorkoutData } from './types';

export default function App() {
  const { user } = useAuth();
  const { planAthleteId, setActiveAthleteId, setActiveWorkoutId, setActiveMicrocycleId, resetPlan } = usePeriodization();

  const [initialLocation] = useState(() => parseAppLocation());
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() => initialLocation.mode);
  const [sessionId, setSessionId] = useState<string | null>(() => initialLocation.sessionId);
  const [gridFocus, setGridFocus] = useState(() => initialLocation.grid);
  const [focusAthleteScope, setFocusAthleteScope] = useState(() => initialLocation.panel === 'athlete-scope');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getUiPref(UI_KEYS.sidebarCollapsed) === '1');
  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < BP_WEEK_STRIP : false
  );
  const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);

  useEffect(() => {
    if (initialLocation.athleteId) setActiveAthleteId(initialLocation.athleteId);
    if (initialLocation.sessionId) setActiveWorkoutId(initialLocation.sessionId);
  }, [initialLocation.athleteId, initialLocation.sessionId, setActiveAthleteId, setActiveWorkoutId]);

  useEffect(() => {
    setUiPref(UI_KEYS.dashboardMode, dashboardMode);
    writeAppLocation({
      mode: dashboardMode,
      athleteId: planAthleteId,
      panel: focusAthleteScope ? 'athlete-scope' : null,
      sessionId,
      grid: gridFocus,
    });
  }, [dashboardMode, planAthleteId, focusAthleteScope, sessionId, gridFocus]);

  useEffect(() => {
    setUiPref(UI_KEYS.sidebarCollapsed, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onResize = () => setNarrowViewport(window.innerWidth < BP_WEEK_STRIP);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (focusAthleteScope && sidebarCollapsed) setSidebarCollapsed(false);
  }, [focusAthleteScope, sidebarCollapsed]);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseAppLocation();
      setDashboardMode(next.mode);
      setSessionId(next.sessionId);
      setGridFocus(next.grid);
      if (next.athleteId) setActiveAthleteId(next.athleteId);
      if (next.sessionId) setActiveWorkoutId(next.sessionId);
      if (next.panel === 'athlete-scope') setFocusAthleteScope(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setActiveAthleteId, setActiveWorkoutId]);

  const handleNavigate = (mode: DashboardMode) => {
    setDashboardMode(mode);
    if (mode !== 'calendar' && mode !== 'sessions') {
      setSessionId(null);
      setGridFocus(false);
    }
    if (mode !== 'calendar') setFocusAthleteScope(false);
  };

  const openSession = (workout: WorkoutData, microId: string, grid?: boolean) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setSessionId(workout.id);
    setGridFocus(Boolean(grid));
  };

  const closeSession = () => {
    setSessionId(null);
    setGridFocus(false);
  };

  if (!user) {
    return <LoginView />;
  }

  return (
    <AppShell
      dashboardMode={dashboardMode}
      onNavigate={handleNavigate}
      sidebarCollapsed={narrowViewport ? !mobileSidebarExpanded : sidebarCollapsed}
      onToggleSidebar={() => {
        if (narrowViewport) setMobileSidebarExpanded((value) => !value);
        else setSidebarCollapsed((value) => !value);
      }}
      focusAthleteScope={focusAthleteScope}
      onAthleteScopeFocused={() => setFocusAthleteScope(false)}
      onResetPlan={async () => {
        if (window.confirm('Reset plan? This clears all sessions and logged sets.')) {
          await resetPlan();
          window.location.reload();
        }
      }}
    >
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden relative">
          {dashboardMode === 'calendar' ? (
            <CalendarWorkspace
              sessionId={sessionId}
              gridFocus={gridFocus}
              onOpenSession={openSession}
              onCloseSession={closeSession}
            />
          ) : dashboardMode === 'sessions' ? (
            <SessionsListMode
              sessionId={sessionId}
              gridFocus={gridFocus}
              onOpenSession={openSession}
              onCloseSession={closeSession}
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
      </div>
    </AppShell>
  );
}

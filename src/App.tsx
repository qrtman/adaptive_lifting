import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarView } from './components/CalendarView';
import { SessionsView } from './components/SessionsView';
import { AppShell, type DashboardMode } from './components/AppShell';
import { LoginView } from './components/LoginView';
import { TelegramLinkPanel } from './components/TelegramLinkPanel';
import { SheetsPublishPanel } from './components/SheetsPublishPanel';
import { InsightsView } from './components/InsightsView';
import { SecurityView } from './components/SecurityView';
import { CoachDashboardView } from './components/CoachDashboardView';
import { useAuth } from './contexts/AuthContext';
import { usePeriodization } from './contexts/PeriodizationContext';
import { UI_KEYS, getUiPref, setUiPref } from './storage/uiPrefs';

export default function App() {
  const { user } = useAuth();
  const {
    setActiveWorkoutId,
    setActiveMicrocycleId,
    resetPlan,
  } = usePeriodization();

  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() => {
    if (getUiPref(UI_KEYS.appView) === 'session') {
      const micro = getUiPref(UI_KEYS.activeMicrocycleId);
      if (micro) setUiPref(UI_KEYS.sessionsExpandedMicro, micro);
      setUiPref(UI_KEYS.appView, 'dashboard');
      return 'sessions';
    }
    return (getUiPref(UI_KEYS.dashboardMode) as DashboardMode) || 'sessions';
  });

  const [filter, setFilter] = useState<'All' | 'Squat' | 'Bench' | 'Deadlift'>('All');

  useEffect(() => {
    setUiPref(UI_KEYS.dashboardMode, dashboardMode);
  }, [dashboardMode]);

  const handleViewSession = (workout: { id: string }, microId: string) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setUiPref(UI_KEYS.sessionsExpandedMicro, microId);
    setDashboardMode('sessions');
  };

  if (!user) {
    return <LoginView />;
  }

  return (
    <AppShell
      dashboardMode={dashboardMode}
      onNavigate={(mode) => {
        setDashboardMode(mode);
      }}
      onResetPlan={async () => {
        if (window.confirm('Reset plan? This clears logged sets and restores the seed microcycles.')) {
          await resetPlan();
          window.location.reload();
        }
      }}
    >
        <AnimatePresence mode="wait">
            <motion.div
              key={dashboardMode}
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
                  />
                ) : dashboardMode === 'sessions' ? (
                  <SessionsView 
                    filter={filter}
                    onFilterChange={setFilter}
                  />
                ) : dashboardMode === 'insights' ? (
                  <InsightsView />
                ) : dashboardMode === 'security' ? (
                  <SecurityView />
                ) : dashboardMode === 'roster' ? (
                  <CoachDashboardView />
                ) : (
                  <div className="flex flex-col gap-4 p-4 w-full overflow-y-auto">
                    <TelegramLinkPanel />
                    <SheetsPublishPanel />
                  </div>
                )}
              </div>
            </motion.div>
        </AnimatePresence>
    </AppShell>
  );
}

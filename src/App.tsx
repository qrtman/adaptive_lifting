import { useState, useEffect } from 'react';
import { 
  Activity, 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarView } from './components/CalendarView';
import { SessionsView } from './components/SessionsView';
import { AppShell, type DashboardMode } from './components/AppShell';
import { ExerciseCard } from './components/ExerciseCard';
import { AccessoryLedger } from './components/AccessoryLedger';
import TelegramSessionTerminal from './components/mobile/TelegramSessionTerminal';
import { LoginView } from './components/LoginView';
import { TelegramLinkPanel } from './components/TelegramLinkPanel';
import { SheetsPublishPanel } from './components/SheetsPublishPanel';
import { InsightsView } from './components/InsightsView';
import { SecurityView } from './components/SecurityView';
import { CoachDashboardView } from './components/CoachDashboardView';
import { splitWorkoutExercises } from './types';
import { useAuth } from './contexts/AuthContext';
import { usePeriodization } from './contexts/PeriodizationContext';
import { UI_KEYS, getUiPref, setUiPref } from './storage/uiPrefs';

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
  } = usePeriodization();

  const [currentView, setCurrentView] = useState<'dashboard' | 'session'>(() => {
    const saved = getUiPref(UI_KEYS.appView);
    return saved === 'session' ? 'session' : 'dashboard';
  });

  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() => {
    return (getUiPref(UI_KEYS.dashboardMode) as DashboardMode) || 'sessions';
  });

  const [filter, setFilter] = useState<'All' | 'Squat' | 'Bench' | 'Deadlift'>('All');

  useEffect(() => {
    setUiPref(UI_KEYS.appView, currentView);
  }, [currentView]);

  useEffect(() => {
    setUiPref(UI_KEYS.dashboardMode, dashboardMode);
  }, [dashboardMode]);

  const handleViewSession = (workout: { id: string }, microId: string) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setCurrentView('session');
    
    setTimeout(() => {
      const el = document.getElementById('training-focus');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  if (!user) {
    return <LoginView />;
  }

  return (
    <AppShell
      dashboardMode={dashboardMode}
      onNavigate={(mode) => {
        setDashboardMode(mode);
        setCurrentView('dashboard');
      }}
      onResetPlan={async () => {
        if (window.confirm('Reset plan? This clears logged sets and restores the seed microcycles.')) {
          await resetPlan();
          window.location.reload();
        }
      }}
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
                  />
                ) : dashboardMode === 'sessions' ? (
                  <SessionsView 
                    onViewSession={handleViewSession}
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
          ) : (
            <motion.div
              key="session"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex-1 overflow-y-auto p-1 bg-[#0A0A0A]"
            >
              {activeWorkout ? (
                <>
                  <div id="training-focus" className="h-7 flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <button 
                          onClick={() => setCurrentView('dashboard')}
                          className="text-xs text-[#AEAEB2] hover:text-white shrink-0"
                        >
                          Back
                        </button>
                        <h2 className="text-sm text-white truncate">{activeWorkout.title}</h2>
                        <p data-testid="workout-tonnage" className="text-[11px] text-[#AEAEB2] font-mono shrink-0">
                          {activeWorkout.tonnage}kg
                        </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setRoleMode('coach')}
                        className={`h-7 px-2 text-[11px] ${
                          roleMode === 'coach' ? 'text-white' : 'text-[#AEAEB2]'
                        }`}
                      >
                        Coach
                      </button>
                      <button
                        onClick={() => setRoleMode('athlete')}
                        className={`h-7 px-2 text-[11px] ${
                          roleMode === 'athlete' ? 'text-white' : 'text-[#AEAEB2]'
                        }`}
                      >
                        Athlete
                      </button>
                      <button
                        onClick={async () => {
                          await finishSession('COMPLETED');
                          setCurrentView('dashboard');
                        }}
                        className="h-7 px-2 text-[11px] bg-[#34C759] text-black rounded"
                      >
                        Complete
                      </button>
                    </div>
                  </div>

                  {roleMode === 'athlete' ? (
                    <div className="flex flex-col items-center justify-center py-6 w-full bg-black/20 rounded-2xl border border-white/5 p-4 sm:p-8">
                      <p className="text-xs font-mono text-zinc-500 mb-4">
                        Telegram Mini App
                      </p>
                      <div className="w-[390px] h-[844px] bg-black rounded-[48px] border-[12px] border-zinc-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden relative ring-1 ring-white/10 flex flex-col">
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-6 bg-zinc-800 rounded-full z-50 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-black ml-auto mr-4" />
                        </div>
                        <div className="flex-1 overflow-hidden pt-6">
                          <TelegramSessionTerminal />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {splitWorkoutExercises(activeWorkout.exercises).main.map(ex => (
                        <ExerciseCard 
                          key={ex.id}
                          id={ex.id}
                          title={ex.title}
                          variation={ex.variation}
                          tags={ex.tags}
                          tier={ex.tier}
                          initialSets={ex.sets}
                          onUpdateSets={(updatedSets) => updateExerciseSets(ex.id, updatedSets)}
                          roleMode={roleMode}
                        />
                      ))}

                      <AccessoryLedger 
                        exercises={splitWorkoutExercises(activeWorkout.exercises).accessories}
                        onUpdateSets={updateExerciseSets}
                        roleMode={roleMode}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full flex flex-col justify-center items-center text-center py-20">
                  <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500 mb-4">
                    <Activity size={24} />
                  </div>
                  <h3 className="text-xl font-bold text-white">No active logging session</h3>
                    <p className="text-xs text-gray-500 mt-2">Select a session from the calendar or sessions list.</p>
                    <button 
                      onClick={() => setCurrentView('dashboard')}
                      className="mt-6 px-4 min-h-12 bg-[#007AFF] text-white rounded-[8px] text-sm"
                    >
                      Back to calendar
                    </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
    </AppShell>
  );
}

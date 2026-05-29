import { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  Clock, 
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarView } from './components/CalendarView';
import { SessionsView } from './components/SessionsView';
import { AppShell } from './components/AppShell';
import { ExerciseCard } from './components/ExerciseCard';
import { AccessoryLedger } from './components/AccessoryLedger';
import TelegramSessionTerminal from './components/mobile/TelegramSessionTerminal';
import { LoginView } from './components/LoginView';
import { TelegramLinkPanel } from './components/TelegramLinkPanel';
import { SheetsPublishPanel } from './components/SheetsPublishPanel';
import { InsightsView } from './components/InsightsView';
import { SecurityView } from './components/SecurityView';
import { apiService } from './services/api';
import { saveSnapshot, getSnapshot, evictOldSyncedData } from './services/db';
import { 
  INITIAL_MICROCYCLES, 
  INITIAL_MESOCYCLE, 
  WorkoutData, 
  MicrocycleData 
} from './types';

// ── Startup Guard ──────────────────────────────────────────────────────────────
// Clear any corrupted localStorage keys before React state initializes.
// This prevents blank-screen crashes caused by malformed JSON.
try {
  const raw = localStorage.getItem('obsidian_microcycles');
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed[0]?.workouts) throw new Error('bad shape');
  }
} catch {
  console.warn('[Obsidian] Corrupted localStorage detected — resetting to defaults.');
  localStorage.removeItem('obsidian_microcycles');
  localStorage.removeItem('obsidian_active_workout_id');
  localStorage.removeItem('obsidian_active_micro_id');
  localStorage.removeItem('obsidian_dashboard_mode');
  localStorage.removeItem('performance_app_view');
}
// ──────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'session'>(() => {
    const saved = localStorage.getItem('performance_app_view');
    return saved === 'session' ? 'session' : 'dashboard';
  });

  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const role = localStorage.getItem('obsidian_role_mode');
    if (role) {
      setUser({ role: role.toUpperCase() });
    }
  }, []);

  useEffect(() => {
    const handleSessionRevoked = () => {
      alert("Your session has been terminated or revoked remotely. Please sign in again.");
      localStorage.removeItem('obsidian_role_mode');
      localStorage.removeItem('iron_box_email');
      setUser(null);
      window.location.reload();
    };
    window.addEventListener('auth-session-revoked', handleSessionRevoked);
    return () => window.removeEventListener('auth-session-revoked', handleSessionRevoked);
  }, []);

  const [roleMode, setRoleMode] = useState<'coach' | 'athlete'>(() => {
    return (localStorage.getItem('obsidian_role_mode') as 'coach' | 'athlete') || 'coach';
  });

  useEffect(() => {
    localStorage.setItem('obsidian_role_mode', roleMode);
  }, [roleMode]);

  const [dashboardMode, setDashboardMode] = useState<'calendar' | 'sessions' | 'integrations' | 'insights'>(() => {
    return (localStorage.getItem('obsidian_dashboard_mode') as 'calendar' | 'sessions' | 'integrations' | 'insights') || 'sessions';
  });

  const [filter, setFilter] = useState<'All' | 'Squat' | 'Bench' | 'Deadlift'>('All');

  // Master Periodization State (Default to INITIAL_MICROCYCLES first, then hydrate asynchronously from IndexedDB snapshots)
  const [microcycles, setMicrocycles] = useState<MicrocycleData[]>(INITIAL_MICROCYCLES);

  // Hydrate from IndexedDB snapshots and evict old synced mutations on mount
  useEffect(() => {
    const hydrateAndEvict = async () => {
      // 1. Run 28-day data eviction engine
      try {
        await evictOldSyncedData();
      } catch (err) {
        console.warn("Failed to evict old synced mutations on launch:", err);
      }

      // 2. Hydrate from IndexedDB snapshots
      try {
        const cached = await getSnapshot('microcycles');
        if (cached && Array.isArray(cached) && cached.length > 0 && cached[0].workouts) {
          setMicrocycles(cached);
        }
      } catch (err) {
        console.error("Failed to hydrate workout data from IndexedDB:", err);
      }

      // 3. Query backend for canonical mesocycle and refresh snapshots
      try {
        const meso = await apiService.getMesocycle();
        if (meso && meso.microcycles) {
          setMicrocycles(meso.microcycles);
          await saveSnapshot('microcycles', meso.microcycles);
        }
      } catch (err) {
        console.warn("Failed to refresh mesocycle from backend (offline fallback active):", err);
      }
    };
    hydrateAndEvict();
  }, []);

  // Track active logging session
  const [activeWorkoutId, setActiveWorkoutId] = useState<string | null>(() => {
    return localStorage.getItem('obsidian_active_workout_id') || 'w-3-1';
  });
  const [activeMicrocycleId, setActiveMicrocycleId] = useState<string | null>(() => {
    return localStorage.getItem('obsidian_active_micro_id') || 'micro-3';
  });

  // Save states
  useEffect(() => {
    localStorage.setItem('performance_app_view', currentView);
  }, [currentView]);

  useEffect(() => {
    localStorage.setItem('obsidian_dashboard_mode', dashboardMode);
  }, [dashboardMode]);

  useEffect(() => {
    saveSnapshot('microcycles', microcycles)
      .catch(err => console.error("Failed to write IndexedDB microcycles snapshot:", err));
  }, [microcycles]);

  useEffect(() => {
    if (activeWorkoutId) localStorage.setItem('obsidian_active_workout_id', activeWorkoutId);
  }, [activeWorkoutId]);

  useEffect(() => {
    if (activeMicrocycleId) localStorage.setItem('obsidian_active_micro_id', activeMicrocycleId);
  }, [activeMicrocycleId]);

  // Find active workout data
  const activeMicro = microcycles.find(m => m.id === activeMicrocycleId);
  const activeWorkout = activeMicro?.workouts.find(w => w.id === activeWorkoutId);

  // Find current mesocycle info
  const activeMeso = INITIAL_MESOCYCLE[0];

  // Navigate to detailed session logger
  const handleViewSession = (workout: WorkoutData, microId: string) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setCurrentView('session');
    
    // Smooth scroll page focus to training focus
    setTimeout(() => {
      const el = document.getElementById('training-focus');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleUpdateSets = (exerciseId: string, updatedSets: any[]) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;
          
          const updatedExercises = w.exercises.map(ex => {
            if (ex.id !== exerciseId) return ex;
            
            // Recalculate training highlights
            const topSet = updatedSets.find(s => s.isTop) || updatedSets[0];
            const topLabel = topSet ? `${topSet.actual || topSet.plannedWeight || '---'}kg x ${topSet.reps || topSet.plannedReps || '—'}` : '---';
            const totalVol = updatedSets.reduce((acc, s) => {
              const wt = parseFloat(s.actual || s.suggestedWeight || "0");
              const rp = parseInt(s.reps || "0");
              return acc + (wt * rp);
            }, 0);
            
            return {
              ...ex,
              sets: updatedSets,
              top: topLabel,
              vol: `${totalVol.toLocaleString()}kg`
            };
          });

          // Recalculate total workout volume
          const primaryTonnage = updatedExercises.reduce((acc, ex) => {
            return acc + ex.sets.reduce((sum, s) => {
              const wt = parseFloat(s.actual || s.suggestedWeight || "0");
              const rp = parseInt(s.reps || "0");
              return sum + (wt * rp);
            }, 0);
          }, 0);

          return {
            ...w,
            exercises: updatedExercises,
            tonnage: primaryTonnage
          };
        })
      };
    }));
  };

  const handleUpdateAccessories = (updatedAccessories: any[]) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;
          return {
            ...w,
            accessories: updatedAccessories
          };
        })
      };
    }));
  };

  const handleFinishSession = async (status: 'Completed' | 'Planned' | 'Testing') => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    let updatedWorkoutData: WorkoutData | null = null;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;
          const newWorkout = {
            ...w,
            status,
            color: status === 'Completed' ? 'mac-green' : 'mac-blue'
          };
          updatedWorkoutData = newWorkout;
          return newWorkout;
        })
      };
    }));

    setCurrentView('dashboard');
    
    // Sync to backend
    if (updatedWorkoutData) {
      try {
        await apiService.saveLog(updatedWorkoutData);
      } catch (err) {
        console.error("Failed to save workout log to backend", err);
      }
    }
  };

  if (!user) {
    return <LoginView onLoginSuccess={(u) => setUser(u)} />;
  }

  return (
    <AppShell>
        <AnimatePresence mode="wait">
          {currentView === 'dashboard' ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.01 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Dashboard Controller Rail */}
              <div className="px-10 pt-8 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 border-b border-white/5 pb-6">
                <div>
                  <h2 className="text-3xl font-black text-white tracking-tight font-sans">Periodized Progression Plane</h2>
                  <p className="text-[15px] font-black uppercase tracking-[0.25em] text-amber-400 mt-2 font-sans">
                    REVENUE AND LOAD RECOVERY DUAL SWITCHBOARD
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  {/* Movement filters */}
                  <div className="flex border border-white/10 bg-black/40 rounded-xl p-1 font-sans">
                    {(['All', 'Squat', 'Bench', 'Deadlift'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setFilter(m)}
                        className={`px-4 py-2.5 text-[15px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                          filter === m 
                            ? 'bg-white/10 text-white font-sans' 
                            : 'text-gray-300 hover:text-white font-sans'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* Primary Workspace View Switch */}
                  <div className="flex border border-white/10 bg-[#161616] rounded-xl p-1 font-sans">
                    <button
                      onClick={() => setDashboardMode('sessions')}
                      className={`px-6 py-3 text-[15px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                        dashboardMode === 'sessions' 
                          ? 'bg-mac-blue text-white shadow-lg font-sans' 
                          : 'text-gray-300 hover:text-white font-sans'
                      }`}
                    >
                      Sessions Feed
                    </button>
                    <button
                      onClick={() => setDashboardMode('calendar')}
                      className={`px-5 py-2.5 text-[15px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                        dashboardMode === 'calendar' 
                          ? 'bg-white/10 text-white shadow-sm' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Calendar Grid
                    </button>
                    <button
                      onClick={() => setDashboardMode('integrations')}
                      className={`px-5 py-2.5 text-[15px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                        dashboardMode === 'integrations' 
                          ? 'bg-white/10 text-white shadow-sm' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Integrations
                    </button>
                    <button
                      onClick={() => setDashboardMode('insights')}
                      className={`px-5 py-2.5 text-[15px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                        dashboardMode === 'insights' 
                          ? 'bg-mac-blue text-white shadow-sm' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Insights
                    </button>
                    <button
                      onClick={() => setDashboardMode('security')}
                      className={`px-5 py-2.5 text-[15px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                        dashboardMode === 'security' 
                          ? 'bg-white/10 text-white shadow-sm' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Security & Audit
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      if (window.confirm("⚠️ Reset Database?\nThis will clear all logged sets and restore the initial microcycle plans. This action cannot be undone.")) {
                        localStorage.removeItem('obsidian_microcycles');
                        localStorage.removeItem('obsidian_active_workout_id');
                        localStorage.removeItem('obsidian_active_micro_id');
                        window.location.reload();
                      }
                    }}
                    className="px-5 py-3 border border-red-500/20 hover:border-red-500/40 hover:bg-red-500/5 text-red-500 hover:text-red-400 text-[13px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer font-sans"
                  >
                    Reset Plan
                  </button>
                </div>
              </div>

              {/* Sub-view Area */}
              <div className="flex-1 flex overflow-hidden relative">
                {dashboardMode === 'calendar' ? (
                  <CalendarView 
                    microcycles={microcycles} 
                    mesocycles={[activeMeso]}
                    onUpdateWorkouts={setMicrocycles}
                    onViewSession={handleViewSession}
                    filter={filter}
                  />
                ) : dashboardMode === 'sessions' ? (
                  <SessionsView 
                    microcycles={microcycles}
                    onViewSession={handleViewSession}
                    filter={filter}
                    activeMicrocycleId={activeMicrocycleId}
                    setActiveMicrocycleId={setActiveMicrocycleId}
                    activeWorkoutId={activeWorkoutId}
                    setActiveWorkoutId={setActiveWorkoutId}
                  />
                ) : dashboardMode === 'insights' ? (
                  <InsightsView />
                ) : dashboardMode === 'security' ? (
                  <SecurityView />
                ) : (
                  <div className="flex flex-col gap-6 p-10 w-full overflow-y-auto">
                    <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-4">External Integrations</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <TelegramLinkPanel />
                      <SheetsPublishPanel />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            /* Execution Logger Workspace (Dynamic set writer) */
            <motion.div
              key="session"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex-1 overflow-y-auto p-10 space-y-10 scroll-smooth bg-[#0E0E0E]"
            >
              {activeWorkout ? (
                <>
                  {/* Session UI Header */}
                  <div id="training-focus" className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <button 
                          onClick={() => setCurrentView('dashboard')}
                          className="p-2 glass-card rounded-lg text-gray-500 hover:text-white transition-all hover:bg-white/5 active:scale-95 cursor-pointer"
                        >
                          <ChevronRight size={16} className="rotate-180" />
                        </button>
                        <span className="bg-mac-blue/25 text-mac-blue px-4 py-2 rounded-full text-[15px] font-black uppercase tracking-[0.2em] font-sans">
                          {activeMicro?.weekName} • {activeWorkout.dayLabel}
                        </span>
                      </div>
                      <h2 className="text-4xl font-bold text-white tracking-tight">{activeWorkout.title}</h2>
                    </div>

                    {/* Dual-Role Switcher (Coach View vs Athlete View) */}
                    <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 self-end sm:self-center">
                      <button
                        onClick={() => setRoleMode('coach')}
                        className={`px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                          roleMode === 'coach'
                            ? 'bg-mac-blue text-white shadow-md'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        Coach View
                      </button>
                      <button
                        onClick={() => setRoleMode('athlete')}
                        className={`px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                          roleMode === 'athlete'
                            ? 'bg-mac-green text-black font-extrabold shadow-md'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        Athlete View
                      </button>
                    </div>
                  </div>

                  {/* Reactive Drills / Exercise Modules */}
                  {roleMode === 'athlete' ? (
                    <div className="flex flex-col items-center justify-center py-6 w-full bg-black/20 rounded-2xl border border-white/5 p-4 sm:p-8">
                      <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-4">
                        📱 Telegram WebApp Mobile Simulator
                      </p>
                      <div className="w-[390px] h-[844px] bg-black rounded-[48px] border-[12px] border-zinc-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden relative ring-1 ring-white/10 flex flex-col">
                        {/* Dynamic Island / Speaker cutout */}
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-6 bg-zinc-800 rounded-full z-50 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-black ml-auto mr-4" />
                        </div>
                        {/* Inside Viewport */}
                        <div className="flex-1 overflow-hidden pt-6">
                          <TelegramSessionTerminal 
                            microcycles={microcycles}
                            onUpdate={setMicrocycles}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activeWorkout.exercises.map(ex => (
                        <ExerciseCard 
                          key={ex.id}
                          id={ex.id}
                          title={ex.title}
                          variation={ex.variation}
                          tags={ex.tags}
                          initialSets={ex.sets}
                          onUpdateSets={(updatedSets) => handleUpdateSets(ex.id, updatedSets)}
                          roleMode={roleMode}
                        />
                      ))}

                      <AccessoryLedger 
                        accessories={activeWorkout.accessories || []}
                        onUpdateAccessories={handleUpdateAccessories}
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
                  <p className="text-xs text-gray-500 mt-2">Select a session from the Dashboard grid or Feed to begin logging.</p>
                  <button 
                    onClick={() => setCurrentView('dashboard')}
                    className="mt-6 px-6 py-2 bg-mac-blue text-white font-bold rounded-xl text-xs uppercase tracking-widest cursor-pointer hover:bg-blue-600 transition-colors"
                  >
                    Return to Dashboard
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Footer (Logger commands active only when logging) */}
        <footer className="mt-auto p-4 border-t border-white/10 bg-[#090909]/95 backdrop-blur-md flex justify-between items-center z-40">
          <div className="flex items-center gap-6 text-[13px] font-black uppercase tracking-widest font-mono">
            <span className="flex items-center gap-2 text-gray-200">
              <Clock size={15} className="text-mac-blue" /> PRO ENGINE LOCK : ACTIVE
            </span>
            <span className="flex items-center gap-2 text-mac-green font-bold">
              <CheckCircle2 size={15} /> SECURE OFFLINE BUFFER
            </span>
          </div>
          
          <div className="flex gap-3">
            {currentView === 'session' ? (
              <>
                <button 
                  onClick={() => setCurrentView('dashboard')}
                  className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[13px] font-black uppercase tracking-widest text-[#AEAEB2] hover:text-white transition-all cursor-pointer font-sans"
                >
                  OVERRIDE PLAN
                </button>
                <button 
                  onClick={() => {
                    // Alert algorithm accepted
                    alert('Autoregulated recommendations successfully committed to active sets.');
                  }}
                  className="px-5 py-2.5 bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-[13px] font-black uppercase tracking-widest text-white hover:bg-white/15 transition-all cursor-pointer font-sans"
                >
                  ACCEPT ALGORITHM
                </button>
                <button 
                  onClick={() => handleFinishSession('Completed')}
                  className="px-6 py-2.5 bg-mac-green text-black rounded-xl text-[13px] font-black uppercase tracking-widest shadow-lg shadow-green-500/20 hover:bg-green-500 transition-all active:scale-95 cursor-pointer font-sans"
                >
                  COMMIT MACRO ADJUSTMENTS
                </button>
              </>
            ) : (
              <button 
                onClick={() => {
                  // Pre-load Day 1 active session of Micro 3
                  setActiveWorkoutId('w-3-1');
                  setActiveMicrocycleId('micro-3');
                  setCurrentView('session');
                }}
                className="px-8 py-3 bg-mac-blue text-white rounded-xl text-[15px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/30 hover:bg-blue-600 transition-all active:scale-95 cursor-pointer font-sans"
              >
                Log Active Session
              </button>
            )}
          </div>
        </footer>
    </AppShell>
  );
}

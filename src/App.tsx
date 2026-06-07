import { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  Clock, 
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DashboardPlaceholders } from './components/DashboardPlaceholders';
import { AppShell } from './components/AppShell';
import { MonthGridView } from './components/MonthGridView';
import { WeekGridView } from './components/WeekGridView';
import { SessionsView } from './components/SessionsView';
import { ExerciseCard } from './components/ExerciseCard';
import { AccessoryLedger } from './components/AccessoryLedger';
import TelegramSessionTerminal from './components/mobile/TelegramSessionTerminal';
import { LoginView } from './components/LoginView';
import { PrescriptionEditor } from './components/PrescriptionEditor';
import { WorkoutLockBanner } from './components/WorkoutLockBanner';
import { ConflictReviewCard } from './components/ConflictReviewCard';
import { apiService } from './services/api';
import { saveSnapshot, getSnapshot, evictOldSyncedData } from './services/db';
import { AgentProvider } from './contexts/AgentProvider';
import { 
  INITIAL_MICROCYCLES, 
  INITIAL_MESOCYCLE
} from './types';
import type { WorkoutData, MicrocycleData, ExerciseData } from './types';

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

  const [dashboardMode, setDashboardMode] = useState<'month' | 'sessions' | 'week' | 'agent' | 'visual-grid' | 'telegram'>(() => {
    return (localStorage.getItem('obsidian_dashboard_mode') as any) || 'month';
  });

  const [filter, setFilter] = useState<'All' | 'Squat' | 'Bench' | 'Deadlift'>('All');
  const [activeAthleteId, setActiveAthleteId] = useState<string | null>('ath-1');
  const [prescriptionExercise, setPrescriptionExercise] = useState<ExerciseData | null>(null);
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
    console.log('Dashboard mode changed to', dashboardMode);
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
       // Logic to persist status to API/DB here
    }
  };

  if (!user) {
    return <LoginView onLogin={(role) => setUser({ role: role.toUpperCase() })} />;
  }

  const componentsDict = {
    'lock-banner': <WorkoutLockBanner holder="Coach Mercer" expiresAt="15:30" mode="locked_by_me" />,
    'month-grid': (
      <MonthGridView 
        microcycles={microcycles} 
        mesocycles={[activeMeso]}
        onUpdateWorkouts={setMicrocycles}
        onViewSession={handleViewSession}
        filter={filter}
      />
    ),
    'athlete-simulator': (
      <div className="flex flex-col items-center justify-center py-6 w-full h-full bg-transparent relative overflow-hidden">
        <p className="text-[10px] font-mono text-[#AEAEB2] uppercase tracking-widest mb-4 z-10">
          📱 Telegram Simulator
        </p>
        <div className="w-[340px] flex-1 max-h-[700px] bg-black rounded-[38px] border-[10px] border-zinc-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden relative ring-1 ring-white/10 flex flex-col z-10 transition-transform">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-5 bg-zinc-800 rounded-full z-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-black ml-auto mr-3" />
          </div>
          <div className="flex-1 overflow-hidden pt-5">
            <TelegramSessionTerminal />
          </div>
        </div>
      </div>
    ),
    'sessions-view': (
      <SessionsView 
        microcycles={microcycles}
        onViewSession={handleViewSession}
        filter={filter}
        activeMicrocycleId={activeMicrocycleId}
        setActiveMicrocycleId={setActiveMicrocycleId}
        activeWorkoutId={activeWorkoutId}
        setActiveWorkoutId={setActiveWorkoutId}
      />
    ),
    'accessory-ledger': activeWorkout ? (
      <AccessoryLedger 
        accessories={activeWorkout.accessories || []}
        onUpdateAccessories={handleUpdateAccessories}
      />
    ) : <div className="text-zinc-600 p-2 text-xs">Select a workout to view accessory ledger</div>,
    'conflict-review': activeWorkout ? (
      <ConflictReviewCard 
        athletes={[]}
        workout={activeWorkout}
        onClose={() => {}}
        onResolve={() => {}}
      />
    ) : <div className="text-zinc-600 p-2 text-xs">Select a workout to view sync conflict panel</div>
  };

  return (
    <AgentProvider>
      <AppShell
        roleMode={roleMode}
        setRoleMode={setRoleMode}
        dashboardMode={dashboardMode}
        setDashboardMode={setDashboardMode}
      >
        <AnimatePresence mode="wait">
        {currentView === 'dashboard' ? (
          <motion.div
        key="dashboard"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -30 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* Sub-view Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {dashboardMode === 'month' ? (
            <MonthGridView 
              microcycles={microcycles} 
              mesocycles={[activeMeso]}
              onUpdateWorkouts={setMicrocycles}
              onViewSession={handleViewSession}
              filter={filter}
            />
          ) : dashboardMode === 'week' ? (
            <WeekGridView 
              microcycles={microcycles}
              onUpdateWorkouts={setMicrocycles}
              onViewSession={handleViewSession}
              filter={filter}
              activeMicrocycleId={activeMicrocycleId}
              setActiveMicrocycleId={setActiveMicrocycleId}
              setDashboardMode={setDashboardMode}
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
          ) : dashboardMode === 'agent' ? (
            <DashboardPlaceholders />
          ) : dashboardMode === 'telegram' ? (
            <div className="w-full h-full flex items-center justify-center p-8 bg-[#0A0A0A]">
               <TelegramSessionTerminal />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-xs uppercase tracking-widest">
              Please select a workspace
            </div>
          )}
        </div>
      </motion.div>
    ) : (
      <motion.div
        key="session"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="h-full flex flex-col"
      >
        {activeWorkout ? (
          <>
            {/* Header / Meta */}
            <div className="p-6 border-b border-white/10">
              <h2 className="text-2xl font-black text-white uppercase tracking-tight">
                {activeWorkout.name}
              </h2>
              <p className="text-sm text-zinc-500 font-mono mt-1">
                {activeWorkout.date} • {activeWorkout.status}
              </p>
            </div>

            {/* Content Scroll */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8" id="training-focus">
              {roleMode === 'athlete' ? (
                <div className="flex flex-col items-center justify-center py-6 w-full bg-black/20 rounded-2xl border border-white/5 p-4 sm:p-8">
                  <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-4">
                    📱 Telegram WebApp Mobile Simulator
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
                <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto pb-12">
                  <div className="mb-4 px-2">
                    <h3 className="text-ok-muted text-[12px] font-semibold uppercase tracking-widest">
                      Session Programming & Execution
                    </h3>
                  </div>
                  {activeWorkout.exercises.map(ex => (
                    <ExerciseCard 
                      key={ex.id}
                      exercise={ex}
                      roleMode={roleMode}
                      onUpdateSets={(sets) => handleUpdateSets(ex.id, sets)}
                      onOpenPrescription={() => {}}
                    />
                  ))}
                  <div className="flex justify-center mt-8">
                    <button
                      onClick={() => setCurrentView('dashboard')}
                      className="px-6 py-2.5 bg-white/5 border border-white/10 hover:border-white/20 text-white font-bold rounded-xl text-xs uppercase tracking-widest cursor-pointer hover:bg-white/10 transition-all shadow-lg"
                    >
                      Return to Dashboard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </motion.div>
    )}
  </AnimatePresence>

        {/* Global Footer (Logger commands active only when logging) */}
        <footer className="mt-auto p-4 border-t border-white/10 bg-[#090909]/95 backdrop-blur-md flex justify-between items-center z-40">
            {/* status indicators removed for minimal UI */}
          
          <div className="flex gap-3">
            {currentView === 'session' ? (
              <>
                <button 
                  onClick={() => setCurrentView('dashboard')}
                  className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[13px] font-black uppercase tracking-widest text-[#AEAEB2] hover:text-white transition-all cursor-pointer font-sans"
                >
                  Reset Plan
                </button>
                <button 
                  onClick={() => {
                    // Alert algorithm accepted
                    alert('Autoregulated recommendations successfully committed to active sets.');
                  }}
                  className="px-5 py-2.5 bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-[13px] font-black uppercase tracking-widest text-white hover:bg-white/15 transition-all cursor-pointer font-sans"
                >
                  Accept Recommendation
                </button>
                <button 
                  onClick={() => handleFinishSession('Completed')}
                  className="px-6 py-2.5 bg-mac-green text-black rounded-xl text-[13px] font-black uppercase tracking-widest shadow-lg shadow-green-500/20 hover:bg-green-500 transition-all active:scale-95 cursor-pointer font-sans"
                >
                  Save Session
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
        {prescriptionExercise && (
          <PrescriptionEditor
            exercise={prescriptionExercise}
            roleMode={roleMode}
            onClose={() => setPrescriptionExercise(null)}
            onSave={(updatedEx) => {
              setMicrocycles(prev => prev.map(m => {
                if (m.id !== activeMicrocycleId) return m;
                return {
                  ...m,
                  workouts: m.workouts.map(w => {
                    if (w.id !== activeWorkoutId) return w;
                    return {
                      ...w,
                      exercises: w.exercises.map(ex => ex.id === updatedEx.id ? updatedEx : ex)
                    };
                  })
                };
              }));
              setPrescriptionExercise(null);
            }}
          />
        )}
      </AppShell>
    </AgentProvider>
  );
}

export const SampleDefault = () => (
  <App />
);

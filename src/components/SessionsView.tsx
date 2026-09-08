import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { WorkoutData } from '../types';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useAuth } from '../contexts/AuthContext';
import { UI_KEYS, getUiPref, setUiPref, removeUiPref } from '../storage/uiPrefs';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';
import { SessionWorkoutEditor } from './SessionWorkoutEditor';
import TelegramSessionTerminal from './mobile/TelegramSessionTerminal';

interface SessionsViewProps {
  filter: LiftFilterValue;
  onFilterChange: (value: LiftFilterValue) => void;
}

function liftAbbrev(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('squat')) return 'SQ';
  if (t.includes('bench')) return 'BP';
  if (t.includes('dead')) return 'DL';
  return title.slice(0, 3).toUpperCase();
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

export function SessionsView({
  filter,
  onFilterChange,
}: SessionsViewProps) {
  const { roleMode, setRoleMode } = useAuth();
  const {
    microcycles,
    activeMicrocycleId,
    setActiveMicrocycleId,
    activeWorkoutId,
    setActiveWorkoutId,
  } = usePeriodization();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const microRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasRestoredRef = useRef(false);

  const [observedIdx, setObservedIdx] = useState<number>(() => {
    const activeIdx = microcycles.findIndex(m => m.id === activeMicrocycleId);
    return activeIdx !== -1 ? activeIdx : 2;
  });

  const [expandedMicroId, setExpandedMicroId] = useState<string | null>(() => {
    const saved = getUiPref(UI_KEYS.sessionsExpandedMicro);
    if (saved && microcycles.some(m => m.id === saved)) return saved;
    return null;
  });

  const setExpanded = (microId: string | null) => {
    setExpandedMicroId(microId);
    if (microId) {
      setUiPref(UI_KEYS.sessionsExpandedMicro, microId);
      setActiveMicrocycleId(microId);
      const idx = microcycles.findIndex(m => m.id === microId);
      if (idx !== -1) setObservedIdx(idx);
    } else {
      removeUiPref(UI_KEYS.sessionsExpandedMicro);
    }
  };

  useEffect(() => {
    if (hasRestoredRef.current) return;

    const savedScrollPos = getUiPref(UI_KEYS.sessionsScrollY);
    
    const restoreScroll = () => {
      if (!containerRef.current || hasRestoredRef.current) return;
      
      if (activeWorkoutId) {
        const parentMicro = microcycles.find(m => m.workouts.some(w => w.id === activeWorkoutId));
        if (parentMicro) {
          const el = microRefs.current[parentMicro.id];
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            hasRestoredRef.current = true;
            return;
          }
        }
      }

      if (savedScrollPos) {
        const scrollY = parseInt(savedScrollPos, 10);
        containerRef.current.scrollTop = scrollY;
      }
      hasRestoredRef.current = true;
    };

    const rAnimFrame = requestAnimationFrame(() => {
      const deRefTimer = setTimeout(restoreScroll, 50);
      return () => clearTimeout(deRefTimer);
    });

    return () => cancelAnimationFrame(rAnimFrame);
  }, []);

  const openWorkout = (workout: WorkoutData, microId: string) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setExpanded(microId);
  };

  useEffect(() => {
    if (!expandedMicroId) return;
    const sessionEl = activeWorkoutId ? document.getElementById(`session-${activeWorkoutId}`) : null;
    const target = sessionEl ?? microRefs.current[expandedMicroId];
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [expandedMicroId]);

  const handleScroll = () => {
    if (!containerRef.current || expandedMicroId) return;
    const container = containerRef.current;
    
    setUiPref(UI_KEYS.sessionsScrollY, container.scrollTop.toString());

    const containerRect = container.getBoundingClientRect();
    const viewportCenter = containerRect.top + (containerRect.height / 2);

    let closestId = '';
    let closestIdx = -1;
    let minDistance = Infinity;

    microcycles.forEach((micro, idx) => {
      const el = microRefs.current[micro.id];
      if (el) {
        const rect = el.getBoundingClientRect();
        const elementCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(elementCenter - viewportCenter);
        
        if (distance < minDistance) {
          minDistance = distance;
          closestId = micro.id;
          closestIdx = idx;
        }
      }
    });

    if (closestIdx !== -1 && closestIdx !== observedIdx) {
      setObservedIdx(closestIdx);
      
      if (setActiveMicrocycleId) {
        setActiveMicrocycleId(closestId);
      }
      if (setActiveWorkoutId && microcycles[closestIdx]?.workouts?.length > 0) {
        setActiveWorkoutId(microcycles[closestIdx].workouts[0].id);
      }
    }
  };

  const isMaximized = expandedMicroId != null;

  return (
    <div className="flex-1 flex relative h-full overflow-hidden bg-[#0A0A0A]">
      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2"
      >
        <div className="space-y-2 pb-8">
          <div className="h-7 px-1 flex items-center justify-between gap-2">
            <LiftFilter value={filter} onChange={onFilterChange} />
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setRoleMode('coach')}
                className={`h-7 px-2 text-[11px] ${
                  roleMode === 'coach' ? 'text-white' : 'text-[#AEAEB2]'
                }`}
              >
                Coach
              </button>
              <button
                type="button"
                onClick={() => setRoleMode('athlete')}
                className={`h-7 px-2 text-[11px] ${
                  roleMode === 'athlete' ? 'text-white' : 'text-[#AEAEB2]'
                }`}
              >
                Athlete
              </button>
              {isMaximized && (
                <button
                  type="button"
                  onClick={() => setExpanded(null)}
                  className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
                >
                  <Minimize2 size={12} />
                  Show all weeks
                </button>
              )}
            </div>
          </div>

          {roleMode === 'athlete' ? (
            <div className="flex flex-col items-center justify-center py-6 w-full border border-white/10 p-4">
              <p className="text-xs font-mono text-[#636366] mb-4">Telegram Mini App</p>
              <div className="w-[390px] max-w-full h-[844px] bg-black rounded-[48px] border-[12px] border-[#20201f] overflow-hidden relative flex flex-col">
                <div className="flex-1 overflow-hidden pt-6">
                  <TelegramSessionTerminal />
                </div>
              </div>
            </div>
          ) : (

          <div className="flex flex-col gap-3 border-l border-white/10 pl-4 relative">
            {microcycles.map((micro, idx) => {
              const isObserved = idx === observedIdx;
              const isExpanded = expandedMicroId === micro.id;
              const isCollapsedOther = isMaximized && !isExpanded;

              let peakSquat = 0;
              let peakBench = 0;
              
              micro.workouts.forEach(w => {
                w.exercises.forEach(ex => {
                  const val = parseFloat(ex.top || '0');
                  if (ex.title.toLowerCase().includes('squat')) {
                    if (val > peakSquat) peakSquat = val;
                  } else if (ex.title.toLowerCase().includes('bench')) {
                    if (val > peakBench) peakBench = val;
                  }
                });
              });

              const visibleWorkouts = micro.workouts.filter(w => workoutPassesFilter(w, filter));

              return (
                <div
                  key={micro.id}
                  ref={el => { microRefs.current[micro.id] = el; }}
                  className={`flex flex-col relative ${isExpanded ? 'gap-2 min-h-[70vh]' : 'gap-1.5'}`}
                >
                  <div className={`absolute -left-[18px] top-2 w-2 h-2 rounded-full ${
                    isExpanded || isObserved ? 'bg-[#54e083]' : 'bg-white/15'
                  }`} />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isCollapsedOther) setExpanded(micro.id);
                      }}
                      className="flex items-center gap-2 min-w-0 text-left"
                    >
                      <h4 className="text-sm text-white">{micro.weekName}</h4>
                      <span className="text-[10px] text-[#AEAEB2]">{micro.status}</span>
                      <span className="font-mono text-[11px] text-[#AEAEB2]">
                        {micro.workouts.reduce((acc, w) => acc + w.tonnage, 0).toLocaleString()}kg
                      </span>
                      {peakSquat > 0 && <span className="font-mono text-[11px] text-[#AEAEB2]">SQ {peakSquat}</span>}
                      {peakBench > 0 && <span className="font-mono text-[11px] text-[#AEAEB2]">BP {peakBench}</span>}
                    </button>
                    <button
                      type="button"
                      data-testid={`sessions-expand-${micro.id}`}
                      onClick={() => setExpanded(isExpanded ? null : micro.id)}
                      className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1 shrink-0"
                      title={isExpanded ? 'Minimize week' : 'Maximize week'}
                    >
                      {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                      {isExpanded ? 'Minimize' : 'Maximize'}
                    </button>
                  </div>

                  {isCollapsedOther ? (
                    <p className="text-[10px] text-[#636366] px-0.5">
                      {visibleWorkouts.length} sessions · Maximize to open
                    </p>
                  ) : isExpanded ? (
                    <div className="flex flex-col">
                      {visibleWorkouts.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-[#636366]">No sessions match this filter.</p>
                      ) : (
                        visibleWorkouts.map((w) => (
                          <SessionWorkoutEditor
                            key={w.id}
                            workout={w}
                            microcycleId={micro.id}
                            roleMode={roleMode}
                          />
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {visibleWorkouts.map(w => {
                        const isWorkoutActive = activeWorkoutId === w.id;
                        return (
                          <button
                            type="button"
                            onClick={() => openWorkout(w, micro.id)}
                            key={w.id}
                            className={`
                              text-left bg-[#161616] border border-white/10 rounded px-2 py-1 min-w-[220px] w-[220px] flex-shrink-0 hover:border-white/20 leading-none
                              ${isWorkoutActive ? 'border-[#007aff]/50' : ''}
                            `}
                          >
                            <div className="flex items-center justify-between gap-2 h-5">
                              <span className="text-[12px] text-white truncate">
                                {w.dayLabel} {w.title}
                              </span>
                              <span className="text-[10px] text-[#AEAEB2] shrink-0">{w.status}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 h-4 font-mono text-[10px] text-[#AEAEB2]">
                              <span className="truncate">
                                {w.exercises.map((ex) => {
                                  const set = ex.sets[0];
                                  const weight = set?.actual ?? set?.plannedWeight ?? '—';
                                  const reps = set?.reps ?? set?.plannedReps ?? '—';
                                  const rpe = set?.executedRpe ?? set?.plannedRpe ?? '—';
                                  return `${liftAbbrev(ex.title)} ${weight}×${reps}@${rpe}`;
                                }).join('  ')}
                              </span>
                              <span className="shrink-0">{w.tonnage}kg</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

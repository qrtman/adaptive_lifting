import { useEffect, useRef, useState } from 'react';
import { 
  ChevronRight, 
  Zap 
} from 'lucide-react';
import { motion } from 'motion/react';
import { WorkoutData, MicrocycleData } from '../types';

interface SessionsViewProps {
  microcycles: MicrocycleData[];
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: 'All' | 'Squat' | 'Bench' | 'Deadlift';
  
  // Optional parameters for bi-directional active focus syncing
  activeMicrocycleId?: string | null;
  setActiveMicrocycleId?: (id: string | null) => void;
  activeWorkoutId?: string | null;
  setActiveWorkoutId?: (id: string | null) => void;
}

export function SessionsView({
  microcycles,
  onViewSession,
  filter,
  activeMicrocycleId,
  setActiveMicrocycleId,
  activeWorkoutId,
  setActiveWorkoutId
}: SessionsViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const microRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasRestoredRef = useRef(false);

  // Observed center-focused Microcycle index (defaults to active micro-3 at index 2)
  const [observedIdx, setObservedIdx] = useState<number>(() => {
    const activeIdx = microcycles.findIndex(m => m.id === activeMicrocycleId);
    return activeIdx !== -1 ? activeIdx : 2;
  });

  // 1. Low-Latency State-Based Scroll Restoration
  useEffect(() => {
    if (hasRestoredRef.current) return;

    const savedScrollPos = localStorage.getItem('obsidian_sessions_scroll_y');
    
    const restoreScroll = () => {
      if (!containerRef.current || hasRestoredRef.current) return;
      
      // If a specific workout is already active under parent, attempt coordinates targeting its microcycle container
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

      // Fallback: Restore precise pixel coordinates from standard browser localStorage
      if (savedScrollPos) {
        const scrollY = parseInt(savedScrollPos, 10);
        containerRef.current.scrollTop = scrollY;
      }
      hasRestoredRef.current = true;
    };

    // requestAnimationFrame combined with deferred calculation ensures flawless layout hydration 
    // before applying the snapping calculations
    const rAnimFrame = requestAnimationFrame(() => {
      const deRefTimer = setTimeout(restoreScroll, 50);
      return () => clearTimeout(deRefTimer);
    });

    return () => cancelAnimationFrame(rAnimFrame);
  }, []);

  // 2. Smart Viewport Center-Focus Engine
  const handleScroll = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    // Save scroll coordinates dynamically to standard browser localStorage
    localStorage.setItem('obsidian_sessions_scroll_y', container.scrollTop.toString());

    // Compute the exact geometric center-line of the viewport container
    const containerRect = container.getBoundingClientRect();
    const viewportCenter = containerRect.top + (containerRect.height / 2);

    let closestId = '';
    let closestIdx = -1;
    let minDistance = Infinity;

    microcycles.forEach((micro, idx) => {
      const el = microRefs.current[micro.id];
      if (el) {
        // Calculate the center point of other individual Microcycle containers
        const rect = el.getBoundingClientRect();
        const elementCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(elementCenter - viewportCenter);
        
        // Closest element represents the active observed index
        if (distance < minDistance) {
          minDistance = distance;
          closestId = micro.id;
          closestIdx = idx;
        }
      }
    });

    if (closestIdx !== -1 && closestIdx !== observedIdx) {
      setObservedIdx(closestIdx);
      
      // Sync focus with the host core state
      if (setActiveMicrocycleId) {
        setActiveMicrocycleId(closestId);
      }
      if (setActiveWorkoutId && microcycles[closestIdx]?.workouts?.length > 0) {
        setActiveWorkoutId(microcycles[closestIdx].workouts[0].id);
      }
    }
  };

  return (
    <div className="flex-1 flex relative h-full overflow-hidden bg-[#000000]">
      
      {/* Central Infinite-Scroll Timeline Feed (execution timeline) */}
      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-8 lg:p-10 space-y-12 scrollbar-thin select-none"
      >
        <div className="max-w-6xl mx-auto space-y-12 pb-24">
          
          <div className="pb-6 border-b border-white/5">
            <h2 className="text-3xl font-black text-white tracking-tight font-sans">Sequence Execution Feed</h2>
            <p className="text-[15px] font-black uppercase tracking-widest text-[#AEAEB2] mt-2 font-sans">
              AUTOREGULATED PROGRESSION • REAL-TIME CYCLIC SCROLL TIMELINE
            </p>
          </div>

          <div className="flex flex-col gap-10 border-l-2 border-[#20201F] pl-8 relative">
            {microcycles.map((micro, idx) => {
              const isObserved = idx === observedIdx;

              // Compute peak e1RMs for Squat, Bench
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

              return (
                <div
                  key={micro.id}
                  ref={el => { microRefs.current[micro.id] = el; }}
                  className="flex flex-col gap-6 relative transition-all duration-500"
                >
                  {/* Timeline Node */}
                  <div className={`absolute -left-[39px] top-4 w-3.5 h-3.5 rounded-full border-2 border-[#000000] transition-all duration-500 ${
                    isObserved ? 'bg-[#54e083] shadow-[0_0_15px_rgba(84,224,131,0.8)]' : 'bg-[#20201F]'
                  }`} />

                  {/* Microcycle Header Panel */}
                  <div className="flex justify-between items-end w-full max-w-5xl bg-[#0e0e0e] p-4 rounded-lg border border-[#20201F]">
                    <div className="flex items-center gap-4">
                      <h4 className="text-lg font-black text-white tracking-tight font-sans">{micro.weekName}</h4>
                      {micro.active && (
                        <span className="text-[10px] bg-mac-blue/25 text-mac-blue px-2 py-0.5 rounded font-black uppercase tracking-widest border border-mac-blue/30 animate-pulse font-sans">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex flex-col items-end font-sans">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1">Est Tonnage</span>
                        <span className="text-white font-black text-xs font-mono">
                          {micro.workouts.reduce((acc, w) => acc + w.tonnage, 0).toLocaleString()}kg
                        </span>
                      </div>
                      {peakSquat > 0 && (
                        <div className="flex flex-col items-end font-sans">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1">e1RM Squat</span>
                          <span className="text-white font-black text-xs font-mono">{peakSquat}kg</span>
                        </div>
                      )}
                      {peakBench > 0 && (
                        <div className="flex flex-col items-end font-sans">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1">e1RM Bench</span>
                          <span className="text-white font-black text-xs font-mono">{peakBench}kg</span>
                        </div>
                      )}
                      <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest border rounded font-sans ${
                        micro.status === 'Verified' ? 'border-mac-green/20 bg-mac-green/10 text-mac-green' :
                        micro.status === 'In Progress' ? 'border-mac-blue/20 bg-mac-blue/10 text-mac-blue animate-pulse' :
                        'border-white/10 bg-white/5 text-gray-400'
                      }`}>
                        {micro.status}
                      </span>
                    </div>
                  </div>

                  {/* Horizontal Scroll Workout Cards */}
                  <div className="relative w-full">
                    <div 
                      className="flex gap-6 overflow-x-auto hide-scrollbar pb-4"
                      style={{
                        maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
                        WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)'
                      }}
                    >
                      {micro.workouts
                        .filter(w => {
                          if (filter === 'All') return true;
                          const hasSquat = w.exercises.some(e => e.title.toLowerCase().includes('squat'));
                          const hasBench = w.exercises.some(e => e.title.toLowerCase().includes('bench'));
                          const hasDeadlift = w.exercises.some(e => e.title.toLowerCase().includes('deadlift') || e.title.toLowerCase().includes('dead'));
                          if (filter === 'Squat') return hasSquat;
                          if (filter === 'Bench') return hasBench;
                          if (filter === 'Deadlift') return hasDeadlift;
                          return false;
                        })
                        .map(w => {
                          const isWorkoutActive = activeWorkoutId === w.id;
                          
                          return (
                            <div
                              onClick={() => onViewSession(w, micro.id)}
                              key={w.id}
                              className={`
                                bg-[#161616] border border-[#20201F] rounded-lg p-5 flex flex-col gap-4 min-w-[340px] w-[340px] min-h-[360px] hover:border-white/20 transition-all cursor-pointer group flex-shrink-0 relative overflow-hidden
                                ${isWorkoutActive ? 'ring-1 ring-[#007aff] bg-[#007aff]/5 border-[#007aff]/30' : ''}
                              `}
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[10px] text-gray-400 font-mono">
                                    [W{microcycles.indexOf(micro) + 1} • {w.dayLabel}] • {w.date}
                                  </span>
                                  <h4 className="text-base font-black text-white tracking-tight mt-1 font-sans">
                                    {w.title}
                                  </h4>
                                </div>
                                <div className={`w-2.5 h-2.5 rounded-full ${
                                  w.status === 'Completed' ? 'bg-[#54e083] shadow-[0_0_8px_rgba(84,224,131,0.5)]' : 'bg-[#007aff]'
                                }`} />
                              </div>

                              <div className="flex-1 flex flex-col gap-2 bg-[#0e0e0e] p-3 rounded border border-[#20201F] font-sans text-xs">
                                <div className="flex flex-col gap-3">
                                  {w.exercises.map((ex, exIdx) => {
                                    const isSquat = ex.title.toLowerCase().includes('squat');
                                    const isBench = ex.title.toLowerCase().includes('bench');
                                    const exName = isSquat ? 'PRIMARY SQUAT' : (isBench ? 'PRIMARY BENCH' : 'DEADLIFT');
                                    const labelClass = isSquat ? 'text-[#007aff]' : (isBench ? 'text-[#34c759]' : 'text-amber-500');

                                    // Display sets info
                                    const firstSet = ex.sets[0];
                                    const prescWeight = firstSet?.plannedWeight || '---';
                                    const prescReps = firstSet?.plannedReps || '—';
                                    const prescRpe = firstSet?.plannedRpe || '—';

                                    const loggedWeight = firstSet?.actual || '';
                                    const loggedReps = firstSet?.reps || '';
                                    const loggedRpe = firstSet?.executedRpe || '';

                                    return (
                                      <div key={ex.id} className="flex flex-col gap-1">
                                        <div className="flex justify-between items-center text-[10px] font-bold tracking-wider">
                                          <span className={labelClass}>{exName}</span>
                                          <span className="text-gray-500 font-mono">e1RM: {ex.top?.split(' ')[0] || '—'}</span>
                                        </div>
                                        <div className="flex flex-col pl-2 border-l border-[#20201F] gap-0.5">
                                          <div className="flex justify-between items-center text-[11px] text-gray-400 font-mono">
                                            <span>Presc: {prescWeight}kg x {prescReps} @ RPE {prescRpe}</span>
                                          </div>
                                          {loggedWeight && (
                                            <div className="flex justify-between items-center text-[11px] text-white font-mono">
                                              <span>Log: {loggedWeight}kg x {loggedReps} @ RPE {loggedRpe}</span>
                                              <span className="text-[#54e083] font-bold">✓</span>
                                            </div>
                                          )}
                                        </div>
                                        {exIdx < w.exercises.length - 1 && <div className="h-px bg-[#20201F] mt-2" />}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="mt-auto pt-4 flex justify-between items-center border-t border-[#20201F] font-mono text-[10px]">
                                <div className="flex flex-col">
                                  <span className="text-gray-400 uppercase">SESSION VOL: {(w.tonnage / 1000).toFixed(1)}k kg</span>
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="text-[#54e083] font-bold uppercase">{w.status}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

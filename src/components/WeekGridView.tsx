import React from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  RefreshCw
} from 'lucide-react';
import type { MicrocycleData, WorkoutData } from '../types';
import { apiService } from '../services/api';

const getMondayOfDate = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay();
  const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monDate = new Date(year, month - 1, diffToMon);
  
  const y = monDate.getFullYear();
  const m = String(monDate.getMonth() + 1).padStart(2, '0');
  const r = String(monDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${r}`;
};

interface WeekGridViewProps {
  microcycles: MicrocycleData[];
  onUpdateWorkouts: (updatedMicrocycles: MicrocycleData[]) => void;
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: 'All' | 'Squat' | 'Bench' | 'Deadlift';
  activeMicrocycleId: string | null;
  setActiveMicrocycleId: (id: string | null) => void;
  setDashboardMode: (mode: 'month' | 'sessions' | 'week') => void;
}

export function WeekGridView({
  microcycles,
  onUpdateWorkouts,
  onViewSession,
  filter,
  activeMicrocycleId,
  setActiveMicrocycleId,
  setDashboardMode
}: WeekGridViewProps) {
  
  const activeMicroIdx = microcycles.findIndex(m => m.id === activeMicrocycleId);
  const activeMicro = activeMicrocycles()[activeMicroIdx] || activeMicrocycles()[0];

  function activeMicrocycles() {
    return microcycles.length > 0 ? microcycles : [];
  }

  const handlePrevMicro = () => {
    if (activeMicroIdx > 0) {
      setActiveMicrocycleId(microcycles[activeMicroIdx - 1].id);
    }
  };

  const handleNextMicro = () => {
    if (activeMicroIdx < microcycles.length - 1) {
      setActiveMicrocycleId(microcycles[activeMicroIdx + 1].id);
    }
  };

  const earliestWorkoutDate = activeMicro?.workouts.length > 0
    ? [...activeMicro.workouts].sort((a,b) => a.date.localeCompare(b.date))[0].date
    : "2026-09-14";

  const monDateStr = getMondayOfDate(earliestWorkoutDate);
  const [monYear, monMonth, monDay] = monDateStr.split('-').map(Number);
  const monDate = new Date(monYear, monMonth - 1, monDay);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monDate);
    d.setDate(monDate.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    const dateString = `${y}-${m}-${r}`;
    const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i];
    const dayName = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    return { dateString, dayLabel, dayName };
  });

  const getPrevMicrocycleVolume = () => {
    if (activeMicroIdx <= 0) return null;
    const prevMc = microcycles[activeMicroIdx - 1];
    return prevMc.workouts.reduce((sum, w) => sum + w.tonnage, 0);
  };

  const currentTonnage = activeMicro?.workouts.reduce((sum, w) => sum + w.tonnage, 0) || 0;
  const prevTonnage = getPrevMicrocycleVolume();
  const tonnageDelta = prevTonnage !== null && prevTonnage > 0
    ? {
        val: currentTonnage - prevTonnage,
        pct: ((currentTonnage - prevTonnage) / prevTonnage) * 100
      }
    : null;

  const handleAddWorkout = (dateStr: string) => {
    if (!activeMicro) return;
    
    const count = activeMicro.workouts.length + 1;
    const newWorkout: WorkoutData = {
      id: `w-new-${Date.now()}`,
      date: dateStr,
      dayLabel: `D${count}`,
      title: `D${count}: Added Session`,
      tonnage: 0,
      delta: 0,
      color: 'mac-blue',
      status: 'Planned',
      exercises: [
        {
          id: `ex-${Date.now()}`,
          title: filter !== 'All' ? `Competition ${filter}` : "Competition Squat",
          variation: "Competition",
          tags: filter !== 'All' ? [filter, "Comp"] : ["Squat", "Comp"],
          top: "---",
          vol: "0kg",
          sets: [
            {
              id: `set-${Date.now()}`,
              label: "S1",
              plannedWeight: 100,
              plannedReps: 5,
              plannedRpe: 7,
              actual: null,
              reps: null,
              executedRpe: null
            }
          ]
        }
      ]
    };

    const updated = microcycles.map(m => {
      if (m.id !== activeMicro.id) return m;
      return {
        ...m,
        workouts: [...m.workouts, newWorkout]
      };
    });

    onUpdateWorkouts(updated);
  };

  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[#0A0A0A] p-6">
      <div className="flex-1 flex flex-col bg-[#0F0F0F] border border-white/10 rounded-[12px] p-6 overflow-hidden shadow-2xl relative">
        
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-4 mb-6 shrink-0">
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePrevMicro} 
              disabled={activeMicroIdx <= 0}
              className="p-1.5 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white rounded-[4px] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <button 
              onClick={handleNextMicro} 
              disabled={activeMicroIdx >= microcycles.length - 1}
              className="p-1.5 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white rounded-[4px] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-gray-500 font-bold uppercase tracking-wider">Active Path:</span>
            <span className="bg-white/5 border border-white/5 px-2 py-1 rounded-[4px] text-xs font-semibold text-gray-300">
              MESO_01
            </span>
            <span className="text-zinc-600">/</span>
            <span className="bg-mac-blue/15 border border-mac-blue/20 px-2 py-1 rounded-[4px] text-xs font-semibold text-mac-blue">
              {activeMicro?.weekName}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex border border-white/10 bg-black/40 rounded-[8px] p-0.5">
              <button 
                onClick={() => setDashboardMode('month')} 
                className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-gray-400 hover:text-white rounded-[6px] transition-colors cursor-pointer"
              >
                Month
              </button>
              <button 
                className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider bg-white/10 text-white rounded-[6px] shadow-sm cursor-default"
              >
                Week
              </button>
            </div>

            <button 
              onClick={async () => {
                triggerHaptic();
                try {
                  const data = await apiService.getMesocycle();
                  if (data && data.microcycles) {
                    onUpdateWorkouts(data.microcycles);
                  }
                  alert("Successfully synchronized microcycle data with backend server.");
                } catch (err) {
                  alert("Sync failed: Running in offline fallback mode.");
                }
              }}
              className="px-3 py-1.5 border border-white/10 hover:border-mac-green/40 hover:bg-mac-green/5 text-gray-300 hover:text-mac-green text-xs font-bold uppercase tracking-wider rounded-[4px] transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw size={13} />
              Sync
            </button>
          </div>
        </div>

        {/* Microcycle Header strip (KPI Rollup) */}
        {activeMicro && (
          <div className="flex flex-wrap items-center gap-6 p-4 bg-mac-blue/5 border border-mac-blue/20 rounded-[8px] mb-6 shrink-0">
            <div>
              <span className="font-mono text-[9px] text-[#AEAEB2] font-black tracking-widest block mb-0.5">ACTIVE TIMELINE</span>
              <h4 className="text-sm font-bold text-white uppercase tracking-tight">{activeMicro.weekName}: {activeMicro.focus}</h4>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[9px] text-[#AEAEB2] font-bold uppercase tracking-wider">STATUS:</span>
              <span className="text-xs font-bold text-accent bg-[#54e083]/15 border border-[#54e083]/30 px-2 py-0.5 rounded-[4px] uppercase">
                {activeMicro.status}
              </span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[9px] text-[#AEAEB2] font-bold uppercase tracking-wider">TOTAL VOL:</span>
              <span className="text-sm font-bold text-white font-mono tabular-nums">
                {currentTonnage.toLocaleString()} kg
              </span>
              {tonnageDelta && (
                <span className={`text-[10px] font-bold font-mono ${tonnageDelta.val >= 0 ? 'text-accent' : 'text-orange-500'}`}>
                  ({tonnageDelta.val >= 0 ? '+' : ''}{tonnageDelta.val.toLocaleString()} kg)
                </span>
              )}
            </div>
          </div>
        )}

        {/* 7 Columns Scroll View */}
        <div className="flex-1 overflow-x-auto pb-4 flex gap-4 items-start select-none">
          {weekDays.map((day) => {
            const dayWorkouts = activeMicro?.workouts.filter(w => w.date === day.dateString) || [];
            const isRest = dayWorkouts.length === 0;

            if (isRest) {
              return (
                <div key={day.dateString} className="flex flex-col gap-3 flex-1 min-w-[200px] max-w-[280px] h-full">
                  <div className="bg-[#131313] border border-white/5 rounded-[8px] p-3 flex justify-between items-center opacity-40 shrink-0">
                    <span className="font-mono text-xs font-bold text-gray-400">{day.dayLabel}</span>
                    <span className="font-mono text-[10px] text-gray-500">{day.dayName}</span>
                  </div>

                  <div className="flex-1 border border-dashed border-white/10 hover:border-white/20 rounded-[8px] flex flex-col items-center justify-center p-4 bg-black/10 group transition-all h-[300px]">
                    <span className="text-xs font-bold font-mono uppercase tracking-widest text-zinc-600 mb-4">REST</span>
                    <button
                      onClick={() => handleAddWorkout(day.dateString)}
                      onMouseDown={triggerHaptic}
                      className="opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 hover:border-mac-blue text-[11px] font-bold uppercase tracking-wider text-gray-300 hover:text-white rounded-[4px] transition-all cursor-pointer"
                    >
                      <Plus size={13} />
                      Add Session
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={day.dateString} className="flex flex-col gap-3 flex-1 min-w-[240px] max-w-[320px] h-full">
                
                <div className="bg-[#161616] border border-white/10 rounded-[8px] p-3 flex justify-between items-center shrink-0">
                  <span className="font-mono text-xs font-bold text-white">{day.dayLabel}</span>
                  <span className="font-mono text-[10px] text-zinc-400">{day.dayName}</span>
                </div>

                <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
                  {dayWorkouts
                    .filter(w => {
                      if (filter === 'All') return true;
                      return w.exercises.some(e => e.title.toLowerCase().includes(filter.toLowerCase()));
                    })
                    .map((workout) => (
                      <div 
                        key={workout.id}
                        onClick={() => onViewSession(workout, activeMicro.id)}
                        className="bg-mac-blue/5 border border-mac-blue/20 hover:border-mac-blue/40 rounded-[8px] overflow-hidden flex flex-col transition-all hover:shadow-[0_0_15px_rgba(0,122,255,0.06)] cursor-pointer"
                      >
                        <div className="flex justify-between items-center px-3 py-2 border-b border-mac-blue/10 bg-[#161616]/50">
                          <span className="text-[11px] font-bold text-white tracking-tight">{workout.title}</span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-[3px] border ${
                            workout.status === 'Completed' 
                              ? 'bg-accent border-[#54e083]/20 text-[#54e083]' 
                              : 'bg-mac-blue/15 border-mac-blue/20 text-mac-blue'
                          }`}>
                            {workout.status}
                          </span>
                        </div>

                        <div className="flex justify-between items-center px-3 py-1.5 border-b border-white/5 bg-black/20 text-[9px] text-zinc-400 font-mono">
                          <div className="flex items-center gap-1">
                            <span className="text-zinc-500">VOL:</span>
                            <span className="text-white font-bold">{workout.tonnage.toLocaleString()}kg</span>
                          </div>
                          {workout.delta > 0 && (
                            <span className="text-accent font-bold font-mono">+{workout.delta}kg</span>
                          )}
                        </div>

                        <div className="p-3 bg-black/30 space-y-3">
                          {workout.exercises.map((ex) => {
                            const isSquat = ex.title.toLowerCase().includes('squat');
                            const isBench = ex.title.toLowerCase().includes('bench');
                            const movementName = isSquat ? 'SQUAT' : (isBench ? 'BENCH' : 'DEADLIFT');
                            const movementColor = isSquat ? 'text-mac-blue' : (isBench ? 'text-accent' : 'text-[#F5A623]');

                            return (
                              <div key={ex.id} className="border-b border-white/5 pb-2 last:border-0 last:pb-0 space-y-1">
                                <div className="flex justify-between items-center">
                                  <span className={`text-[10px] font-black uppercase ${movementColor}`}>{movementName}</span>
                                  <span className="text-[8px] text-zinc-500 font-mono">e1RM: {ex.top?.split(' ')[0] || '—'}</span>
                                </div>

                                <div className="space-y-1">
                                  {ex.sets.map((set) => {
                                    const actualW = set.actual;

                                    return (
                                      <div key={set.id} className="grid grid-cols-4 gap-1 text-[9px] font-mono leading-none py-0.5">
                                        <span className="text-zinc-500">{set.label}</span>
                                        <span className="text-zinc-400 col-span-2">
                                          {set.plannedWeight}kg x {set.plannedReps} @ {set.plannedRpe}
                                        </span>
                                        <span className="text-right font-bold text-white">
                                          {actualW ? `${actualW}kg` : '—'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                  <button
                    onClick={() => handleAddWorkout(day.dateString)}
                    onMouseDown={triggerHaptic}
                    className="py-2.5 border border-dashed border-white/10 hover:border-mac-blue text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-white rounded-[6px] transition-colors flex items-center justify-center gap-1 cursor-pointer bg-white/[0.01]"
                  >
                    <Plus size={12} />
                    Add Session
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const SampleDefault = () => (
  <WeekGridView 
    microcycles={[]} 
    onUpdateWorkouts={() => {}} 
    onViewSession={() => {}} 
    filter="All" 
    activeMicrocycleId={null} 
    setActiveMicrocycleId={() => {}} 
    setDashboardMode={() => {}} 
  />
);

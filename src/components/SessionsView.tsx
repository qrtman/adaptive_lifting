import React from 'react';
import { Calendar, Play, CheckCircle } from 'lucide-react';
import type { MicrocycleData, WorkoutData } from '../types';

interface SessionsViewProps {
  microcycles: MicrocycleData[];
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: 'All' | 'Squat' | 'Bench' | 'Deadlift';
  activeMicrocycleId: string | null;
  setActiveMicrocycleId: (id: string | null) => void;
  activeWorkoutId: string | null;
  setActiveWorkoutId: (id: string | null) => void;
}

export function SessionsView({
  microcycles,
  onViewSession,
  filter,
  activeMicrocycleId: _activeMicrocycleId,
  setActiveMicrocycleId: _setActiveMicrocycleId,
  activeWorkoutId: _activeWorkoutId,
  setActiveWorkoutId: _setActiveWorkoutId,
}: SessionsViewProps) {
  // Flatten workouts with their microcycle context
  const allSessions: { workout: WorkoutData; microId: string; microName: string }[] = [];
  
  microcycles.forEach(m => {
    m.workouts.forEach(w => {
      // Apply movement filter
      if (filter !== 'All') {
        const matchesFilter = w.exercises.some(ex => 
          ex.title.toLowerCase().includes(filter.toLowerCase()) ||
          ex.variation.toLowerCase().includes(filter.toLowerCase())
        );
        if (!matchesFilter) return;
      }
      allSessions.push({
        workout: w,
        microId: m.id,
        microName: m.weekName,
      });
    });
  });

  return (
    <div className="w-full h-full flex flex-col font-sans text-sm bg-transparent overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 p-4 bg-black/10 shrink-0">
        <div>
          <h3 className="text-xs font-black text-white uppercase tracking-wider">Chronological Sessions Feed</h3>
          <span className="text-[10px] font-mono text-[#AEAEB2] tracking-widest uppercase block mt-0.5">
            LOGGED AND PROGRAMMED WORKOUT TIMELINE
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {allSessions.map(({ workout, microId, microName }) => {
          const isCompleted = workout.status === 'Completed';
          const isToday = workout.status === 'Today';
          
          return (
            <div 
              key={workout.id}
              className={`p-4 bg-[#111] border rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:bg-white/2 ${
                isCompleted 
                  ? 'border-green-500/20' 
                  : isToday 
                  ? 'border-mac-blue/40 shadow-[0_0_15px_rgba(0,122,255,0.15)]' 
                  : 'border-white/10'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    isCompleted 
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                      : isToday 
                      ? 'bg-mac-blue/10 text-mac-blue border border-mac-blue/20' 
                      : 'bg-white/5 text-gray-400 border border-white/10'
                  }`}>
                    {workout.status}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                    {microName} • {workout.dayLabel}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-white tracking-wide">{workout.title}</h4>
                
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400 font-mono">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} /> {workout.date}
                  </span>
                  <span>•</span>
                  <span>Tonnage: <strong className="text-white font-bold">{workout.tonnage.toLocaleString()} kg</strong></span>
                </div>

                {/* Exercises short summary */}
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {workout.exercises.map(ex => (
                    <span 
                      key={ex.id} 
                      className="text-[10px] bg-white/5 border border-white/5 text-zinc-400 px-2 py-0.5 rounded font-mono"
                    >
                      {ex.title} ({ex.sets.length}s)
                    </span>
                  ))}
                </div>
              </div>

              {/* Navigation Action */}
              <button
                onClick={() => onViewSession(workout, microId)}
                className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                  isToday 
                    ? 'bg-mac-blue hover:bg-blue-600 text-white shadow-[0_0_15px_rgba(0,122,255,0.4)]' 
                    : 'bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white'
                }`}
              >
                {isCompleted ? (
                  <>
                    <CheckCircle size={14} className="text-green-400" />
                    <span>Review Logs</span>
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    <span>Log Workout</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
        {allSessions.length === 0 && (
          <div className="p-8 text-center text-zinc-500 border border-dashed border-white/10 rounded-lg">
            No matching sessions found.
          </div>
        )}
      </div>
    </div>
  );
}

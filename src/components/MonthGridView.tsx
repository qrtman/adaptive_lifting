import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { WorkoutData, MicrocycleData, MesocycleData } from '../types';
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

const hexToRgb = (hex: string) => {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result 
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '255, 255, 255';
};

interface MonthGridViewProps {
  microcycles: MicrocycleData[];
  mesocycles: MesocycleData[];
  onUpdateWorkouts: (updatedMicrocycles: MicrocycleData[]) => void;
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: 'All' | 'Squat' | 'Bench' | 'Deadlift';
}

export function MonthGridView({
  microcycles,
  mesocycles,
  onUpdateWorkouts,
  onViewSession,
  filter
}: MonthGridViewProps) {
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(8); // September is 8 (0-indexed)

  const [draggedWorkoutId, setDraggedWorkoutId] = useState<string | null>(null);
  const [draggedFromMicrocycleId, setDraggedFromMicrocycleId] = useState<string | null>(null);
  
  const [conflictModal, setConflictModal] = useState<{
    workout: WorkoutData;
    sourceMicroId: string;
    newDate: string;
    daysDiff: number;
    conflictType: 'overlap' | 'periodization_breach' | 'normal';
  } | null>(null);

  const [selectedWorkout, setSelectedWorkout] = useState<{ workout: WorkoutData; microId: string } | null>(null);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const daysInMonthCount = new Date(currentYear, currentMonth + 1, 0).getDate();
  const rawFirstDayNo = new Date(currentYear, currentMonth, 1).getDay();
  const startDayOffset = (rawFirstDayNo + 6) % 7;

  const daysGrid: { dateString: string; dayNumber: number; isCurrentMonth: boolean }[] = [];
  
  const prevMonthDaysCount = new Date(currentYear, currentMonth, 0).getDate();
  const prevMonthIdx = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYearIdx = currentMonth === 0 ? currentYear - 1 : currentYear;
  
  for (let i = startDayOffset - 1; i >= 0; i--) {
    const d = prevMonthDaysCount - i;
    daysGrid.push({
      dateString: `${prevYearIdx}-${String(prevMonthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayNumber: d,
      isCurrentMonth: false
    });
  }

  for (let d = 1; d <= daysInMonthCount; d++) {
    daysGrid.push({
      dateString: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayNumber: d,
      isCurrentMonth: true
    });
  }

  const totalDaysSoFar = daysGrid.length;
  const endPadding = totalDaysSoFar % 7 === 0 ? 0 : 7 - (totalDaysSoFar % 7);
  const nextMonthIdx = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextYearIdx = currentMonth === 11 ? currentYear + 1 : currentYear;
  
  for (let d = 1; d <= endPadding; d++) {
    daysGrid.push({
      dateString: `${nextYearIdx}-${String(nextMonthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayNumber: d,
      isCurrentMonth: false
    });
  }

  const workoutList: { workout: WorkoutData; microId: string }[] = [];
  microcycles.forEach(micro => {
    micro.workouts.forEach(w => {
      workoutList.push({ workout: w, microId: micro.id });
    });
  });

  const handleDragStart = (e: React.DragEvent, workoutId: string, microId: string) => {
    setDraggedWorkoutId(workoutId);
    setDraggedFromMicrocycleId(microId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    if (!draggedWorkoutId || !draggedFromMicrocycleId) return;

    let targetWorkout: WorkoutData | null = null;
    microcycles.forEach(m => {
      m.workouts.forEach(w => {
        if (w.id === draggedWorkoutId) {
          targetWorkout = w;
        }
      });
    });

    if (!targetWorkout) return;

    const sourceDateStr = targetWorkout.date;
    if (sourceDateStr === targetDate) return;

    const dropMon = getMondayOfDate(targetDate);
    const origMon = getMondayOfDate(sourceDateStr);

    if (dropMon !== origMon) {
      alert("⚠️ Periodization Boundary Lock:\nWorkouts cannot be dragged across microcycle week boundaries to preserve load-fatigue tracking. Please reschedule within the active week.");
      setDraggedWorkoutId(null);
      setDraggedFromMicrocycleId(null);
      return;
    }

    const sourceDate = new Date(sourceDateStr);
    const dropDate = new Date(targetDate);
    const diffTime = Math.abs(dropDate.getTime() - sourceDate.getTime());
    const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) * (dropDate > sourceDate ? 1 : -1);

    const existingWorkoutOnTarget = workoutList.find(item => item.workout.date === targetDate);
    
    const activeMicroId = draggedFromMicrocycleId;
    const currentMicro = microcycles.find(m => m.id === activeMicroId);
    let isPeriodizationBreach = false;

    if (currentMicro) {
      if (Math.abs(daysDiff) > 7) {
        isPeriodizationBreach = true;
      }
    }

    if (existingWorkoutOnTarget || isPeriodizationBreach || Math.abs(daysDiff) > 3) {
      setConflictModal({
        workout: targetWorkout,
        sourceMicroId: draggedFromMicrocycleId,
        newDate: targetDate,
        daysDiff: daysDiff,
        conflictType: existingWorkoutOnTarget ? 'overlap' : 'periodization_breach'
      });
    } else {
      executeMove(targetWorkout, draggedFromMicrocycleId, targetDate, false, 0);
    }

    setDraggedWorkoutId(null);
    setDraggedFromMicrocycleId(null);
  };

  const executeMove = (
    workout: WorkoutData,
    microId: string,
    newDate: string,
    cascadeShift: boolean,
    daysShift: number
  ) => {
    const updatedMicrocycles = microcycles.map(m => {
      if (m.id !== microId) return m;

      const updatedWorkouts = m.workouts.map(w => {
        if (w.id === workout.id) {
          return { ...w, date: newDate };
        }
        
        if (cascadeShift) {
          const wDate = new Date(w.date);
          const currentOrigDate = new Date(workout.date);
          if (wDate > currentOrigDate) {
            const nextDate = new Date(wDate);
            nextDate.setDate(nextDate.getDate() + daysShift);
            return {
              ...w,
              date: nextDate.toISOString().split('T')[0]
            };
          }
        }
        return w;
      });

      return {
        ...m,
        workouts: updatedWorkouts
      };
    });

    onUpdateWorkouts(updatedMicrocycles);
    setConflictModal(null);
  };

  const cancelMove = () => {
    setConflictModal(null);
    setDraggedWorkoutId(null);
    setDraggedFromMicrocycleId(null);
  };

  const getMicrocycleColorInfo = (microIdx: number) => {
    switch (microIdx) {
      case 0:
        return {
          borderClass: "border-accent",
          bgClass: "bg-[#54e083]/5",
          textClass: "text-[#54e083]",
          labelBg: "bg-[#54e083]/15 text-[#54e083] border border-[#54e083]/20",
          accentColor: "#54e083"
        };
      case 1:
        return {
          borderClass: "border-[#007aff]/40",
          bgClass: "bg-[#007aff]/5",
          textClass: "text-[#007aff]",
          labelBg: "bg-[#007aff]/15 text-[#007aff] border border-[#007aff]/20",
          accentColor: "#007aff"
        };
      case 2:
        return {
          borderClass: "border-[#53e16f]/40",
          bgClass: "bg-[#53e16f]/5",
          textClass: "text-[#53e16f]",
          labelBg: "bg-[#53e16f]/15 text-[#53e16f] border border-[#53e16f]/20",
          accentColor: "#53e16f"
        };
      case 3:
        return {
          borderClass: "border-[#F5A623]/40",
          bgClass: "bg-[#F5A623]/5",
          textClass: "text-[#F5A623]",
          labelBg: "bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/20",
          accentColor: "#F5A623"
        };
      default:
        return {
          borderClass: "border-white/10",
          bgClass: "bg-white/[0.01]",
          textClass: "text-gray-400",
          labelBg: "bg-white/5 text-gray-400 border border-white/5",
          accentColor: "#20201F"
        };
    }
  };

  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row overflow-hidden bg-transparent">
      <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto scroll-smooth">
        {/* Month Header */}
        <div className="flex justify-between items-center bg-[#131313] p-4 rounded-[8px] border border-white/10 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-mac-blue/10 rounded-[4px] border border-mac-blue/20 text-mac-blue shadow-[0_0_15px_rgba(0,122,255,0.15)]">
              <Calendar size={22} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight font-sans">
                {months[currentMonth]} {currentYear}
              </h3>
              <p className="text-[10px] font-mono tracking-widest text-[#AEAEB2] mt-1 uppercase">
                PRO ATOM PERIODIZATION GRID • ACTIVE CONFLICT MITIGATION
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handlePrevMonth}
              onMouseDown={triggerHaptic}
              className="p-2 bg-[#161616] border border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 hover:text-white rounded-[4px] transition-all active:scale-95 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            
            <button
              onClick={() => {
                setCurrentYear(2026);
                setCurrentMonth(8);
              }}
              onMouseDown={triggerHaptic}
              className="px-4 py-2 bg-white/10 border border-white/10 text-xs font-bold uppercase tracking-wider hover:bg-white/15 text-white rounded-[4px] transition-all cursor-pointer font-sans"
            >
              Today
            </button>

            <button 
              onClick={handleNextMonth}
              onMouseDown={triggerHaptic}
              className="p-2 bg-[#161616] border border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-300 hover:text-white rounded-[4px] transition-all active:scale-95 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Month Grid Container */}
        <div className="space-y-6">
          {(() => {
            const getMesocycleForDate = (dateStr: string) => {
              const curr = new Date(dateStr);
              return mesocycles.find(m => {
                const start = new Date(m.startDate);
                const end = new Date(m.endDate);
                return curr >= start && curr <= end;
              });
            };

            const getMicrocycleForDate = (dateStr: string) => {
              let found = microcycles.find(m => m.workouts.some(w => w.date === dateStr));
              if (found) return found;

              const targetMonStr = getMondayOfDate(dateStr);
              found = microcycles.find(m => 
                m.workouts.some(w => getMondayOfDate(w.date) === targetMonStr)
              );
              return found;
            };

            const weeksList: typeof daysGrid[] = [];
            for (let i = 0; i < daysGrid.length; i += 7) {
              weeksList.push(daysGrid.slice(i, i + 7));
            }

            const groupedMesoWeeks: { meso: MesocycleData | null; weeks: typeof daysGrid[] }[] = [];
            weeksList.forEach(week => {
              const counts = new Map<string, number>();
              let maxCount = 0;
              let dominantMeso: MesocycleData | null = null;

              week.forEach(day => {
                const m = getMesocycleForDate(day.dateString);
                if (m) {
                  const count = (counts.get(m.id) || 0) + 1;
                  counts.set(m.id, count);
                  if (count > maxCount) {
                    maxCount = count;
                    dominantMeso = m;
                  }
                }
              });

              if (groupedMesoWeeks.length > 0 && groupedMesoWeeks[groupedMesoWeeks.length - 1].meso?.id === dominantMeso?.id) {
                groupedMesoWeeks[groupedMesoWeeks.length - 1].weeks.push(week);
              } else {
                groupedMesoWeeks.push({
                  meso: dominantMeso,
                  weeks: [week]
                });
              }
            });

            return groupedMesoWeeks.map((group, groupIdx) => {
              const meso = group.meso;
              
              return (
                <div 
                  key={meso ? meso.id : `ungrouped-meso-${groupIdx}`}
                  className="border border-white/10 rounded-[8px] bg-[#131313] shadow-2xl overflow-hidden ring-1 ring-inset ring-white/5"
                >
                  {/* Mesocycle Container Banner (Macro Phase Tracker) */}
                  {meso ? (
                    <div className="p-4 border-b border-white/5 flex flex-wrap items-center justify-between bg-[#161616]/50 backdrop-blur-sm gap-4">
                      <div className="flex flex-col gap-1 pl-4 relative">
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#54e083] rounded-full shadow-[0_0_12px_rgba(84,224,131,0.6)]" />
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-accent text-[10px] font-bold tracking-widest">MESOCYCLE PHASE</span>
                          <span className="font-mono text-[9px] bg-[#54e083]/15 text-[#54e083] border border-[#54e083]/20 px-2 py-0.5 rounded-[4px] font-bold uppercase">ACTIVE</span>
                        </div>
                        <h4 className="text-base text-white tracking-tight uppercase font-sans font-bold">
                          {meso.name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-gray-400 bg-white/5 border border-white/5 px-3 py-1.5 rounded-[4px] text-xs backdrop-blur-sm">
                          {meso.startDate} - {meso.endDate}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                      <span className="text-sm font-bold uppercase tracking-widest text-amber-400 font-sans">
                        Standard Transition Intermission
                      </span>
                    </div>
                  )}

                  {/* Weeks list inside Mesocycle container */}
                  <div className="p-3 bg-transparent space-y-3">
                    {/* Weekday Headers */}
                    <div className="grid grid-cols-7 gap-2">
                      {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day) => (
                        <div key={day} className="flex justify-start pl-1">
                          <span className="font-mono text-[10px] text-gray-400 font-bold tracking-widest">{day}</span>
                        </div>
                      ))}
                    </div>

                    {group.weeks.map((week, weekIdx) => {
                      const firstDay = week[0].dateString;
                      const weekMicro = getMicrocycleForDate(firstDay);
                      
                      let colorInfo = {
                        borderClass: "border-white/10",
                        bgClass: "bg-white/[0.01]",
                        textClass: "text-gray-400",
                        labelBg: "bg-white/5 text-gray-400 border border-white/5",
                        accentColor: "#20201F"
                      };

                      if (weekMicro) {
                        const microIdx = microcycles.findIndex(m => m.id === weekMicro.id);
                        colorInfo = getMicrocycleColorInfo(microIdx);
                      }

                      return (
                        <div 
                          key={`${firstDay}-${weekIdx}`}
                          className="flex flex-col gap-2 p-2 bg-white/[0.01] border border-white/5 rounded-[8px] transition-all hover:border-white/10"
                        >
                          {/* Shared Periodization Track */}
                          {weekMicro && (
                            <div className="flex items-center justify-between px-3 py-2 bg-[#161616]/80 border border-white/10 rounded-[6px] backdrop-blur-sm">
                              <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorInfo.accentColor }} />
                                  <span className="font-mono text-[9px] text-[#AEAEB2] font-black uppercase tracking-wider">BLOCK:</span>
                                  <span className="text-[11px] font-black text-white uppercase">{meso ? meso.name : 'Alpha-09'}</span>
                                </div>
                                <span className="text-zinc-700">|</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[9px] text-[#AEAEB2] font-black uppercase tracking-wider">MICROCYCLE:</span>
                                  <span className="text-[11px] font-black text-white uppercase" style={{ color: colorInfo.accentColor }}>
                                    {weekMicro.weekName}
                                  </span>
                                  <span className="text-[10px] text-zinc-400">({weekMicro.focus})</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded-[4px] ${colorInfo.labelBg}`}>
                                  {weekMicro.status.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* 7-Day column grid below header */}
                          <div className="grid grid-cols-7 gap-2">
                            {week.map((cell, idx) => {
                              const dateStr = cell.dateString;
                              const isToday = dateStr === '2026-09-16'; // Mocked Today
                              const dayWorkouts = workoutList.filter(item => item.workout.date === dateStr);

                              let cellBorderStyles = `border ${colorInfo.borderClass} rounded-[6px]`;
                              if (!weekMicro) {
                                cellBorderStyles = "border border-white/10 rounded-[6px]";
                              }

                              let labelMicro: (typeof microcycles)[0] | null = null;
                              let workoutRankInMicro = 0;
                              let labelColorInfo = colorInfo;

                              if (dayWorkouts.length > 0) {
                                const firstW = dayWorkouts[0];
                                const wMicro = microcycles.find(m => m.id === firstW.microId);
                                if (wMicro) {
                                  labelMicro = wMicro;
                                  const labelMicroIdx = microcycles.findIndex(m => m.id === wMicro.id);
                                  labelColorInfo = getMicrocycleColorInfo(labelMicroIdx);
                                  const sortedW = [...wMicro.workouts].sort((a, b) => a.date.localeCompare(b.date));
                                  workoutRankInMicro = sortedW.findIndex(w => w.id === firstW.workout.id) + 1;
                                }
                              }

                              return (
                                <div
                                  key={`${dateStr}-${idx}`}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => handleDrop(e, dateStr)}
                                  style={{
                                    backgroundColor: weekMicro && cell.isCurrentMonth
                                      ? `rgba(${hexToRgb(colorInfo.accentColor)}, 0.02)`
                                      : undefined
                                  }}
                                  className={`h-auto min-h-[140px] p-2 flex flex-col relative group cursor-pointer transition-all bg-[#131313]/40 ${cellBorderStyles} hover:bg-white/[0.01] ${
                                    !cell.isCurrentMonth ? 'opacity-30 select-none border-white/5 bg-[#1A1A1E]/30' : ''
                                  } ${isToday ? 'ring-1 ring-mac-blue bg-mac-blue/5 shadow-[0_0_15px_rgba(0,122,255,0.08)]' : ''}`}
                                >
                                  {/* Date label */}
                                  <div className="flex justify-between items-center mb-2 relative z-10">
                                    <span className={`text-[11px] font-mono font-bold leading-none ${isToday ? 'text-mac-blue' : 'text-gray-400'}`}>
                                      {String(cell.dayNumber).padStart(2, '0')}
                                    </span>
                                    {labelMicro && workoutRankInMicro > 0 && (
                                      <span className={`font-mono text-[8px] px-1.5 py-0.5 rounded-[4px] font-bold ${labelColorInfo.labelBg}`}>
                                        D{workoutRankInMicro}
                                      </span>
                                    )}
                                  </div>

                                  {/* Workout Slots */}
                                  {cell.isCurrentMonth && dayWorkouts
                                    .filter(item => {
                                      if (filter === 'All') return true;
                                      const hasSquat = item.workout.exercises.some(e => e.title.toLowerCase().includes('squat'));
                                      const hasBench = item.workout.exercises.some(e => e.title.toLowerCase().includes('bench'));
                                      const hasDeadlift = item.workout.exercises.some(e => e.title.toLowerCase().includes('deadlift') || e.title.toLowerCase().includes('dead'));
                                      if (filter === 'Squat') return hasSquat;
                                      if (filter === 'Bench') return hasBench;
                                      if (filter === 'Deadlift') return hasDeadlift;
                                      return false;
                                    })
                                    .map(({ workout, microId }) => {
                                      const isSelected = selectedWorkout?.workout.id === workout.id;
                                      return (
                                        <div
                                          key={workout.id}
                                          draggable
                                          onDragStart={(e) => handleDragStart(e, workout.id, microId)}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedWorkout({ workout, microId });
                                            onViewSession(workout, microId);
                                          }}
                                          className={`mt-3 border rounded-[8px] flex-1 flex flex-col backdrop-blur-sm overflow-hidden relative z-10 p-2 gap-2 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all ${
                                            isSelected 
                                              ? 'bg-[#1C1C1E] border-mac-blue shadow-[0_0_12px_rgba(0,122,255,0.15)]' 
                                              : 'bg-[#161616] border-[#20201F] hover:bg-[#1C1C1E]'
                                          }`}
                                        >
                                          <div className="flex flex-col gap-2">
                                            {workout.exercises.map((ex) => {
                                              const isSquat = ex.title.toLowerCase().includes('squat');
                                              const isBench = ex.title.toLowerCase().includes('bench');
                                              const movementName = isSquat ? 'SQUAT' : (isBench ? 'BENCH' : 'DEADLIFT');
                                              
                                              const movementColorClass = isSquat 
                                                ? 'text-mac-blue' 
                                                : (isBench 
                                                  ? 'text-accent' 
                                                  : 'text-[#F5A623]');
                                              
                                              const targetSet = ex.sets[0];
                                              const plannedW = targetSet?.plannedWeight || '---';
                                              const plannedR = targetSet?.plannedReps || '—';
                                              const plannedRp = targetSet?.plannedRpe || '—';
                                              
                                              const actualW = targetSet?.actual || '';
                                              const actualR = targetSet?.reps || '';
                                              const actualRp = targetSet?.executedRpe || '';

                                              return (
                                                <div key={ex.id} className="flex flex-col border-b border-white/5 pb-1.5 last:border-0 last:pb-0">
                                                  <div className="flex flex-col">
                                                    <span className={`text-[10px] font-bold leading-tight font-sans ${movementColorClass}`}>{movementName}</span>
                                                    <span className="text-[8px] text-gray-500 font-mono mt-0.5">e1RM: {ex.top?.split(' ')[0] || '—'}</span>
                                                  </div>
                                                  <span className="text-[9px] text-gray-400 leading-normal mt-1 font-mono">
                                                    Presc: {plannedW}kg x {plannedR} @ {plannedRp}
                                                  </span>
                                                  <div className="flex items-center justify-between text-[10px] leading-normal mt-1.5 pt-1 border-t border-white/5">
                                                    <span className="text-gray-300 font-bold text-[9px] font-mono">
                                                      {actualW ? `${actualW}kg x ${actualR} @ ${actualRp}` : 'Pending'}
                                                    </span>
                                                    {workout.status === 'Completed' && (
                                                      <span className="bg-accent/20 text-accent border border-accent/30 px-1 py-0.5 rounded-[2px] text-[8px] font-black font-mono leading-none shrink-0 ml-1">[✓]</span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* Legend */}
        <div className="flex justify-between items-center bg-[#131313] p-4 border border-white/10 rounded-[8px] text-xs text-gray-400 font-sans">
          <div className="flex items-center gap-4">
            <span className="font-bold flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(84,224,131,0.4)]" /> COMPLETED</span>
            <span className="font-bold flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-mac-blue shadow-[0_0_8px_rgba(0,122,255,0.4)] animate-pulse" /> TODAY</span>
            <span className="font-bold flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-gray-500" /> PLANNED</span>
          </div>
          <div className="italic text-right text-[11px] font-mono font-bold text-amber-400 tracking-wider">
            💡 DRAG WORKOUT BUBBLE TO RESCHEDULE • AUTOREG MECHANISM LOCKS PACING
          </div>
        </div>
      </div>

      {/* Slide-out Session Analysis Side Panel */}
      <AnimatePresence>
        {selectedWorkout && (
          <motion.aside
            initial={{ x: 450, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 450, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 220 }}
            className="w-[420px] border-l border-white/10 bg-[#131313] flex flex-col z-20 h-full shadow-[0_0_40px_rgba(0,0,0,0.5)] shrink-0"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-start">
              <div>
                <span className="font-mono text-[#54e083] text-[10px] font-bold tracking-widest block mb-1">SESSION ANALYSIS</span>
                <h3 className="text-xl font-bold text-white tracking-tight uppercase leading-tight">
                  {selectedWorkout.workout.title}
                </h3>
                <div className="flex gap-2 mt-2 items-center">
                  <span className="font-mono text-[11px] text-gray-400">
                    {selectedWorkout.workout.date}
                  </span>
                  <span className="text-gray-600">•</span>
                  <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded-[4px] ${
                    selectedWorkout.workout.status === 'Completed' 
                      ? 'bg-[#54e083]/15 text-[#54e083] border border-[#54e083]/20' 
                      : 'bg-white/5 text-gray-400 border border-white/5'
                  }`}>
                    {selectedWorkout.workout.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setSelectedWorkout(null)}
                className="p-1.5 hover:bg-white/5 text-gray-400 hover:text-white rounded-[4px] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined !text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-3 border border-white/10 bg-[#161616] rounded-[8px] overflow-hidden">
                <div className="p-4 border-r border-white/10 text-center">
                  <p className="font-mono text-[9px] text-gray-400 font-bold tracking-widest uppercase mb-1">TOTAL VOL</p>
                  <p className="font-mono text-sm font-bold text-white">
                    {selectedWorkout.workout.tonnage.toLocaleString()} kg
                  </p>
                </div>
                <div className="p-4 border-r border-white/10 text-center">
                  <p className="font-mono text-[9px] text-gray-400 font-bold tracking-widest uppercase mb-1">TIME</p>
                  <p className="font-mono text-sm font-bold text-white">
                    {selectedWorkout.workout.status === 'Completed' ? '74 MIN' : '—'}
                  </p>
                </div>
                <div className="p-4 text-center">
                  <p className="font-mono text-[9px] text-gray-400 font-bold tracking-widest uppercase mb-1">RPE AVG</p>
                  <p className="font-mono text-sm font-bold text-[#54e083]">
                    {selectedWorkout.workout.status === 'Completed' ? '8.2' : '—'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="font-mono text-[10px] text-gray-400 font-bold tracking-widest uppercase">
                  EXERCISE LOG: PLANNED VS EXECUTED
                </p>
                <div className="border border-white/10 bg-[#161616] rounded-[8px] overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-white/5 border-b border-white/10">
                        <th className="px-3 py-2.5 font-mono text-[9px] text-gray-400 font-bold uppercase">EXERCISE</th>
                        <th className="px-3 py-2.5 font-mono text-[9px] text-gray-400 font-bold uppercase">TARGET</th>
                        <th className="px-3 py-2.5 font-mono text-[9px] text-gray-400 font-bold uppercase text-right">ACTUAL</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[11px] divide-y divide-white/5">
                      {selectedWorkout.workout.exercises.map((ex) => {
                        const targetSet = ex.sets[0];
                        const plannedW = targetSet?.plannedWeight || '---';
                        const plannedR = targetSet?.plannedReps || '—';
                        const plannedRp = targetSet?.plannedRpe || '—';
                        
                        const actualW = targetSet?.actual || '';
                        const actualR = targetSet?.reps || '';
                        const actualRp = targetSet?.executedRpe || '';

                        return (
                          <tr key={ex.id} className="hover:bg-white/[0.01]">
                            <td className="px-3 py-3 font-sans font-bold text-white leading-tight">{ex.title}</td>
                            <td className="px-3 py-3 text-gray-400">{plannedW}kg x {plannedR} @ {plannedRp}</td>
                            <td className="px-3 py-3 text-right font-bold text-[#54e083]">
                              {actualW ? `${actualW}kg x ${actualR} @ ${actualRp}` : 'Pending'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-4 border border-white/10 bg-[#161616] rounded-[8px] space-y-2">
                <div className="flex items-center gap-2 text-amber-400">
                  <span className="material-symbols-outlined !text-[16px]">notes</span>
                  <span className="font-mono text-[9px] font-bold tracking-widest uppercase">COACH'S NOTES</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {selectedWorkout.workout.status === 'Completed' 
                    ? "Excellent depth on the final squat set. The progression was handled well. Peripheral fatigue seems managed. Maintain active pacing."
                    : "Focus on static brace stability off the floor. Keep vertical bar path linear. Ensure 1-sec pause on bench presses is strictly static."}
                </p>
              </div>

              <div className="p-4 border border-white/10 bg-[#161616] rounded-[8px] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#54e083]">
                    <span className="material-symbols-outlined !text-[16px]">monitoring</span>
                    <span className="font-mono text-[9px] font-bold tracking-widest uppercase">BIOMECHANICAL TRACE</span>
                  </div>
                  <span className="font-mono text-[8px] text-gray-500 uppercase">SET 3 PROFILE</span>
                </div>
                <div className="h-28 w-full border border-white/5 rounded bg-black/40 flex items-center justify-center p-2 relative overflow-hidden">
                  <svg className="w-full h-full" viewBox="0 0 100 40">
                    <defs>
                      <linearGradient id="trace-glow" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#007aff" stopOpacity="0.1" />
                        <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#007aff" stopOpacity="0.1" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 5,20 C 15,5 25,35 35,15 C 45,5 55,30 65,10 C 75,25 85,15 95,20"
                      fill="none"
                      stroke="url(#trace-glow)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <line x1="20" y1="0" x2="20" y2="40" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="1 1" />
                    <line x1="40" y1="0" x2="40" y2="40" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="1 1" />
                    <line x1="60" y1="0" x2="60" y2="40" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="1 1" />
                    <line x1="80" y1="0" x2="80" y2="40" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="1 1" />
                  </svg>
                  <div className="absolute bottom-1 left-2 font-mono text-[8px] text-gray-500">VELOCITY (M/S)</div>
                  <div className="absolute top-1 right-2 font-mono text-[8px] text-[#54e083]">AVG: 0.52m/s</div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-white/5 bg-[#161616] flex gap-3">
              <button 
                onClick={() => onViewSession(selectedWorkout.workout, selectedWorkout.microId)}
                onMouseDown={triggerHaptic}
                className="flex-1 py-3 bg-mac-blue hover:bg-blue-600 text-white text-xs font-bold uppercase tracking-widest rounded-[4px] transition-all cursor-pointer text-center font-sans"
              >
                LAUNCH SESSION LOGGER
              </button>
              <button 
                onClick={async () => {
                  try {
                    const blob = await apiService.downloadExportCSV(filter);
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `obsidian_kinetic_export_${filter.toLowerCase()}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    alert('Failed to download CSV export. Please check server connection.');
                  }
                }}
                onMouseDown={triggerHaptic}
                className="px-3 py-3 border border-white/10 hover:border-[#54e083] hover:bg-[#54e083]/5 text-[#54e083] text-[11px] font-bold uppercase tracking-widest rounded-[4px] transition-colors cursor-pointer font-sans"
              >
                CSV
              </button>
              <button 
                onClick={async () => {
                  try {
                    const blob = await apiService.downloadExportJSON();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'obsidian_kinetic_export.json';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    alert('Failed to download JSON export. Please check server connection.');
                  }
                }}
                onMouseDown={triggerHaptic}
                className="px-3 py-3 border border-white/10 hover:border-mac-blue hover:bg-mac-blue/5 text-mac-blue text-[11px] font-bold uppercase tracking-widest rounded-[4px] transition-colors cursor-pointer font-sans"
              >
                JSON
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Conflict Decision Modal */}
      <AnimatePresence>
        {conflictModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-6">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#131313] border border-white/10 rounded-[8px] max-w-md w-full shadow-2xl p-6"
            >
              <div className="flex items-center gap-3 text-orange-500 mb-4 bg-orange-500/10 p-3 rounded-[4px] border border-orange-500/20">
                <AlertTriangle size={20} />
                <h4 className="text-sm font-bold uppercase tracking-wider text-white font-sans">Periodization Conflict</h4>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed mb-6 font-sans">
                You are rescheduling <strong className="text-white">{conflictModal.workout.title}</strong> by {Math.abs(conflictModal.daysDiff)} {Math.abs(conflictModal.daysDiff) === 1 ? 'day' : 'days'} {conflictModal.daysDiff > 0 ? 'forward' : 'backward'} to <strong className="text-white">{conflictModal.newDate}</strong>.
                This action exceeds standard tactical variance limits.
              </p>

              <div className="space-y-3 mb-6">
                <button
                  type="button"
                  onClick={() => executeMove(
                    conflictModal.workout,
                    conflictModal.sourceMicroId,
                    conflictModal.newDate,
                    true,
                    conflictModal.daysDiff
                  )}
                  onMouseDown={triggerHaptic}
                  className="w-full flex items-center justify-between p-4 bg-mac-blue/10 hover:bg-mac-blue/15 text-mac-blue border border-mac-blue/30 rounded-[4px] text-left transition-all group cursor-pointer font-sans"
                >
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider block text-white group-hover:text-mac-blue mb-1">
                      Cascading Shift
                    </span>
                    <span className="text-[10px] text-gray-400 block normal-case">
                      Shift all subsequent workouts in this microcycle by {conflictModal.daysDiff} days to protect periodization intervals.
                    </span>
                  </div>
                  <ChevronRight size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => executeMove(
                    conflictModal.workout,
                    conflictModal.sourceMicroId,
                    conflictModal.newDate,
                    false,
                    0
                  )}
                  onMouseDown={triggerHaptic}
                  className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-[4px] text-left transition-all group cursor-pointer font-sans"
                >
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider block text-white group-hover:text-mac-blue mb-1">
                      Granular Adjust Only
                    </span>
                    <span className="text-[10px] text-gray-400 block normal-case">
                      Schedule changes apply ONLY to this session. Creates standard recovery overshoots or overlaps.
                    </span>
                  </div>
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={cancelMove}
                  onMouseDown={triggerHaptic}
                  className="px-4 py-2 bg-transparent text-xs font-bold uppercase tracking-widest text-[#8E8E93] hover:text-white transition-colors cursor-pointer font-sans"
                >
                  Abort Rescheduling
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
export const SampleDefault = () => (
  <MonthGridView 
    microcycles={[]} 
    mesocycles={[]} 
    onUpdateWorkouts={() => {}} 
    onViewSession={() => {}} 
    filter="All"
  />
);

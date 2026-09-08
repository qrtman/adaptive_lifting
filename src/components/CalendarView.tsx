import React, { useRef, useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MesocycleData, WorkoutData, isWorkoutCompleted } from '../types';
import { apiService } from '../services/api';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';

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

interface CalendarViewProps {
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: LiftFilterValue;
  onFilterChange: (value: LiftFilterValue) => void;
}

export function CalendarView({
  onViewSession,
  filter,
  onFilterChange,
}: CalendarViewProps) {
  const { microcycles, mesocycles, setMicrocycles } = usePeriodization();
  const onUpdateWorkouts = setMicrocycles;
  // Navigation states (we start in September 2026)
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(8); // September is 8 (0-indexed)

  // Drag and drop states
  const [draggedWorkoutId, setDraggedWorkoutId] = useState<string | null>(null);
  const [draggedFromMicrocycleId, setDraggedFromMicrocycleId] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ workoutId: string; microId: string } | null>(null);
  const [boundaryLockVisible, setBoundaryLockVisible] = useState(false);
  const [boundaryFlashDate, setBoundaryFlashDate] = useState<string | null>(null);
  
  // Conflict Prompt states
  const [conflictModal, setConflictModal] = useState<{
    workout: WorkoutData;
    sourceMicroId: string;
    newDate: string;
    daysDiff: number;
    conflictType: 'overlap' | 'periodization_breach' | 'normal';
  } | null>(null);

  // Added state for high-fidelity Stitch Side Panel Session Analysis
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

  // Helper date logic
  const daysInMonthCount = new Date(currentYear, currentMonth + 1, 0).getDate();
  const rawFirstDayNo = new Date(currentYear, currentMonth, 1).getDay();
  // Adjust so Monday is 0, Sunday is 6
  const startDayOffset = (rawFirstDayNo + 6) % 7;

  // Build grid entries
  const daysGrid: { dateString: string; dayNumber: number; isCurrentMonth: boolean }[] = [];
  
  // Padding for start of month
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

  // Current month days
  for (let d = 1; d <= daysInMonthCount; d++) {
    daysGrid.push({
      dateString: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayNumber: d,
      isCurrentMonth: true
    });
  }

  // Padding for end of month to make multiples of 7
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

  // Flatten all workouts with their microcycle reference for easier query mapping
  const workoutList: { workout: WorkoutData; microId: string }[] = [];
  microcycles.forEach(micro => {
    micro.workouts.forEach(w => {
      workoutList.push({ workout: w, microId: micro.id });
    });
  });

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, workoutId: string, microId: string) => {
    dragPayloadRef.current = { workoutId, microId };
    setDraggedWorkoutId(workoutId);
    setDraggedFromMicrocycleId(microId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ workoutId, microId }));
  };

  const readDragPayload = (e: React.DragEvent): { workoutId: string; microId: string } | null => {
    if (dragPayloadRef.current) return dragPayloadRef.current;
    if (draggedWorkoutId && draggedFromMicrocycleId) {
      return { workoutId: draggedWorkoutId, microId: draggedFromMicrocycleId };
    }
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { workoutId?: string; microId?: string };
      if (parsed.workoutId && parsed.microId) {
        return { workoutId: parsed.workoutId, microId: parsed.microId };
      }
    } catch {
      return null;
    }
    return null;
  };

  const handleDrop = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload) return;
    const { workoutId, microId } = payload;

    // Find dragged workout
    let targetWorkout: WorkoutData | null = null;
    microcycles.forEach(m => {
      m.workouts.forEach(w => {
        if (w.id === workoutId) {
          targetWorkout = w;
        }
      });
    });

    if (!targetWorkout) return;

    const sourceDateStr = (targetWorkout as WorkoutData).date;
    if (sourceDateStr === targetDate) return; // Dropped on same day

    // Restrict dragging across microcycle boundaries to preserve periodization integrity
    const dropMon = getMondayOfDate(targetDate);
    const origMon = getMondayOfDate(sourceDateStr);

    if (dropMon !== origMon) {
      setBoundaryLockVisible(true);
      setBoundaryFlashDate(sourceDateStr);
      dragPayloadRef.current = null;
      setDraggedWorkoutId(null);
      setDraggedFromMicrocycleId(null);
      return;
    }

    const sourceDate = new Date(sourceDateStr);
    const dropDate = new Date(targetDate);
    const diffTime = Math.abs(dropDate.getTime() - sourceDate.getTime());
    const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) * (dropDate > sourceDate ? 1 : -1);

    // Look for scheduling conflict (workout on the same target date)
    const existingWorkoutOnTarget = workoutList.find(item => item.workout.date === targetDate);
    
    const currentMicro = microcycles.find(m => m.id === microId);
    const isPeriodizationBreach = Boolean(currentMicro && Math.abs(daysDiff) > 7);

    setBoundaryLockVisible(false);
    setBoundaryFlashDate(null);

    if (existingWorkoutOnTarget || isPeriodizationBreach || Math.abs(daysDiff) > 3) {
      setConflictModal({
        workout: targetWorkout,
        sourceMicroId: microId,
        newDate: targetDate,
        daysDiff: daysDiff,
        conflictType: existingWorkoutOnTarget ? 'overlap' : 'periodization_breach'
      });
    } else {
      executeMove(targetWorkout, microId, targetDate, false, 0);
    }

    dragPayloadRef.current = null;
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

      // Update workouts inside the matching microcycle
      const updatedWorkouts = m.workouts.map(w => {
        if (w.id === workout.id) {
          return { ...w, date: newDate };
        }
        
        // If cascading, we shift all subsequent workouts (chronologically after the current workout's original date) by N days
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
    dragPayloadRef.current = null;
  };

  const cancelMove = () => {
    setConflictModal(null);
    dragPayloadRef.current = null;
    setDraggedWorkoutId(null);
    setDraggedFromMicrocycleId(null);
  };

  // Helper to fetch microcycle visual specs based on index
  const getMicrocycleColorInfo = (microIdx: number) => {
    switch (microIdx) {
      case 0: // Microcycle 1: Jade
        return {
          borderClass: "border-[#54e083]",
          bgClass: "bg-[#54e083]/5",
          textClass: "text-[#54e083]",
          labelBg: "bg-[#54e083]/15 text-[#54e083] border border-[#54e083]/20",
          accentColor: "#54e083"
        };
      case 1: // Microcycle 2: RTS Comp Blue
        return {
          borderClass: "border-[#007aff]",
          bgClass: "bg-[#007aff]/5",
          textClass: "text-[#007aff]",
          labelBg: "bg-[#007aff]/15 text-[#007aff] border border-[#007aff]/20",
          accentColor: "#007aff"
        };
      case 2: // Microcycle 3: Supercompensation Green
        return {
          borderClass: "border-[#53e16f]",
          bgClass: "bg-[#53e16f]/5",
          textClass: "text-[#53e16f]",
          labelBg: "bg-[#53e16f]/15 text-[#53e16f] border border-[#53e16f]/20",
          accentColor: "#53e16f"
        };
      case 3: // Microcycle 4: CNS Warning Orange
        return {
          borderClass: "border-[#F5A623]",
          bgClass: "bg-[#F5A623]/5",
          textClass: "text-[#F5A623]",
          labelBg: "bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/20",
          accentColor: "#F5A623"
        };
      default:
        return {
          borderClass: "border-[#20201F]",
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
    <div className="flex-1 flex overflow-hidden bg-[#0A0A0A]">
      {/* Left Pane: Scrollable Calendar Grid */}
      <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm text-white">
              {months[currentMonth]} {currentYear}
            </h3>
            <button type="button" onClick={handlePrevMonth} className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white">
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentYear(2026);
                setCurrentMonth(8);
              }}
              className="h-7 px-2 text-xs text-[#AEAEB2] hover:text-white"
            >
              Today
            </button>
            <button type="button" onClick={handleNextMonth} className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white">
              <ChevronRight size={16} />
            </button>
          </div>
          <LiftFilter value={filter} onChange={onFilterChange} />
        </div>

        {boundaryLockVisible && (
          <div
            data-testid="calendar-boundary-lock"
            role="alert"
            className="border border-[#FF453A]/50 bg-[#FF453A]/10 text-[#FF453A] px-3 py-1.5 rounded font-mono text-xs"
          >
            Periodization Boundary Lock: Workouts cannot be dragged across microcycle week boundaries.
          </div>
        )}

        {/* Calendar Grid Container */}
        <div className="space-y-3">
          {(() => {
            // Helpers for periodized entity resolution
            const getMesocycleForDate = (dateStr: string) => {
              const curr = new Date(dateStr);
              return mesocycles.find(m => {
                const start = new Date(m.startDate);
                const end = new Date(m.endDate);
                return curr >= start && curr <= end;
              });
            };

            // Group the daysGrid into 7-day weeks
            const weeksList: typeof daysGrid[] = [];
            for (let i = 0; i < daysGrid.length; i += 7) {
              weeksList.push(daysGrid.slice(i, i + 7));
            }

            // Group consecutive weeks by dominant Mesocycle
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
                  className="border border-white/10 rounded overflow-hidden bg-[#131313]"
                >
                  {meso ? (
                    <div className="h-8 px-2 border-b border-white/10 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1 h-4 rounded bg-[#54e083] shrink-0" />
                        <h4 className="text-xs text-white truncate">{meso.name}</h4>
                        <span className="text-[10px] font-mono text-[#AEAEB2] shrink-0">mesocycle</span>
                      </div>
                      <span className="font-mono text-[10px] text-[#AEAEB2] shrink-0">
                        {meso.startDate} – {meso.endDate}
                      </span>
                    </div>
                  ) : (
                    <div className="h-8 px-2 border-b border-white/10 flex items-center">
                      <span className="text-xs text-amber-400">Transition</span>
                    </div>
                  )}

                  <div className="p-2 space-y-2">
                    <div className="grid grid-cols-7 gap-0">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                        <div key={day} className="pb-1 pl-1.5">
                          <span className="font-mono text-[10px] text-[#AEAEB2]">{day}</span>
                        </div>
                      ))}
                    </div>

                    {group.weeks.map((week, weekIdx) => {
                      const firstDay = week[0].dateString;

                      return (
                        <div 
                          key={`${firstDay}-${weekIdx}`}
                          className="grid grid-cols-7 gap-0"
                        >
                          {week.map((cell) => {
                            const dateStr = cell.dateString;
                            const dayWorkouts = workoutList.filter(item => item.workout.date === dateStr);

                            // Day label & rank calculation for workouts
                            let labelMicro: (typeof microcycles)[0] | null = null;
                            let workoutRankInMicro = 0;
                            let labelColorInfo = {
                              labelBg: "bg-white/5 text-[#AEAEB2] border border-white/10",
                            };

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
                                key={dateStr}
                                data-testid={`calendar-day-${dateStr}`}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => handleDrop(e, dateStr)}
                                className={`h-auto min-h-[128px] p-1.5 flex flex-col relative group cursor-pointer transition-colors bg-[#131313] border border-white/10 ${
                                  !cell.isCurrentMonth ? 'opacity-20 select-none !border-transparent bg-transparent' : ''
                                } ${
                                  boundaryFlashDate === dateStr ? 'ring-2 ring-[#FF453A] bg-[#FF453A]/10' : ''
                                }`}
                              >
                                <div className="flex items-center gap-1.5 relative z-10 mb-1">
                                  <span className="font-mono text-[11px] text-[#AEAEB2]">
                                    {String(cell.dayNumber).padStart(2, '0')}
                                  </span>
                                  {labelMicro && workoutRankInMicro > 0 && (
                                    <span className={`font-mono text-[9px] px-1 rounded ${labelColorInfo.labelBg}`}>
                                      W{microcycles.indexOf(labelMicro) + 1}·D{workoutRankInMicro}
                                    </span>
                                  )}
                                </div>
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
                                        data-testid={`workout-card-${workout.id}`}
                                        draggable
                                        onDragOver={(e) => e.preventDefault()}
                                        onDragStart={(e) => handleDragStart(e, workout.id, microId)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedWorkout({ workout, microId });
                                        }}
                                        className={`mt-1 border rounded flex flex-col overflow-hidden relative z-10 p-1.5 gap-0.5 cursor-grab active:cursor-grabbing ${
                                          isSelected 
                                            ? 'bg-[#1C1C1E] border-[#007AFF]' 
                                            : 'bg-[#161616] border-white/10 hover:border-white/20'
                                        }`}
                                      >
                                        <div className="flex flex-col gap-0.5">
                                          {workout.exercises.map((ex) => {
                                            const isSquat = ex.title.toLowerCase().includes('squat');
                                            const isBench = ex.title.toLowerCase().includes('bench');
                                            const movementName = isSquat ? 'SQ' : (isBench ? 'BP' : 'DL');
                                            
                                            const movementColorClass = isSquat 
                                              ? 'text-[#007aff]'
                                              : (isBench 
                                                ? 'text-[#54e083]'
                                                : 'text-[#F5A623]');
                                            
                                            const targetSet = ex.sets[0];
                                            const plannedW = targetSet?.plannedWeight || '—';
                                            const plannedR = targetSet?.plannedReps || '—';
                                            const plannedRp = targetSet?.plannedRpe || '—';
                                            
                                            const actualW = targetSet?.actual || '';
                                            const actualR = targetSet?.reps || '';
                                            const actualRp = targetSet?.executedRpe || '';
                                            const logged = actualW
                                              ? `${actualW}×${actualR}@${actualRp}`
                                              : `${plannedW}×${plannedR}@${plannedRp}`;

                                            return (
                                              <div key={ex.id} className="flex items-center justify-between gap-1 font-mono text-[10px] leading-tight">
                                                <span className={`${movementColorClass} shrink-0`}>{movementName}</span>
                                                <span className={`truncate ${actualW ? 'text-white' : 'text-[#AEAEB2]'}`}>
                                                  {logged}
                                                </span>
                                                {isWorkoutCompleted(workout.status) && (
                                                  <span className="text-[#54e083] shrink-0">✓</span>
                                                )}
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
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        <div className="h-8 px-2 flex items-center justify-between gap-3 text-[10px] text-[#AEAEB2] border border-white/10 rounded">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#54e083]" /> Done</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> Planned</span>
          </div>
          <span className="font-mono truncate">Drag within microcycle week · boundary lock across weeks</span>
        </div>
      </div>

      {/* Slide-out Session Analysis Side Panel (Stitch Premium Detail View Refinement) */}
      <AnimatePresence>
        {selectedWorkout && (
          <motion.aside
            initial={{ x: 450, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 450, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 220 }}
            className="w-[360px] border-l border-white/10 bg-[#131313] flex flex-col z-20 h-full shrink-0"
          >
            <div className="px-3 py-2 border-b border-white/10 flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h3 className="text-sm text-white truncate">
                  {selectedWorkout.workout.title}
                </h3>
                <div className="flex gap-2 mt-0.5 items-center text-[11px] font-mono text-[#AEAEB2]">
                  <span>{selectedWorkout.workout.date}</span>
                  <span className={
                    isWorkoutCompleted(selectedWorkout.workout.status) ? 'text-[#54e083]' : ''
                  }>
                    {selectedWorkout.workout.status}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setSelectedWorkout(null)}
                className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
              >
                <span className="material-symbols-outlined !text-[18px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="h-8 px-2 flex items-center justify-between gap-3 border border-white/10 rounded text-[11px] font-mono">
                <span className="text-[#AEAEB2]">Vol <span className="text-white">{selectedWorkout.workout.tonnage.toLocaleString()}kg</span></span>
                <span className="text-[#AEAEB2]">Sets <span className="text-white">{selectedWorkout.workout.exercises.reduce((n, e) => n + e.sets.length, 0)}</span></span>
                <span className="text-[#AEAEB2]">Lifts <span className="text-white">{selectedWorkout.workout.exercises.length}</span></span>
              </div>

              <div className="border border-white/10 rounded overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-2 py-1.5 font-mono text-[10px] text-[#AEAEB2] font-normal">Exercise</th>
                      <th className="px-2 py-1.5 font-mono text-[10px] text-[#AEAEB2] font-normal">Target</th>
                      <th className="px-2 py-1.5 font-mono text-[10px] text-[#AEAEB2] font-normal text-right">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[11px]">
                    {selectedWorkout.workout.exercises.map((ex) => {
                      const targetSet = ex.sets[0];
                      const plannedW = targetSet?.plannedWeight || '—';
                      const plannedR = targetSet?.plannedReps || '—';
                      const plannedRp = targetSet?.plannedRpe || '—';
                      
                      const actualW = targetSet?.actual || '';
                      const actualR = targetSet?.reps || '';
                      const actualRp = targetSet?.executedRpe || '';

                      return (
                        <tr key={ex.id} className="border-b border-white/5 last:border-0">
                          <td className="px-2 py-1.5 text-white truncate max-w-[110px]">{ex.title}</td>
                          <td className="px-2 py-1.5 text-[#AEAEB2] whitespace-nowrap">{plannedW}×{plannedR}@{plannedRp}</td>
                          <td className="px-2 py-1.5 text-right text-[#54e083] whitespace-nowrap">
                            {actualW ? `${actualW}×${actualR}@${actualRp}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-[#AEAEB2] leading-snug px-0.5">
                {isWorkoutCompleted(selectedWorkout.workout.status) 
                  ? "Logged session. Open week to review or adjust sets."
                  : "Focus brace and bar path. Open week to record sets."}
              </p>
            </div>

            <div className="p-2 border-t border-white/10 flex gap-1.5">
              <button 
                onClick={() => onViewSession(selectedWorkout.workout, selectedWorkout.microId)}
                onMouseDown={triggerHaptic}
                className="flex-1 h-8 bg-[#007AFF] hover:bg-[#0066d6] text-white text-xs rounded"
              >
                Open week
              </button>
              <button 
                onClick={async () => {
                  try {
                    const blob = await apiService.downloadExportCSV(filter);
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `adaptive_lifting_export_${filter.toLowerCase()}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    alert('Failed to download CSV export. Please check server connection.');
                  }
                }}
                onMouseDown={triggerHaptic}
                className="h-8 px-2 border border-white/10 text-[#54e083] text-xs rounded"
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
                    a.download = 'adaptive_lifting_export.json';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    alert('Failed to download JSON export. Please check server connection.');
                  }
                }}
                onMouseDown={triggerHaptic}
                className="h-8 px-2 border border-white/10 text-[#007AFF] text-xs rounded"
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
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-[#131313] border border-white/10 rounded max-w-md w-full p-4"
            >
              <div className="flex items-center gap-2 text-orange-500 mb-3">
                <AlertTriangle size={16} />
                <h4 className="text-sm text-white">Periodization conflict</h4>
              </div>

              <p className="text-xs text-[#AEAEB2] leading-relaxed mb-4">
                Rescheduling <strong className="text-white">{conflictModal.workout.title}</strong> by {Math.abs(conflictModal.daysDiff)} {Math.abs(conflictModal.daysDiff) === 1 ? 'day' : 'days'} {conflictModal.daysDiff > 0 ? 'forward' : 'backward'} to <strong className="text-white">{conflictModal.newDate}</strong>.
              </p>

              <div className="space-y-2 mb-4">
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
                  className="w-full flex items-center justify-between p-3 bg-[#007AFF]/10 hover:bg-[#007AFF]/15 border border-[#007AFF]/30 rounded text-left"
                >
                  <div>
                    <span className="text-xs text-white block mb-0.5">Cascading shift</span>
                    <span className="text-[10px] text-[#AEAEB2] block">
                      Move later workouts in this microcycle by {conflictModal.daysDiff} days.
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-[#007AFF]" />
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
                  className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-left"
                >
                  <div>
                    <span className="text-xs text-white block mb-0.5">This session only</span>
                    <span className="text-[10px] text-[#AEAEB2] block">
                      Leave other workouts where they are.
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-[#AEAEB2]" />
                </button>
              </div>

              <div className="flex justify-end border-t border-white/10 pt-3">
                <button
                  type="button"
                  onClick={cancelMove}
                  onMouseDown={triggerHaptic}
                  className="h-7 px-2 text-xs text-[#AEAEB2] hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

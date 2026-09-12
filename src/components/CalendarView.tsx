import React, { useEffect, useRef, useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MesocycleData, WorkoutData, isWorkoutCompleted } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import { NewSessionDialog } from './NewSessionDialog';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';
import { apiService } from '../services/api';

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
  const { microcycles, mesocycles, setMicrocycles, activeAthleteId, reloadMicrocycles } = usePeriodization();
  const { user } = useAuth();
  const onUpdateWorkouts = setMicrocycles;
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const showCoachSelectAthlete = isCoach && !activeAthleteId;
  // Navigation states (we start in September 2026)
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(8); // September is 8 (0-indexed)

  // Drag and drop states
  const [draggedWorkoutId, setDraggedWorkoutId] = useState<string | null>(null);
  const [draggedFromMicrocycleId, setDraggedFromMicrocycleId] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ workoutId: string; microId: string } | null>(null);

  const [conflictModal, setConflictModal] = useState<{
    workout: WorkoutData;
    sourceMicroId: string;
    newDate: string;
    daysDiff: number;
    conflictType: 'overlap' | 'periodization_breach' | 'normal';
  } | null>(null);

  const [newSessionDate, setNewSessionDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [copySource, setCopySource] = useState<WorkoutData | null>(null);
  const [copyWithLogs, setCopyWithLogs] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

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

  const openNewSession = (dateStr: string) => {
    if (showCoachSelectAthlete || copySource) return;
    setNewSessionDate(dateStr);
  };

  const cancelCopyTo = () => {
    setCopySource(null);
    setCopyBusy(false);
    setCopyError(null);
  };

  const copyToDate = async (dateStr: string) => {
    if (!copySource || copyBusy || showCoachSelectAthlete) return;
    if (dateStr === copySource.date) {
      setCopyError('Pick a different day.');
      return;
    }
    setCopyBusy(true);
    setCopyError(null);
    const start = new Date(`${copySource.date}T00:00:00`);
    const end = new Date(`${dateStr}T00:00:00`);
    const offset = Math.round((end.getTime() - start.getTime()) / 86400000);
    try {
      await apiService.copyWeek({
        sessionIds: [copySource.id],
        athleteId: activeAthleteId || undefined,
        dateOffsetDays: offset,
        targetBlockLabel: copySource.blockLabel ?? null,
        targetWeekLabel: copySource.weekLabel ?? null,
        includeLogs: copyWithLogs,
      });
      await reloadMicrocycles(activeAthleteId);
      cancelCopyTo();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy');
      setCopyBusy(false);
    }
  };

  useEffect(() => {
    if (!copySource) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelCopyTo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copySource]);

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

    const sourceDate = new Date(sourceDateStr);
    const dropDate = new Date(targetDate);
    const diffTime = Math.abs(dropDate.getTime() - sourceDate.getTime());
    const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) * (dropDate > sourceDate ? 1 : -1);

    const existingWorkoutOnTarget = workoutList.find(item => item.workout.date === targetDate);

    if (existingWorkoutOnTarget) {
      setConflictModal({
        workout: targetWorkout,
        sourceMicroId: microId,
        newDate: targetDate,
        daysDiff: daysDiff,
        conflictType: 'overlap'
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

        {showCoachSelectAthlete ? (
          <div
            data-testid="calendar-empty"
            className="border border-white/10 rounded p-6 text-center"
          >
            <p className="text-sm text-white mb-1">Select an athlete</p>
            <p className="text-xs text-[#AEAEB2]">Use the athlete switcher in the sidebar to load a plan.</p>
          </div>
        ) : (
        <>

        {workoutList.length === 0 && !copySource && (
          <p className="text-xs text-[#AEAEB2] px-1">No sessions yet. Click or hover a day — New session.</p>
        )}

        {copySource && (
          <div
            data-testid="copy-to-banner"
            className="min-h-8 px-2 py-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white bg-[#007AFF]/15 border border-[#007AFF]/40 rounded"
          >
            <span className="truncate">
              Copy {copySource.title} — click a day
              {copyBusy ? ' · Copying…' : ''}
              {copyError ? ` · ${copyError}` : ''}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="copy-to-lifts"
                onClick={() => setCopyWithLogs(false)}
                className={`h-6 px-2 rounded ${!copyWithLogs ? 'bg-white/20' : 'text-[#AEAEB2]'}`}
              >
                Lifts only
              </button>
              <button
                type="button"
                data-testid="copy-to-logs"
                onClick={() => setCopyWithLogs(true)}
                className={`h-6 px-2 rounded ${copyWithLogs ? 'bg-white/20' : 'text-[#AEAEB2]'}`}
              >
                With logs
              </button>
              <button
                type="button"
                data-testid="copy-to-cancel"
                onClick={cancelCopyTo}
                className="h-6 px-2 text-[#AEAEB2] hover:text-white"
              >
                Cancel
              </button>
            </div>
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
                  className="space-y-2"
                >
                  {meso ? (
                    <div className="h-8 px-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1 h-4 rounded bg-[#54e083] shrink-0" />
                        <h4 className="text-xs text-white truncate">{meso.name}</h4>
                        <span className="text-[10px] font-mono text-[#AEAEB2] shrink-0">mesocycle</span>
                      </div>
                      <span className="font-mono text-[10px] text-[#AEAEB2] shrink-0">
                        {meso.startDate} – {meso.endDate}
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-2">
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

                            return (
                              <div
                                key={dateStr}
                                data-testid={`calendar-day-${dateStr}`}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => handleDrop(e, dateStr)}
                                onMouseEnter={() => {
                                  if (cell.isCurrentMonth && !showCoachSelectAthlete) setHoveredDate(dateStr);
                                }}
                                onMouseLeave={() => setHoveredDate((current) => current === dateStr ? null : current)}
                                onClick={() => {
                                  if (!cell.isCurrentMonth || showCoachSelectAthlete) return;
                                  if (copySource) {
                                    void copyToDate(dateStr);
                                    return;
                                  }
                                  if (dayWorkouts.length === 1) {
                                    onViewSession(dayWorkouts[0].workout, dayWorkouts[0].microId);
                                    return;
                                  }
                                  if (dayWorkouts.length === 0) {
                                    openNewSession(dateStr);
                                  }
                                }}
                                className={`h-auto min-h-[128px] p-1.5 flex flex-col relative cursor-pointer transition-colors bg-[#131313] border border-white/10 ${
                                  !cell.isCurrentMonth ? 'opacity-20 select-none !border-transparent bg-transparent' : 'hover:border-white/25 hover:bg-[#161616]'
                                } ${
                                  copySource && cell.isCurrentMonth && dateStr !== copySource.date ? 'ring-1 ring-[#007AFF]/50' : ''
                                } ${
                                  copySource && dateStr === copySource.date ? 'ring-1 ring-white/30' : ''
                                } ${
                                  !copySource && (newSessionDate === dateStr || hoveredDate === dateStr) ? 'ring-1 ring-[#007AFF] border-[#007AFF]/40' : ''
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 relative z-10 mb-1">
                                  <span className="font-mono text-[11px] text-[#AEAEB2]">
                                    {String(cell.dayNumber).padStart(2, '0')}
                                  </span>
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
                                    return (
                                      <div
                                        key={workout.id}
                                        data-testid={`workout-card-${workout.id}`}
                                        draggable
                                        onDragOver={(e) => e.preventDefault()}
                                        onDragStart={(e) => handleDragStart(e, workout.id, microId)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (copySource) {
                                            void copyToDate(dateStr);
                                            return;
                                          }
                                          onViewSession(workout, microId);
                                        }}
                                        className="mt-1 flex flex-col gap-0.5 cursor-pointer relative z-10"
                                      >
                                        {(workout.blockLabel || workout.weekLabel) ? (
                                          <span className="font-mono text-[9px] text-[#AEAEB2] truncate">
                                            {[workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ')}
                                          </span>
                                        ) : null}
                                        <div className="flex flex-col gap-0.5">
                                          {workout.exercises.length === 0 && (
                                            <span className="text-[10px] text-[#AEAEB2] truncate">{workout.title || 'Session'}</span>
                                          )}
                                          {workout.exercises.map((ex) => {
                                            const isSquat = ex.title.toLowerCase().includes('squat');
                                            const isBench = ex.title.toLowerCase().includes('bench');
                                            const isDead = ex.title.toLowerCase().includes('deadlift') || ex.title.toLowerCase().includes('dead');
                                            const movementName = isSquat ? 'SQ' : (isBench ? 'BP' : (isDead ? 'DL' : ex.title.slice(0, 3).toUpperCase()));
                                            
                                            const movementColorClass = isSquat 
                                              ? 'text-[#007aff]'
                                              : (isBench 
                                                ? 'text-[#54e083]'
                                                : isDead
                                                ? 'text-[#F5A623]'
                                                : 'text-[#AEAEB2]');
                                            
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
                                {hoveredDate === dateStr && cell.isCurrentMonth && !showCoachSelectAthlete && !copySource && (
                                  <div className="mt-auto pt-1 flex flex-col gap-1">
                                    <button
                                      type="button"
                                      data-testid={`calendar-new-session-${dateStr}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openNewSession(dateStr);
                                      }}
                                      className="h-7 w-full px-1.5 text-[11px] text-white bg-[#007AFF] rounded"
                                    >
                                      New session
                                    </button>
                                    {dayWorkouts[0] && (
                                      <button
                                        type="button"
                                        data-testid={`calendar-copy-to-${dayWorkouts[0].workout.id}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setCopyWithLogs(false);
                                          setCopyError(null);
                                          setCopySource(dayWorkouts[0].workout);
                                        }}
                                        className="h-7 w-full px-1.5 text-[11px] text-white bg-white/15 rounded"
                                      >
                                        Copy to
                                      </button>
                                    )}
                                  </div>
                                )}
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
          <span className="truncate">{copySource ? 'Click a day to drop the copy' : 'Click or hover a day · New session'}</span>
        </div>
        </>
        )}
      </div>

      {newSessionDate && (
        <NewSessionDialog
          date={newSessionDate}
          athleteId={activeAthleteId}
          onClose={() => setNewSessionDate(null)}
          onCreated={async (created) => {
            await reloadMicrocycles(activeAthleteId);
            setNewSessionDate(null);
            if (created.microcycleId) onViewSession({ id: created.id } as WorkoutData, created.microcycleId);
          }}
        />
      )}

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

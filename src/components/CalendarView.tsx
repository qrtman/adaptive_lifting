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
import { useSync } from '../contexts/SyncContext';
import { getRecentBlock, getUiPref, setRecentBlock, UI_KEYS } from '../storage/uiPrefs';
import { NewSessionDialog } from './NewSessionDialog';
import { DayNoteDialog } from './DayNoteDialog';
import { LiftFilter } from './LiftFilter';
import {
  exercisePassesFilter,
  isEmptyLiftFilter,
  workoutPassesFilter,
  type LiftFilterState,
} from '../services/liftFilter';
import { apiService } from '../services/api';
import {
  buildCopyWeekRequest,
  buildDayClipboard,
  clipboardMinDate,
  copyBannerText,
  type CopyClipboard,
} from '../features/plan/copyClipboard';

interface CalendarViewProps {
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: LiftFilterState;
  onFilterChange: (value: LiftFilterState) => void;
  copyClipboard: CopyClipboard | null;
  onStartCopy: (clip: CopyClipboard) => void;
  onClearCopy: () => void;
}

export function CalendarView({
  onViewSession,
  filter,
  onFilterChange,
  copyClipboard,
  onStartCopy,
  onClearCopy,
}: CalendarViewProps) {
  const { microcycles, mesocycles, setMicrocycles, activeAthleteId, planAthleteId, reloadMicrocycles } = usePeriodization();
  const { user } = useAuth();
  const { isOnline } = useSync();
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
  const [notesDate, setNotesDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [copyWithLogs, setCopyWithLogs] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyOriginDate = copyClipboard ? clipboardMinDate(copyClipboard) : null;

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

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
    if (showCoachSelectAthlete || copyClipboard) return;
    setNewSessionDate(dateStr);
  };

  const cancelCopyTo = () => {
    onClearCopy();
    setCopyBusy(false);
    setCopyError(null);
  };

  const startDayCopy = (workout: WorkoutData) => {
    if (showCoachSelectAthlete || !isOnline) return;
    onStartCopy(buildDayClipboard([workout], getRecentBlock(planAthleteId)));
  };

  const copyToDate = async (dateStr: string) => {
    if (!copyClipboard || copyBusy || showCoachSelectAthlete) return;
    if (!isOnline) {
      setCopyError('Connect to copy sessions.');
      return;
    }
    const origin = clipboardMinDate(copyClipboard);
    if (!origin || dateStr === origin) {
      setCopyError('Pick a different day.');
      return;
    }
    setCopyBusy(true);
    setCopyError(null);
    try {
      const payload = buildCopyWeekRequest(copyClipboard, dateStr, copyWithLogs, planAthleteId || undefined);
      if (payload.dateOffsetDays === 0) {
        setCopyError('Pick a different day.');
        setCopyBusy(false);
        return;
      }
      await apiService.copyWeek(payload);
      if (payload.targetBlockLabel) setRecentBlock(planAthleteId, payload.targetBlockLabel);
      await reloadMicrocycles(planAthleteId);
      cancelCopyTo();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy');
      setCopyBusy(false);
    }
  };

  useEffect(() => {
    setCopyWithLogs(false);
    setCopyError(null);
    setCopyBusy(false);
  }, [copyClipboard]);

  useEffect(() => {
    if (showCoachSelectAthlete || !planAthleteId) {
      setDayNotes({});
      setNotesLoading(false);
      setNotesError(null);
      return;
    }
    let cancelled = false;
    setNotesLoading(true);
    setNotesError(null);
    apiService.fetchDayNotes(isCoach ? planAthleteId : undefined)
      .then((notes) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        notes.forEach((note) => {
          const body = (note.body || '').trim();
          if (body) next[note.date] = body;
        });
        setDayNotes(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setNotesError(err instanceof Error ? err.message : 'Failed to load notes');
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [planAthleteId, showCoachSelectAthlete, isCoach]);

  useEffect(() => {
    if (!copyClipboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelCopyTo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copyClipboard]);

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
    <div className="flex-1 flex overflow-hidden bg-[var(--cal-canvas)]">
      {/* Left Pane: Scrollable Calendar Grid */}
      <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-[var(--cal-ink)] tnum">
              {months[currentMonth]} {currentYear}
            </h3>
            <button
              type="button"
              onClick={handlePrevMonth}
              className="h-7 w-7 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-ink)] rounded-[var(--cal-radius-md)]"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentYear(2026);
                setCurrentMonth(8);
              }}
              className="h-7 px-2 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] rounded-[var(--cal-radius-md)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="h-7 w-7 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-ink)] rounded-[var(--cal-radius-md)]"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <LiftFilter value={filter} onChange={onFilterChange} />
        </div>

        {showCoachSelectAthlete ? (
          <div
            data-testid="calendar-empty"
            className="border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-6 text-center bg-[var(--cal-surface-soft)]"
          >
            <p className="text-sm text-[var(--cal-ink)] mb-1">Select an athlete</p>
            <p className="text-xs text-[var(--cal-muted)]">Use the athlete switcher in the sidebar to load a plan.</p>
          </div>
        ) : (
        <>

        {workoutList.length === 0 && Object.keys(dayNotes).length === 0 && !copyClipboard && (
          <p className="text-xs text-[var(--cal-muted)] px-1">No sessions yet. Hover a day — New session or Notes.</p>
        )}

        {notesError ? (
          <p data-testid="calendar-notes-error" className="text-xs text-[var(--cal-error)] px-1">{notesError}</p>
        ) : null}

        {!isOnline ? (
          <p data-testid="copy-offline" className="text-xs text-[var(--cal-warning)] px-1">Connect to copy sessions.</p>
        ) : null}

        {copyClipboard && (
          <div
            data-testid="copy-to-banner"
            data-copy-grain={copyClipboard.grain}
            className="min-h-8 px-2 py-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--cal-ink)] bg-[color-mix(in_srgb,var(--cal-accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--cal-accent)_35%,transparent)] rounded-[var(--cal-radius-md)]"
          >
            <span className="truncate">
              {copyBannerText(copyClipboard)}
              {copyBusy ? ' · Copying…' : ''}
              {copyError ? ` · ${copyError}` : ''}
              {!isOnline ? ' · Connect to copy sessions.' : ''}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="copy-to-lifts"
                onClick={() => setCopyWithLogs(false)}
                className={`h-6 px-2 rounded-[var(--cal-radius-md)] text-[11px] ${
                  !copyWithLogs
                    ? 'bg-[var(--cal-surface-elevated)] text-[var(--cal-ink)]'
                    : 'text-[var(--cal-muted)]'
                }`}
              >
                Lifts only
              </button>
              <button
                type="button"
                data-testid="copy-to-logs"
                onClick={() => setCopyWithLogs(true)}
                className={`h-6 px-2 rounded-[var(--cal-radius-md)] text-[11px] ${
                  copyWithLogs
                    ? 'bg-[var(--cal-surface-elevated)] text-[var(--cal-ink)]'
                    : 'text-[var(--cal-muted)]'
                }`}
              >
                With logs
              </button>
              <button
                type="button"
                data-testid="copy-to-cancel"
                onClick={cancelCopyTo}
                className="h-6 px-2 text-[var(--cal-muted)] hover:text-[var(--cal-ink)] text-[11px]"
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
                        <span className="inline-flex items-center h-6 px-2 rounded-[var(--cal-radius-pill)] bg-[var(--cal-surface-soft)] text-[11px] font-medium text-[var(--cal-ink)] truncate max-w-[200px]">
                          {meso.name}
                        </span>
                        <span className="text-[10px] text-[var(--cal-muted-soft)] shrink-0">mesocycle</span>
                      </div>
                      <span className="text-[10px] tnum text-[var(--cal-muted)] shrink-0">
                        {meso.startDate} – {meso.endDate}
                      </span>
                    </div>
                  ) : null}

                  <div className="rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] overflow-hidden bg-[var(--cal-canvas)]">
                    <div className="grid grid-cols-7 border-b border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)]">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                        <div
                          key={day}
                          className="px-1.5 py-1 border-r border-[var(--cal-hairline)] last:border-r-0"
                        >
                          <span className="text-[10px] font-medium text-[var(--cal-muted)]">{day}</span>
                        </div>
                      ))}
                    </div>

                    {group.weeks.map((week, weekIdx) => {
                      const firstDay = week[0].dateString;
                      const isLastWeek = weekIdx === group.weeks.length - 1;

                      return (
                        <div
                          key={`${firstDay}-${weekIdx}`}
                          className="grid grid-cols-7"
                        >
                          {week.map((cell, cellIdx) => {
                            const dateStr = cell.dateString;
                            const dayWorkouts = workoutList.filter(item => item.workout.date === dateStr);
                            const dayNote = dayNotes[dateStr];
                            const isToday = dateStr === todayStr && cell.isCurrentMonth;
                            const isHovered = hoveredDate === dateStr && cell.isCurrentMonth;
                            const isActive =
                              newSessionDate === dateStr || notesDate === dateStr || isHovered;

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
                                  if (copyClipboard) {
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
                                className={`h-auto min-h-[128px] p-1.5 flex flex-col relative overflow-visible cursor-pointer transition-colors border-r border-b border-[var(--cal-hairline)] ${
                                  isHovered ? 'z-20' : ''
                                } ${
                                  cellIdx === 6 ? 'border-r-0' : ''
                                } ${
                                  isLastWeek ? 'border-b-0' : ''
                                } ${
                                  !cell.isCurrentMonth
                                    ? 'opacity-40 select-none bg-[var(--cal-surface-soft)]'
                                    : 'bg-[var(--cal-canvas)] hover:bg-[var(--cal-surface-soft)]'
                                } ${
                                  copyClipboard && cell.isCurrentMonth && dateStr !== copyOriginDate
                                    ? 'ring-1 ring-inset ring-[color-mix(in_srgb,var(--cal-accent)_50%,transparent)]'
                                    : ''
                                } ${
                                  copyClipboard && dateStr === copyOriginDate
                                    ? 'ring-1 ring-inset ring-[var(--cal-hairline)]'
                                    : ''
                                } ${
                                  !copyClipboard && (isActive || isToday)
                                    ? 'ring-1 ring-inset ring-[var(--cal-accent)]'
                                    : ''
                                }`}
                              >
                                <div className="flex items-center gap-1 relative z-10 mb-1 min-h-6">
                                  <span
                                    className={`text-[11px] tnum shrink-0 ${
                                      isToday
                                        ? 'font-semibold text-[var(--cal-accent)]'
                                        : 'text-[var(--cal-muted)]'
                                    }`}
                                  >
                                    {String(cell.dayNumber).padStart(2, '0')}
                                  </span>
                                  {hoveredDate === dateStr && cell.isCurrentMonth && !showCoachSelectAthlete && !copyClipboard ? (
                                    <div
                                      data-testid={`calendar-day-hover-${dateStr}`}
                                      className="absolute top-0 left-6 z-20 flex flex-row flex-nowrap items-center gap-0.5 w-max"
                                    >
                                      <button
                                        type="button"
                                        data-testid={`calendar-new-session-${dateStr}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openNewSession(dateStr);
                                        }}
                                        className="h-6 px-1.5 text-[10px] leading-none text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] whitespace-nowrap hover:bg-[var(--cal-primary-active)] transform-none"
                                      >
                                        New session
                                      </button>
                                      {dayWorkouts[0] ? (
                                        <button
                                          type="button"
                                          data-testid={`calendar-copy-to-${dayWorkouts[0].workout.id}`}
                                          disabled={!isOnline}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            startDayCopy(dayWorkouts[0].workout);
                                          }}
                                          className="h-6 px-1.5 text-[10px] leading-none text-[var(--cal-ink)] bg-[var(--cal-surface-strong)] rounded-[var(--cal-radius-md)] whitespace-nowrap disabled:opacity-40 transform-none"
                                        >
                                          Copy to
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        data-testid={`calendar-day-notes-${dateStr}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setNotesDate(dateStr);
                                        }}
                                        className="h-6 px-1.5 text-[10px] leading-none text-[var(--cal-ink)] bg-[var(--cal-surface-strong)] rounded-[var(--cal-radius-md)] whitespace-nowrap transform-none"
                                      >
                                        Notes
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                                {cell.isCurrentMonth && dayWorkouts
                                  .filter(({ workout }) => workoutPassesFilter(workout, filter))
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
                                          if (copyClipboard) {
                                            void copyToDate(dateStr);
                                            return;
                                          }
                                          onViewSession(workout, microId);
                                        }}
                                        className="cal-day-chip mt-1 p-1 flex flex-col gap-0.5 cursor-pointer"
                                      >
                                        {(workout.blockLabel || workout.weekLabel) ? (
                                          <span className="text-[9px] tnum text-[var(--cal-muted)] truncate px-0.5">
                                            {[workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ')}
                                          </span>
                                        ) : null}
                                        <div className="flex flex-col gap-0.5">
                                          {workout.exercises.length === 0 && (
                                            <span className="text-[10px] text-[var(--cal-muted)] truncate px-0.5">
                                              {workout.title || 'Session'}
                                            </span>
                                          )}
                                          {(isEmptyLiftFilter(filter)
                                            ? workout.exercises
                                            : workout.exercises.filter((ex) => exercisePassesFilter(ex, filter))
                                          ).map((ex) => {
                                            const isSquat = ex.title.toLowerCase().includes('squat');
                                            const isBench = ex.title.toLowerCase().includes('bench');
                                            const isDead = ex.title.toLowerCase().includes('deadlift') || ex.title.toLowerCase().includes('dead');
                                            const movementName = isSquat ? 'SQ' : (isBench ? 'BP' : (isDead ? 'DL' : ex.title.slice(0, 3).toUpperCase()));

                                            const movementColorStyle = isSquat
                                              ? { color: 'var(--cal-badge-sq)' }
                                              : isBench
                                                ? { color: 'var(--cal-badge-bp)' }
                                                : isDead
                                                  ? { color: 'var(--cal-badge-dl)' }
                                                  : undefined;

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
                                              <div
                                                key={ex.id}
                                                className="flex items-center justify-between gap-1 text-[10px] leading-tight tnum px-0.5"
                                              >
                                                <span className="shrink-0 font-medium" style={movementColorStyle}>
                                                  {movementName}
                                                </span>
                                                <span
                                                  className={`truncate ${
                                                    actualW ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted)]'
                                                  }`}
                                                >
                                                  {logged}
                                                </span>
                                                {isWorkoutCompleted(workout.status) && (
                                                  <span className="text-[var(--cal-success)] shrink-0">✓</span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                {cell.isCurrentMonth && dayNote ? (
                                  <button
                                    type="button"
                                    data-testid={`calendar-day-note-card-${dateStr}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (copyClipboard) {
                                        void copyToDate(dateStr);
                                        return;
                                      }
                                      setNotesDate(dateStr);
                                    }}
                                    className="cal-day-chip cal-day-chip--note mt-1 px-1.5 py-1 text-left"
                                  >
                                    <span className="block text-[9px] uppercase tracking-wider text-[var(--cal-muted-soft)]">
                                      Note
                                    </span>
                                    <span className="block text-[10px] text-[var(--cal-body)] line-clamp-2 leading-tight">
                                      {dayNote}
                                    </span>
                                  </button>
                                ) : null}
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

        <div className="h-8 px-2 flex items-center justify-between gap-3 text-[10px] text-[var(--cal-muted)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--cal-success)]" /> Done
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--cal-muted-soft)]" /> Planned
            </span>
          </div>
          <span className="truncate">
            {copyClipboard ? 'Click a day to drop the copy' : 'Hover a day · New session, Copy to, Notes'}
          </span>
        </div>
        </>
        )}
      </div>

      {newSessionDate && (
        <NewSessionDialog
          date={newSessionDate}
          athleteId={planAthleteId}
          onClose={() => setNewSessionDate(null)}
          onCreated={async (created) => {
            await reloadMicrocycles(planAthleteId);
            setNewSessionDate(null);
            if (created.microcycleId) onViewSession({ id: created.id } as WorkoutData, created.microcycleId);
          }}
        />
      )}

      {notesDate && (
        <DayNoteDialog
          date={notesDate}
          athleteId={planAthleteId}
          initialBody={dayNotes[notesDate] || ''}
          loading={notesLoading}
          isOnline={isOnline}
          onClose={() => setNotesDate(null)}
          onSaved={async (body) => {
            const date = notesDate;
            setDayNotes((current) => {
              const next = { ...current };
              if (body.trim()) next[date] = body.trim();
              else delete next[date];
              return next;
            });
            setNotesDate(null);
          }}
        />
      )}

      {/* Conflict Decision Modal */}
      <AnimatePresence>
        {conflictModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-[var(--cal-surface-elevated)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] max-w-md w-full p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 text-[var(--cal-warning)] mb-3">
                <AlertTriangle size={16} />
                <h4 className="text-sm text-[var(--cal-ink)]">Periodization conflict</h4>
              </div>

              <p className="text-xs text-[var(--cal-muted)] leading-relaxed mb-4">
                Rescheduling <strong className="text-[var(--cal-ink)]">{conflictModal.workout.title}</strong> by {Math.abs(conflictModal.daysDiff)} {Math.abs(conflictModal.daysDiff) === 1 ? 'day' : 'days'} {conflictModal.daysDiff > 0 ? 'forward' : 'backward'} to <strong className="text-[var(--cal-ink)]">{conflictModal.newDate}</strong>.
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
                  className="w-full flex items-center justify-between p-3 bg-[color-mix(in_srgb,var(--cal-accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--cal-accent)_15%,transparent)] border border-[color-mix(in_srgb,var(--cal-accent)_30%,transparent)] rounded-[var(--cal-radius-md)] text-left"
                >
                  <div>
                    <span className="text-xs text-[var(--cal-ink)] block mb-0.5">Cascading shift</span>
                    <span className="text-[10px] text-[var(--cal-muted)] block">
                      Move later workouts in this microcycle by {conflictModal.daysDiff} days.
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-[var(--cal-accent)]" />
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
                  className="w-full flex items-center justify-between p-3 bg-[var(--cal-surface-soft)] hover:bg-[var(--cal-surface-card)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] text-left"
                >
                  <div>
                    <span className="text-xs text-[var(--cal-ink)] block mb-0.5">This session only</span>
                    <span className="text-[10px] text-[var(--cal-muted)] block">
                      Leave other workouts where they are.
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-[var(--cal-muted)]" />
                </button>
              </div>

              <div className="flex justify-end border-t border-[var(--cal-hairline)] pt-3">
                <button
                  type="button"
                  onClick={cancelMove}
                  onMouseDown={triggerHaptic}
                  className="h-7 px-2 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
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

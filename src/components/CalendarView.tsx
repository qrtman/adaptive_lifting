import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { WorkoutData, isWorkoutCompleted } from '../types';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useAuth } from '../contexts/AuthContext';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';
import { MicrocycleBoundsEditor } from './MicrocycleBoundsEditor';
import {
  dateInMicrocycle,
  firstPlanDate,
  inferMicrocycleId,
  placedSessions,
  rangesOverlap,
  resolvedMicrocycleBounds,
  sundayOf,
  utcMonthGrid,
} from '../services/workoutDays';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function newWorkoutId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function liftLine(workout: WorkoutData): string {
  const first = workout.exercises[0];
  if (!first) return workout.title || 'Empty';
  const set = first.sets[0];
  const weight = set?.actual ?? set?.plannedWeight ?? '—';
  const reps = set?.reps ?? set?.plannedReps ?? '—';
  return `${first.title} ${weight}×${reps}`;
}

function yearMonthFromIso(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

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
  const {
    microcycles,
    addWorkout,
    addMicrocycle,
    rescheduleWorkout,
    updateMicrocycleBounds,
    copyMicrocycle,
    deleteWorkout,
    deleteMicrocycle,
    activeMicrocycleId,
    setActiveMicrocycleId,
    activeAthlete,
    activeAthleteId,
  } = usePeriodization();
  const { roleMode } = useAuth();
  const placed = useMemo(() => placedSessions(microcycles), [microcycles]);
  const seed = firstPlanDate(microcycles);
  const seedParts = yearMonthFromIso(seed);
  const [currentYear, setCurrentYear] = useState(seedParts.year);
  const [currentMonth, setCurrentMonth] = useState(seedParts.month);
  const [boundaryLockVisible, setBoundaryLockVisible] = useState(false);
  const [boundaryFlashDate, setBoundaryFlashDate] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ workoutId: string; microId: string; date: string } | null>(null);

  useEffect(() => {
    const parts = yearMonthFromIso(firstPlanDate(microcycles));
    setCurrentYear(parts.year);
    setCurrentMonth(parts.month);
    // Jump month when the athlete changes, not when a week is added or deleted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAthleteId]);

  const weekBounds = useMemo(
    () =>
      microcycles.map((micro, index) => ({
        micro,
        index,
        bounds: resolvedMicrocycleBounds(micro, index),
      })),
    [microcycles],
  );

  const rows = useMemo(() => utcMonthGrid(currentYear, currentMonth), [currentYear, currentMonth]);

  const ownersOn = (date: string) =>
    weekBounds.filter((row) => date >= row.bounds.start && date <= row.bounds.end);

  const sessionsOn = (dateStr: string) =>
    placed.filter((row) => {
      if (row.date !== dateStr) return false;
      if (filter === 'All') return true;
      const titles = row.workout.exercises.map((exercise) => exercise.title.toLowerCase());
      if (filter === 'Squat') return titles.some((title) => title.includes('squat'));
      if (filter === 'Bench') return titles.some((title) => title.includes('bench'));
      if (filter === 'Deadlift') {
        return titles.some((title) => title.includes('deadlift') || title.includes('dead'));
      }
      return true;
    });

  const handleDragStart = (
    event: DragEvent,
    workoutId: string,
    microId: string,
    date: string,
  ) => {
    const origin = event.target as HTMLElement | null;
    if (origin?.closest('button, input, label')) {
      event.preventDefault();
      return;
    }
    dragPayloadRef.current = { workoutId, microId, date };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({ workoutId, microId, date }));
  };

  const handleDrop = (event: DragEvent, targetDate: string) => {
    event.preventDefault();
    let payload = dragPayloadRef.current;
    if (!payload) {
      const raw = event.dataTransfer.getData('text/plain');
      if (raw) {
        try {
          payload = JSON.parse(raw) as { workoutId: string; microId: string; date: string };
        } catch {
          payload = null;
        }
      }
    }
    dragPayloadRef.current = null;
    if (!payload || payload.date === targetDate) return;
    const microIndex = microcycles.findIndex((micro) => micro.id === payload.microId);
    const micro = microIndex === -1 ? undefined : microcycles[microIndex];
    if (!micro || !dateInMicrocycle(targetDate, micro, microIndex)) {
      setBoundaryLockVisible(true);
      setBoundaryFlashDate(payload.date);
      return;
    }
    setBoundaryLockVisible(false);
    setBoundaryFlashDate(null);
    rescheduleWorkout(payload.workoutId, targetDate);
  };

  const addOnDay = (dateStr: string) => {
    if (roleMode !== 'coach') return;
    const owners = ownersOn(dateStr);
    if (owners.length === 0) {
      setAssignError('Place a week on this row first, then add a session.');
      return;
    }
    const selected = owners.find((row) => row.micro.id === activeMicrocycleId);
    const microcycleId = selected?.micro.id
      ?? inferMicrocycleId(dateStr, microcycles, owners[0].micro.id);
    const assignIndex = microcycles.findIndex((micro) => micro.id === microcycleId);
    const assignMicro = assignIndex === -1 ? undefined : microcycles[assignIndex];
    if (!assignMicro || !dateInMicrocycle(dateStr, assignMicro, assignIndex)) {
      setAssignError('That day is outside this week. Select the week that owns it, or adjust the dates.');
      return;
    }
    setAssignError(null);
    setActiveMicrocycleId(microcycleId);
    addWorkout(microcycleId, {
      id: newWorkoutId(),
      date: dateStr,
      dayLabel: '',
      title: '',
      tonnage: 0,
      delta: 0,
      color: 'mac-blue',
      status: 'PLANNED',
      exercises: [],
    });
  };

  const shiftMonth = (delta: number) => {
    const next = currentMonth + delta;
    if (next < 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else if (next > 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(next);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto bg-[#0A0A0A]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="calendar-prev-month"
            onClick={() => shiftMonth(-1)}
            className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
          <h3 className="text-sm text-white min-w-[10rem] text-center">
            {MONTHS[currentMonth]} {currentYear}
          </h3>
          <button
            type="button"
            data-testid="calendar-next-month"
            onClick={() => shiftMonth(1)}
            className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <LiftFilter value={filter} onChange={onFilterChange} />
      </div>

      {assignError ? (
        <p role="alert" className="px-1 text-xs text-[#FF453A]">{assignError}</p>
      ) : null}

      {boundaryLockVisible && (
        <div
          data-testid="calendar-boundary-lock"
          role="alert"
          className="border border-[#FF453A]/50 bg-[#FF453A]/10 text-[#FF453A] px-3 py-1.5 font-mono text-xs"
        >
          Sessions stay inside this week's dates.
        </div>
      )}

      {!activeAthlete ? (
        <div className="border border-white/10 px-3 py-8" data-testid="calendar-empty">
          <p className="text-sm text-[#AEAEB2]">No athlete selected. Add one on Roster.</p>
        </div>
      ) : (
        <div data-testid="calendar-timeline" className="border border-white/10 bg-[#131313]">
          <div className="flex">
            <div className="w-44 sm:w-56 shrink-0" />
            <div className="grid grid-cols-7 flex-1 min-w-0">
              {WEEKDAYS.map((day) => (
                <div key={day} className="h-6 px-1 font-mono text-[10px] text-[#AEAEB2]">
                  {day}
                </div>
              ))}
            </div>
          </div>
          {rows.map((row) => {
            const monday = row[0].date;
            const sunday = sundayOf(monday);
            const onRow = weekBounds.filter((item) => rangesOverlap(item.bounds, { start: monday, end: sunday }));
            const starting = onRow.filter((item) => item.bounds.start >= monday && item.bounds.start <= sunday);
            const continuing = onRow.filter((item) => !starting.includes(item));
            const primary = starting[0];
            return (
              <div key={monday} className="flex flex-row border-t border-white/10">
                <div className="w-44 sm:w-56 shrink-0 p-1 flex flex-wrap items-center gap-1">
                  {continuing.map((item) => (
                    <span key={item.micro.id} className="text-[10px] text-[#636366]">
                      {item.micro.weekName}
                    </span>
                  ))}
                  {primary ? (
                    <div
                      data-testid={`week-board-${primary.micro.id}`}
                      className={`flex flex-wrap items-center gap-1 ${
                        activeMicrocycleId === primary.micro.id ? 'outline outline-1 outline-[#007AFF]/60' : ''
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`assign-micro-${primary.micro.id}`}
                        onClick={() => {
                          setActiveMicrocycleId(primary.micro.id);
                          setAssignError(null);
                        }}
                        className={`h-7 px-2 text-[11px] border ${
                          activeMicrocycleId === primary.micro.id
                            ? 'border-[#007AFF] text-white'
                            : 'border-white/10 text-[#AEAEB2] hover:text-white'
                        }`}
                      >
                        {primary.micro.weekName}
                      </button>
                      {roleMode === 'coach' ? (
                        <MicrocycleBoundsEditor
                          microId={primary.micro.id}
                          start={primary.bounds.start}
                          end={primary.bounds.end}
                          showCopy
                          showDelete
                          onBoundsChange={(start, end) => updateMicrocycleBounds(primary.micro.id, start, end)}
                          onCopy={() => copyMicrocycle(primary.micro.id)}
                          onDelete={() => deleteMicrocycle(primary.micro.id)}
                        />
                      ) : (
                        <span className="font-mono text-[11px] text-[#AEAEB2]">
                          {primary.bounds.start} – {primary.bounds.end}
                        </span>
                      )}
                    </div>
                  ) : roleMode === 'coach' ? (
                    <button
                      type="button"
                      data-testid={`add-week-${monday}`}
                      onClick={() => {
                        setAssignError(null);
                        addMicrocycle(monday, sunday);
                      }}
                      className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
                    >
                      <Plus size={12} />
                      Week
                    </button>
                  ) : (
                    <span className="text-[10px] text-[#636366]">No week</span>
                  )}
                  {starting.slice(1).map((item) => (
                    <button
                      key={item.micro.id}
                      type="button"
                      data-testid={`assign-micro-${item.micro.id}`}
                      onClick={() => setActiveMicrocycleId(item.micro.id)}
                      className="h-7 px-2 text-[11px] border border-white/10 text-[#AEAEB2]"
                    >
                      {item.micro.weekName}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-7 flex-1 min-w-0">
                  {row.map((cell) => {
                    const dayWorkouts = sessionsOn(cell.date);
                    const owners = ownersOn(cell.date);
                    const inSelected = owners.some((item) => item.micro.id === activeMicrocycleId);
                    const dayNumber = cell.date.slice(8, 10);
                    return (
                      <div
                        key={cell.date}
                        data-testid={`calendar-day-${cell.date}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, cell.date)}
                        className={`min-h-[72px] p-1 flex flex-col border-l border-white/10 bg-[#161616] ${
                          !cell.inMonth ? 'opacity-30' : ''
                        } ${inSelected ? 'bg-[#007AFF]/5' : ''} ${
                          boundaryFlashDate === cell.date ? 'ring-2 ring-[#FF453A] bg-[#FF453A]/10' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[11px] text-[#AEAEB2]">{dayNumber}</span>
                          {roleMode === 'coach' && owners.length > 0 ? (
                            <button
                              type="button"
                              data-testid={`add-session-day-${cell.date}`}
                              onClick={() => addOnDay(cell.date)}
                              className="h-5 px-1 text-[10px] text-[#AEAEB2] hover:text-white flex items-center gap-0.5"
                            >
                              <Plus size={10} />
                              Session
                            </button>
                          ) : null}
                        </div>
                        {dayWorkouts.map((rowItem) => (
                          <div
                            key={rowItem.workout.id}
                            data-testid={`workout-card-${rowItem.workout.id}`}
                            draggable={roleMode === 'coach'}
                            onDragStart={(event) =>
                              handleDragStart(event, rowItem.workout.id, rowItem.micro.id, rowItem.date)
                            }
                            className="mt-1 border border-white/10 bg-[#0A0A0A] p-1"
                          >
                            <button
                              type="button"
                              onClick={() => onViewSession(rowItem.workout, rowItem.micro.id)}
                              className="w-full text-left cursor-pointer"
                            >
                              <span className="block text-[10px] text-white truncate">
                                {rowItem.workout.dayLabel || 'Session'}
                              </span>
                              <span className="block font-mono text-[10px] text-[#AEAEB2] truncate">
                                {liftLine(rowItem.workout)}
                                {isWorkoutCompleted(rowItem.workout.status) ? ' ✓' : ''}
                              </span>
                            </button>
                            {roleMode === 'coach' ? (
                              <button
                                type="button"
                                data-testid={`delete-session-${rowItem.workout.id}`}
                                onClick={() => deleteWorkout(rowItem.workout.id)}
                                className="mt-0.5 h-5 px-1 text-[10px] text-[#FF453A] hover:text-white flex items-center gap-1"
                              >
                                <Trash2 size={10} />
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WorkoutData, isWorkoutCompleted } from '../types';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useAuth } from '../contexts/AuthContext';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';
import { MicrocycleBoundsEditor } from './MicrocycleBoundsEditor';
import { dateInMicrocycle, placedSessions, resolvedMicrocycleBounds } from '../services/workoutDays';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseLocal(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month: month - 1, day };
}

function monthCells(year: number, monthIndex: number): Array<{
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
}> {
  const first = new Date(year, monthIndex, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const cell = new Date(start);
    cell.setDate(start.getDate() + i);
    const y = cell.getFullYear();
    const m = cell.getMonth();
    const d = cell.getDate();
    return {
      date: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayNumber: d,
      isCurrentMonth: m === monthIndex,
    };
  });
}

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
    rescheduleWorkout,
    updateMicrocycleBounds,
    copyMicrocycle,
    activeMicrocycleId,
    setActiveMicrocycleId,
    activeAthlete,
    activeAthleteId,
  } = usePeriodization();
  const { roleMode } = useAuth();
  const placed = useMemo(() => placedSessions(microcycles), [microcycles]);
  const seed = placed[0]?.date ?? '2026-09-01';
  const seedParts = parseLocal(seed);
  const [currentYear, setCurrentYear] = useState(seedParts.year);
  const [currentMonth, setCurrentMonth] = useState(seedParts.month);
  const [boundaryLockVisible, setBoundaryLockVisible] = useState(false);
  const [boundaryFlashDate, setBoundaryFlashDate] = useState<string | null>(null);
  const planKey = `${activeAthleteId ?? ''}:${microcycles.map((micro) => micro.id).join(',')}`;
  const [assignError, setAssignError] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ workoutId: string; microId: string; date: string } | null>(null);

  useEffect(() => {
    const first = placedSessions(microcycles)[0]?.date ?? '2026-09-01';
    const parts = parseLocal(first);
    setCurrentYear(parts.year);
    setCurrentMonth(parts.month);
    // planKey captures athlete + week ids; adding a session must not yank the month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const assignMicrocycleId = activeMicrocycleId ?? microcycles[0]?.id ?? '';
  const assignIndex = microcycles.findIndex((micro) => micro.id === assignMicrocycleId);
  const assignMicro = assignIndex === -1 ? undefined : microcycles[assignIndex];
  const assignBounds = assignMicro ? resolvedMicrocycleBounds(assignMicro, assignIndex) : null;
  const daysGrid = useMemo(() => monthCells(currentYear, currentMonth), [currentYear, currentMonth]);

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

  const addOnDay = (dateStr: string, inMonth: boolean) => {
    if (roleMode !== 'coach' || !inMonth) return;
    if (!assignMicrocycleId) {
      setAssignError('Assign a microcycle.');
      return;
    }
    const assignIndex = microcycles.findIndex((micro) => micro.id === assignMicrocycleId);
    const assignMicro = assignIndex === -1 ? undefined : microcycles[assignIndex];
    if (!assignMicro || !dateInMicrocycle(dateStr, assignMicro, assignIndex)) {
      setAssignError('That day is outside this microcycle. Adjust the week dates first.');
      return;
    }
    setAssignError(null);
    addWorkout(assignMicrocycleId, {
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

  return (
    <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto bg-[#0A0A0A]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm text-white">
            {MONTHS[currentMonth]} {currentYear}
          </h3>
          <button type="button" onClick={handlePrevMonth} className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const parts = parseLocal(seed);
              setCurrentYear(parts.year);
              setCurrentMonth(parts.month);
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

      {microcycles.length > 0 && roleMode === 'coach' ? (
        <div className="flex flex-col gap-1 px-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366] mr-1">Add to</span>
            {microcycles.map((micro) => {
              const selected = assignMicrocycleId === micro.id;
              return (
                <button
                  key={micro.id}
                  type="button"
                  data-testid={`assign-micro-${micro.id}`}
                  onClick={() => {
                    setActiveMicrocycleId(micro.id);
                    setAssignError(null);
                  }}
                  className={`h-7 px-2 text-[11px] border ${
                    selected ? 'border-[#007AFF] text-white' : 'border-white/10 text-[#AEAEB2] hover:text-white'
                  }`}
                >
                  {micro.weekName}
                </button>
              );
            })}
          </div>
          {assignMicro && assignBounds ? (
            <MicrocycleBoundsEditor
              microId={assignMicro.id}
              start={assignBounds.start}
              end={assignBounds.end}
              showCopy
              onBoundsChange={(start, end) => updateMicrocycleBounds(assignMicro.id, start, end)}
              onCopy={() => copyMicrocycle(assignMicro.id)}
            />
          ) : null}
        </div>
      ) : null}

      {assignError ? (
        <p role="alert" className="px-1 text-xs text-[#FF453A]">{assignError}</p>
      ) : null}

      {boundaryLockVisible && (
        <div
          data-testid="calendar-boundary-lock"
          role="alert"
          className="border border-[#FF453A]/50 bg-[#FF453A]/10 text-[#FF453A] px-3 py-1.5 font-mono text-xs"
        >
          Periodization Boundary Lock: Workouts cannot be dragged outside this microcycle's dates.
        </div>
      )}

      {microcycles.length === 0 ? (
        <div className="border border-white/10 px-3 py-8" data-testid="calendar-empty">
          <p className="text-sm text-[#AEAEB2]">
            {activeAthlete
              ? `No sessions for ${activeAthlete.name}.`
              : 'No athlete selected. Add one on Roster.'}
          </p>
        </div>
      ) : (
        <div className="border border-white/10 bg-[#131313]">
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((day) => (
              <div key={day} className="h-6 px-1.5 font-mono text-[10px] text-[#AEAEB2]">
                {day}
              </div>
            ))}
            {daysGrid.map((cell) => {
              const dayWorkouts = sessionsOn(cell.date);
              return (
                <div
                  key={cell.date}
                  data-testid={`calendar-day-${cell.date}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, cell.date)}
                  onClick={() => addOnDay(cell.date, cell.isCurrentMonth)}
                  className={`min-h-[128px] p-1.5 flex flex-col border border-white/10 ${
                    cell.isCurrentMonth ? 'bg-[#131313] cursor-pointer' : 'opacity-20 bg-transparent'
                  } ${boundaryFlashDate === cell.date ? 'ring-2 ring-[#FF453A] bg-[#FF453A]/10' : ''}`}
                >
                  <span className="font-mono text-[11px] text-[#AEAEB2]">
                    {String(cell.dayNumber).padStart(2, '0')}
                  </span>
                  {cell.isCurrentMonth &&
                    dayWorkouts.map((row) => (
                      <div
                        key={row.workout.id}
                        data-testid={`workout-card-${row.workout.id}`}
                        draggable={roleMode === 'coach'}
                        onDragStart={(event) => handleDragStart(event, row.workout.id, row.micro.id, row.date)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewSession(row.workout, row.micro.id);
                        }}
                        className="mt-1 text-left border border-white/10 bg-[#161616] p-1.5 hover:border-white/20 cursor-grab"
                      >
                        <span className="block text-[10px] text-white truncate">
                          {row.micro.weekName} {row.workout.dayLabel}
                        </span>
                        <span className="block font-mono text-[10px] text-[#AEAEB2] truncate">
                          {liftLine(row.workout)}
                          {isWorkoutCompleted(row.workout.status) ? ' ✓' : ''}
                        </span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {microcycles.length > 0 ? (
        <p className="h-8 px-2 flex items-center text-[10px] text-[#AEAEB2] border border-white/10">
          Click a day to add a session · drag within the week dates · Copy duplicates the selected week
        </p>
      ) : null}
    </div>
  );
}

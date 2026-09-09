import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { WorkoutData, isWorkoutCompleted } from '../types';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useAuth } from '../contexts/AuthContext';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';
import { MicrocycleBoundsEditor } from './MicrocycleBoundsEditor';
import {
  dateInMicrocycle,
  eachIsoDate,
  placedSessions,
  resolvedMicrocycleBounds,
  utcWeekdayShort,
} from '../services/workoutDays';

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
    deleteWorkout,
    deleteMicrocycle,
    activeMicrocycleId,
    setActiveMicrocycleId,
    activeAthlete,
  } = usePeriodization();
  const { roleMode } = useAuth();
  const placed = useMemo(() => placedSessions(microcycles), [microcycles]);
  const [boundaryLockVisible, setBoundaryLockVisible] = useState(false);
  const [boundaryFlashDate, setBoundaryFlashDate] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ workoutId: string; microId: string; date: string } | null>(null);

  const sessionsOn = (dateStr: string, microId: string) =>
    placed.filter((row) => {
      if (row.date !== dateStr || row.micro.id !== microId) return false;
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

  const handleDrop = (event: DragEvent, targetDate: string, targetMicroId: string) => {
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
    if (payload.microId !== targetMicroId) {
      setBoundaryLockVisible(true);
      setBoundaryFlashDate(payload.date);
      return;
    }
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

  const addOnDay = (dateStr: string, microcycleId: string) => {
    if (roleMode !== 'coach') return;
    const assignIndex = microcycles.findIndex((micro) => micro.id === microcycleId);
    const assignMicro = assignIndex === -1 ? undefined : microcycles[assignIndex];
    if (!assignMicro || !dateInMicrocycle(dateStr, assignMicro, assignIndex)) {
      setAssignError('That day is outside this microcycle. Adjust the week dates first.');
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

  return (
    <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto bg-[#0A0A0A]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="text-sm text-white">Weeks</h3>
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

      {microcycles.length === 0 ? (
        <div className="border border-white/10 px-3 py-8" data-testid="calendar-empty">
          <p className="text-sm text-[#AEAEB2]">
            {activeAthlete
              ? `No sessions for ${activeAthlete.name}. Copy a week or add a session once a week exists.`
              : 'No athlete selected. Add one on Roster.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {microcycles.map((micro, microIndex) => {
            const bounds = resolvedMicrocycleBounds(micro, microIndex);
            const days = eachIsoDate(bounds.start, bounds.end);
            const selected = activeMicrocycleId === micro.id;
            return (
              <section
                key={micro.id}
                className={`border border-white/10 bg-[#131313] p-2 ${selected ? 'border-[#007AFF]/60' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button
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
                  {roleMode === 'coach' ? (
                    <MicrocycleBoundsEditor
                      microId={micro.id}
                      start={bounds.start}
                      end={bounds.end}
                      showCopy
                      showDelete
                      onBoundsChange={(start, end) => updateMicrocycleBounds(micro.id, start, end)}
                      onCopy={() => copyMicrocycle(micro.id)}
                      onDelete={() => deleteMicrocycle(micro.id)}
                    />
                  ) : (
                    <span className="font-mono text-[11px] text-[#AEAEB2]">
                      {bounds.start} – {bounds.end}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1">
                  {days.map((dateStr) => {
                    const dayWorkouts = sessionsOn(dateStr, micro.id);
                    const dayNumber = Number(dateStr.slice(8, 10));
                    return (
                      <div
                        key={dateStr}
                        data-testid={`calendar-day-${micro.id}-${dateStr}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, dateStr, micro.id)}
                        className={`min-h-[96px] p-1.5 flex flex-col border border-white/10 bg-[#161616] ${
                          boundaryFlashDate === dateStr ? 'ring-2 ring-[#FF453A] bg-[#FF453A]/10' : ''
                        }`}
                      >
                        <span className="font-mono text-[11px] text-[#AEAEB2]">
                          {utcWeekdayShort(dateStr)} {String(dayNumber).padStart(2, '0')}
                        </span>
                        {dayWorkouts.map((row) => (
                          <div
                            key={row.workout.id}
                            data-testid={`workout-card-${row.workout.id}`}
                            draggable={roleMode === 'coach'}
                            onDragStart={(event) => handleDragStart(event, row.workout.id, row.micro.id, row.date)}
                            className="mt-1 border border-white/10 bg-[#0A0A0A] p-1.5"
                          >
                            <button
                              type="button"
                              onClick={() => onViewSession(row.workout, row.micro.id)}
                              className="w-full text-left cursor-pointer"
                            >
                              <span className="block text-[10px] text-white truncate">
                                {row.workout.dayLabel || 'Session'}
                              </span>
                              <span className="block font-mono text-[10px] text-[#AEAEB2] truncate">
                                {liftLine(row.workout)}
                                {isWorkoutCompleted(row.workout.status) ? ' ✓' : ''}
                              </span>
                            </button>
                            {roleMode === 'coach' ? (
                              <button
                                type="button"
                                data-testid={`delete-session-${row.workout.id}`}
                                onClick={() => deleteWorkout(row.workout.id)}
                                className="mt-1 h-6 px-1 text-[10px] text-[#FF453A] hover:text-white flex items-center gap-1"
                              >
                                <Trash2 size={10} />
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {roleMode === 'coach' ? (
                          <button
                            type="button"
                            data-testid={`add-session-day-${micro.id}-${dateStr}`}
                            onClick={() => addOnDay(dateStr, micro.id)}
                            className="mt-auto h-7 px-1 text-[10px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
                          >
                            <Plus size={10} />
                            Session
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

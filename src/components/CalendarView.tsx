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

function firstOpenDate(start: string, end: string, occupied: Set<string>): string {
  const open = eachIsoDate(start, end).find((date) => !occupied.has(date));
  return open ?? start;
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
  const [assignError, setAssignError] = useState<string | null>(null);
  const [addDates, setAddDates] = useState<Record<string, string>>({});
  const dragPayloadRef = useRef<{ workoutId: string; microId: string; date: string } | null>(null);

  const sessionsForWeek = (microId: string) =>
    placed
      .filter((row) => {
        if (row.micro.id !== microId) return false;
        if (filter === 'All') return true;
        const titles = row.workout.exercises.map((exercise) => exercise.title.toLowerCase());
        if (filter === 'Squat') return titles.some((title) => title.includes('squat'));
        if (filter === 'Bench') return titles.some((title) => title.includes('bench'));
        if (filter === 'Deadlift') {
          return titles.some((title) => title.includes('deadlift') || title.includes('dead'));
        }
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.workout.dayLabel.localeCompare(b.workout.dayLabel));

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

  const handleDropOnWeek = (event: DragEvent, targetMicroId: string) => {
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
    if (!payload) return;
    if (payload.microId !== targetMicroId) {
      setBoundaryLockVisible(true);
      return;
    }
    setBoundaryLockVisible(false);
  };

  const moveSession = (workoutId: string, microId: string, nextDate: string) => {
    const microIndex = microcycles.findIndex((micro) => micro.id === microId);
    const micro = microIndex === -1 ? undefined : microcycles[microIndex];
    if (!micro || !dateInMicrocycle(nextDate, micro, microIndex)) {
      setBoundaryLockVisible(true);
      return false;
    }
    setBoundaryLockVisible(false);
    rescheduleWorkout(workoutId, nextDate);
    return true;
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
        <div className="flex flex-col gap-3">
          {microcycles.map((micro, microIndex) => {
            const bounds = resolvedMicrocycleBounds(micro, microIndex);
            const rows = sessionsForWeek(micro.id);
            const occupied = new Set<string>(rows.map((row) => row.date));
            const addDate = addDates[micro.id] ?? firstOpenDate(bounds.start, bounds.end, occupied);
            const selected = activeMicrocycleId === micro.id;
            return (
              <section
                key={micro.id}
                data-testid={`week-board-${micro.id}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropOnWeek(event, micro.id)}
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

                <div data-testid={`week-sessions-${micro.id}`} className="flex flex-col">
                  {rows.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-[#636366]">No sessions in this week.</p>
                  ) : (
                    rows.map((row) => (
                      <div
                        key={row.workout.id}
                        data-testid={`workout-card-${row.workout.id}`}
                        draggable={roleMode === 'coach'}
                        onDragStart={(event) => handleDragStart(event, row.workout.id, row.micro.id, row.date)}
                        className="border-b border-white/10 px-1 py-1.5 flex items-center gap-2"
                      >
                        <button
                          type="button"
                          onClick={() => onViewSession(row.workout, row.micro.id)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="text-[11px] text-white">
                            {row.workout.dayLabel || 'Session'}
                          </span>
                          <span className="ml-2 font-mono text-[11px] text-[#AEAEB2]">
                            {liftLine(row.workout)}
                            {isWorkoutCompleted(row.workout.status) ? ' ✓' : ''}
                          </span>
                        </button>
                        {roleMode === 'coach' ? (
                          <input
                            data-testid={`calendar-session-date-${row.workout.id}`}
                            type="date"
                            value={row.date}
                            min={bounds.start}
                            max={bounds.end}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next) moveSession(row.workout.id, micro.id, next);
                            }}
                            className="h-7 bg-[#161616] border border-white/10 text-[#AEAEB2] font-mono text-[11px] px-1 scheme-dark"
                          />
                        ) : (
                          <span className="font-mono text-[11px] text-[#AEAEB2]">{row.date}</span>
                        )}
                        {roleMode === 'coach' ? (
                          <button
                            type="button"
                            data-testid={`delete-session-${row.workout.id}`}
                            onClick={() => deleteWorkout(row.workout.id)}
                            className="h-7 px-2 text-[10px] text-[#FF453A] hover:text-white flex items-center gap-1 shrink-0"
                          >
                            <Trash2 size={10} />
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                {roleMode === 'coach' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <label className="sr-only" htmlFor={`add-session-date-${micro.id}`}>
                      Session date
                    </label>
                    <input
                      id={`add-session-date-${micro.id}`}
                      data-testid={`add-session-date-${micro.id}`}
                      type="date"
                      value={addDate}
                      min={bounds.start}
                      max={bounds.end}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next) setAddDates((prev) => ({ ...prev, [micro.id]: next }));
                      }}
                      className="h-7 bg-[#161616] border border-white/10 text-[#AEAEB2] font-mono text-[11px] px-1 scheme-dark"
                    />
                    <button
                      type="button"
                      data-testid={`add-session-week-${micro.id}`}
                      onClick={() => addOnDay(addDate, micro.id)}
                      className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
                    >
                      <Plus size={12} />
                      Session
                    </button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

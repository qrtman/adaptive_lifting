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
  inferMicrocycleId,
  mondayOf,
  placedSessions,
  resolvedMicrocycleBounds,
  sundayOf,
} from '../services/workoutDays';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function timelineRows(start: string, end: string): string[][] {
  const days = eachIsoDate(mondayOf(start), sundayOf(end));
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return rows;
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

  const weekBounds = useMemo(
    () =>
      microcycles.map((micro, index) => ({
        micro,
        index,
        bounds: resolvedMicrocycleBounds(micro, index),
      })),
    [microcycles],
  );

  const span = useMemo(() => {
    if (weekBounds.length === 0) return null;
    const starts = weekBounds.map((row) => row.bounds.start).sort();
    const ends = weekBounds.map((row) => row.bounds.end).sort();
    return { start: starts[0], end: ends[ends.length - 1] };
  }, [weekBounds]);

  const rows = useMemo(
    () => (span ? timelineRows(span.start, span.end) : []),
    [span],
  );

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
      setAssignError("That day is outside every week. Adjust a week's dates first.");
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

  return (
    <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto bg-[#0A0A0A]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="text-sm text-white">
          {span ? `${span.start} – ${span.end}` : 'Calendar'}
        </h3>
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
        <>
          <div className="flex flex-col gap-1">
            {weekBounds.map(({ micro, bounds }) => {
              const selected = activeMicrocycleId === micro.id;
              return (
                <div
                  key={micro.id}
                  data-testid={`week-board-${micro.id}`}
                  className={`flex flex-wrap items-center gap-2 px-1 py-1 border ${
                    selected ? 'border-[#007AFF]/60' : 'border-transparent'
                  }`}
                >
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
              );
            })}
          </div>

          <div data-testid="calendar-timeline" className="border border-white/10 bg-[#131313]">
            <div className="flex">
              <div className="w-16 shrink-0" />
              <div className="grid grid-cols-7 flex-1">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="h-6 px-1 font-mono text-[10px] text-[#AEAEB2]">
                    {day}
                  </div>
                ))}
              </div>
            </div>
            {rows.map((row) => {
              const labels = [...new Set(row.flatMap((date) => ownersOn(date).map((item) => item.micro.weekName)))];
              return (
                <div key={row[0]} className="flex border-t border-white/10">
                  <div className="w-16 shrink-0 px-1 py-1 text-[10px] text-[#AEAEB2] leading-tight">
                    {labels.join(' · ') || '—'}
                  </div>
                  <div className="grid grid-cols-7 flex-1">
                    {row.map((dateStr) => {
                      const dayWorkouts = sessionsOn(dateStr);
                      const owners = ownersOn(dateStr);
                      const inSelected = owners.some((item) => item.micro.id === activeMicrocycleId);
                      const dayNumber = dateStr.slice(8, 10);
                      return (
                        <div
                          key={dateStr}
                          data-testid={`calendar-day-${dateStr}`}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleDrop(event, dateStr)}
                          className={`min-h-[72px] p-1 flex flex-col border-l border-white/10 bg-[#161616] ${
                            owners.length === 0 ? 'opacity-40' : ''
                          } ${inSelected ? 'bg-[#007AFF]/5' : ''} ${
                            boundaryFlashDate === dateStr ? 'ring-2 ring-[#FF453A] bg-[#FF453A]/10' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-[11px] text-[#AEAEB2]">{dayNumber}</span>
                            {roleMode === 'coach' && owners.length > 0 ? (
                              <button
                                type="button"
                                data-testid={`add-session-day-${dateStr}`}
                                onClick={() => addOnDay(dateStr)}
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
                                  {rowItem.micro.weekName} {rowItem.workout.dayLabel || 'Session'}
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
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { inferMicrocycleId } from '../services/workoutDays';
import { MicrocycleData, WorkoutData } from '../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthCells(year: number, monthIndex: number): Array<{ date: string; inMonth: boolean; day: number }> {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const utcDay = first.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() + mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const cell = new Date(start);
    cell.setUTCDate(start.getUTCDate() + i);
    return {
      date: formatUtc(cell),
      inMonth: cell.getUTCMonth() === monthIndex,
      day: cell.getUTCDate(),
    };
  });
}

function newWorkoutId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AddSessionDialog({
  open,
  onClose,
  sourceMicrocycleId,
  initialDate,
  microcycles,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  sourceMicrocycleId: string;
  initialDate?: string;
  microcycles: MicrocycleData[];
  onCreate: (workout: WorkoutData, microcycleId: string) => void;
}) {
  const source = microcycles.find((m) => m.id === sourceMicrocycleId);
  const seedDate = initialDate || source?.workouts[0]?.date || '2026-09-01';
  const seed = parseUtc(seedDate);
  const [year, setYear] = useState(seed.getUTCFullYear());
  const [monthIndex, setMonthIndex] = useState(seed.getUTCMonth());
  const [date, setDate] = useState(seedDate);
  const [assignedMicrocycleId, setAssignedMicrocycleId] = useState(
    inferMicrocycleId(seedDate, microcycles, sourceMicrocycleId),
  );
  const [error, setError] = useState<string | null>(null);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, Array<{ workout: WorkoutData; weekName: string; microId: string }>>();
    for (const micro of microcycles) {
      for (const workout of micro.workouts) {
        const list = map.get(workout.date) ?? [];
        list.push({ workout, weekName: micro.weekName, microId: micro.id });
        map.set(workout.date, list);
      }
    }
    return map;
  }, [microcycles]);

  const cells = useMemo(() => monthCells(year, monthIndex), [year, monthIndex]);
  const assignedMicro = microcycles.find((m) => m.id === assignedMicrocycleId);

  useEffect(() => {
    if (!open) return;
    const nextSeed = initialDate ?? source?.workouts[0]?.date ?? '2026-09-01';
    const parsed = parseUtc(nextSeed);
    setYear(parsed.getUTCFullYear());
    setMonthIndex(parsed.getUTCMonth());
    setDate(nextSeed);
    setAssignedMicrocycleId(inferMicrocycleId(nextSeed, microcycles, sourceMicrocycleId));
    setError(null);
  }, [open, source, sourceMicrocycleId, initialDate, microcycles]);

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(year, monthIndex + delta, 1));
    setYear(next.getUTCFullYear());
    setMonthIndex(next.getUTCMonth());
  };

  const selectDay = (nextDate: string) => {
    setDate(nextDate);
    setAssignedMicrocycleId(inferMicrocycleId(nextDate, microcycles, assignedMicrocycleId || sourceMicrocycleId));
    setError(null);
  };

  const create = () => {
    if (!date) {
      setError('Pick a day.');
      return;
    }
    if (!assignedMicrocycleId) {
      setError('Assign a microcycle.');
      return;
    }
    const workout: WorkoutData = {
      id: newWorkoutId(),
      date,
      dayLabel: '',
      title: '',
      tonnage: 0,
      delta: 0,
      color: 'mac-blue',
      status: 'PLANNED',
      exercises: [],
    };
    onCreate(workout, assignedMicrocycleId);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        create();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, date, assignedMicrocycleId, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2">
      <div
        role="dialog"
        aria-labelledby="add-session-title"
        data-testid="add-session-dialog"
        className="w-full max-w-xl bg-[#131313] border border-white/10 flex flex-col"
      >
        <div className="h-10 px-3 flex items-center justify-between border-b border-white/10">
          <h2 id="add-session-title" className="text-sm text-white">
            Add Session
          </h2>
          <button type="button" onClick={onClose} className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white">
            Esc
          </button>
        </div>
        <div className="p-3 flex flex-col gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#636366] mb-1">Assign microcycle</p>
            {microcycles.length === 0 ? (
              <p role="status" className="text-xs text-[#AEAEB2]">
                No microcycles in this mesocycle.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {microcycles.map((micro) => {
                  const selected = assignedMicrocycleId === micro.id;
                  return (
                    <button
                      key={micro.id}
                      type="button"
                      data-testid={`assign-micro-${micro.id}`}
                      onClick={() => {
                        setAssignedMicrocycleId(micro.id);
                        setError(null);
                      }}
                      className={`h-7 px-2 text-[11px] border ${
                        selected
                          ? 'border-[#007AFF] text-white'
                          : 'border-white/10 text-[#AEAEB2] hover:text-white'
                      }`}
                    >
                      {micro.weekName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="h-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm text-white">
              {MONTHS[monthIndex]} {year}
            </p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((day) => (
              <div key={day} className="h-6 px-1 font-mono text-[10px] text-[#AEAEB2]">
                {day}
              </div>
            ))}
            {cells.map((cell) => {
              const existing = sessionsByDate.get(cell.date) ?? [];
              const selected = date === cell.date;
              return (
                <button
                  key={cell.date}
                  type="button"
                  data-testid={`session-day-${cell.date}`}
                  onClick={() => selectDay(cell.date)}
                  className={`min-h-14 p-1 text-left border ${
                    selected ? 'border-[#007AFF]' : 'border-white/10'
                  } ${cell.inMonth ? 'bg-[#131313]' : 'opacity-40'}`}
                >
                  <span className="font-mono text-[11px] text-[#AEAEB2]">
                    {String(cell.day).padStart(2, '0')}
                  </span>
                  {existing.map(({ workout, weekName }) => (
                    <span key={workout.id} className="block truncate text-[9px] text-[#AEAEB2]">
                      {weekName.replace('Microcycle ', 'W')} {workout.dayLabel}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
          <p className="text-xs font-mono text-[#AEAEB2]">
            {date}
            {assignedMicro ? ` · ${assignedMicro.weekName}` : ' · assign a microcycle'}
          </p>
          {error ? (
            <p role="alert" className="text-xs text-[#FF453A]">
              {error}
            </p>
          ) : null}
        </div>
        <div className="px-3 pb-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 text-[11px] text-[#AEAEB2] hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            data-testid="create-session"
            onClick={create}
            className="h-8 px-3 text-[11px] bg-[#007AFF] text-white"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

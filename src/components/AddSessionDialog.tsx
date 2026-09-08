import { useEffect, useMemo, useState } from 'react';
import { WorkoutData } from '../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function weekDatesForMicrocycle(workouts: WorkoutData[]): string[] {
  if (workouts.length === 0) return [];
  const sorted = [...workouts].map((w) => w.date).sort();
  const first = parseUtc(sorted[0]);
  const utcDay = first.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(first);
  monday.setUTCDate(first.getUTCDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const next = new Date(monday);
    next.setUTCDate(monday.getUTCDate() + i);
    return formatUtc(next);
  });
}

export function openSessionSlots(workouts: WorkoutData[]): Array<{ date: string; label: string }> {
  const taken = new Set(workouts.map((w) => w.date));
  return weekDatesForMicrocycle(workouts)
    .map((date, index) => ({
      date,
      label: `${WEEKDAYS[index]} ${date.slice(8)}`,
    }))
    .filter((slot) => !taken.has(slot.date));
}

function newWorkoutId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AddSessionDialog({
  open,
  onClose,
  workouts,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  workouts: WorkoutData[];
  onCreate: (workout: WorkoutData) => void;
}) {
  const slots = useMemo(() => openSessionSlots(workouts), [workouts]);
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(slots[0]?.date ?? '');
    setTitle('');
    setError(null);
  }, [open, slots]);

  const create = () => {
    if (slots.length === 0) {
      setError('All days this week already have a session.');
      return;
    }
    if (!date) {
      setError('Pick an open day.');
      return;
    }
    const name = title.trim();
    if (!name) {
      setError('Name the session.');
      return;
    }
    const dayNumber = workouts.length + 1;
    const workout: WorkoutData = {
      id: newWorkoutId(),
      date,
      dayLabel: `D${dayNumber}`,
      title: name,
      tonnage: 0,
      delta: 0,
      color: 'mac-blue',
      status: 'PLANNED',
      exercises: [],
    };
    onCreate(workout);
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
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2">
      <div
        role="dialog"
        aria-labelledby="add-session-title"
        data-testid="add-session-dialog"
        className="w-full max-w-md bg-[#131313] border border-white/10 flex flex-col"
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
          {slots.length === 0 ? (
            <p className="text-xs text-[#636366]">All days this week already have a session.</p>
          ) : (
            <>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#636366] mb-1">Open day</p>
                <div className="flex flex-wrap gap-1">
                  {slots.map((slot) => (
                    <button
                      key={slot.date}
                      type="button"
                      data-testid={`session-slot-${slot.date}`}
                      onClick={() => setDate(slot.date)}
                      className={`h-7 px-2 text-[11px] ${date === slot.date ? 'text-white' : 'text-[#AEAEB2] hover:text-white'}`}
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[#636366]">
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Secondary Squat, Accessories"
                  data-testid="add-session-title"
                  className="h-8 px-2 bg-[#161616] border border-white/10 text-sm text-white normal-case tracking-normal placeholder:text-[#636366]"
                />
              </label>
            </>
          )}
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
            disabled={slots.length === 0}
            className="h-8 px-3 text-[11px] bg-[#007AFF] text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

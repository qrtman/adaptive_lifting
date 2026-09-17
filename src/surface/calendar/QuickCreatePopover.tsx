import { useEffect, useLayoutEffect, useState } from 'react';
import { INSPECTOR_SNAP_A } from '../breakpoints';
import { SessionCreateForm } from './SessionCreateForm';
import type { WorkoutData } from '../../types';

type Box = { top: number; left: number };

function positionFor(iso: string, minWidth: number, height = 460): Box {
  const cell = document.querySelector(`[data-testid="calendar-day-${iso}"]`);
  const rect = cell?.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { top: 48, left: Math.max(8, (vw - minWidth) / 2) };
  let left = rect.right + 8;
  if (left + minWidth > vw - 8) left = Math.max(8, rect.left - minWidth - 8);
  let top = rect.top;
  if (top + height > vh - 8) top = Math.max(8, vh - height - 8);
  return { top, left };
}

export function QuickCreatePopover({
  date,
  athleteId,
  overlay,
  focusNotes,
  online,
  onClose,
  onCreated,
}: {
  date: string;
  athleteId?: string | null;
  overlay: boolean;
  focusNotes?: boolean;
  online?: boolean;
  onClose: () => void;
  onCreated: (workout: WorkoutData & { microcycleId?: string }) => void | Promise<void>;
}) {
  const [box, setBox] = useState<Box>({ top: 48, left: 48 });

  useLayoutEffect(() => {
    if (overlay) return;
    setBox(positionFor(date, INSPECTOR_SNAP_A));
  }, [date, overlay]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`New session · ${date}`}
      data-testid="new-session-dialog"
      className="bg-inspector border border-border rounded p-4 shadow-[var(--sticky-shadow)]"
      style={{ minWidth: overlay ? undefined : INSPECTOR_SNAP_A, width: overlay ? '100%' : INSPECTOR_SNAP_A }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="text-ui text-fg-strong">New session · {date}</h2>
        <button
          type="button"
          data-testid="dialog-close"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center text-fg-muted hover:text-fg-strong"
        >
          ×
        </button>
      </div>
      <SessionCreateForm
        date={date}
        athleteId={athleteId}
        focusNotes={focusNotes}
        online={online}
        onClose={onClose}
        onCreated={onCreated}
      />
    </div>
  );

  if (overlay) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-canvas/70">
        <button type="button" aria-label="Close dialog" className="absolute inset-0" onClick={onClose} />
        <div className="relative z-10 h-full w-full max-w-full overflow-y-auto" style={{ minWidth: Math.min(INSPECTOR_SNAP_A, window.innerWidth) }}>
          {panel}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close dialog" className="absolute inset-0" onClick={onClose} />
      <div className="absolute z-10" style={{ top: box.top, left: box.left }}>
        {panel}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Set number + set note (session sheet phase 6). The number cell is a button: a dot after the
 * number means the set has a note; clicking opens a small editor next to it. Saving an empty
 * note clears it. Read-only (locked) still opens the note to read it.
 */
export function setNoteText(note: unknown): string {
  return typeof note === 'string' ? note.trim() : '';
}

export function SetNoteCell({
  label,
  note,
  readOnly,
  onSave,
  testId,
  className = '',
  title,
}: {
  /** Set number shown in the cell ("3", "2–4"). */
  label: string;
  note: string;
  readOnly: boolean;
  /** Receives the trimmed note, or null to clear it. */
  onSave?: (note: string | null) => void;
  testId: string;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasNote = note.length > 0;
  const canEdit = !readOnly && Boolean(onSave);

  useEffect(() => { if (!open) setDraft(note); }, [note, open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = 260;
    setPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
  }, [open]);

  const close = (save: boolean) => {
    if (save && canEdit) {
      const next = draft.trim();
      if (next !== note) onSave?.(next || null);
    } else {
      setDraft(note);
    }
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Click outside saves, like the lift note does when it loses focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(true);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });

  const tip = hasNote ? note : canEdit ? 'Add a set note' : title;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid={testId}
        data-has-note={hasNote ? 'true' : undefined}
        aria-label={hasNote ? `Set ${label} note: ${note}` : `Set ${label}${canEdit ? ', add a note' : ''}`}
        aria-expanded={open}
        title={tip}
        disabled={!canEdit && !hasNote}
        onClick={() => (open ? close(true) : setOpen(true))}
        className={`relative inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-[var(--cal-radius-md)] px-1 tnum hover:bg-[var(--cal-surface-strong)] hover:text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] disabled:pointer-events-none ${className}`}
      >
        {label}
        {hasNote ? (
          <span data-testid={`${testId}-dot`} aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cal-accent)]" />
        ) : null}
      </button>
      {open && pos ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Set ${label} note`}
          data-testid={`${testId}-editor`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 260 }}
          className="z-50 flex flex-col gap-1.5 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-elevated)] p-2 shadow-[var(--cal-shadow-lift)]"
        >
          <textarea
            data-testid={`${testId}-input`}
            aria-label={`Set ${label} note`}
            autoFocus
            readOnly={!canEdit}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); close(true); }
              if (event.key === 'Escape') { event.preventDefault(); close(false); }
            }}
            placeholder="How this set went, cues…"
            rows={3}
            className="w-full resize-none rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-canvas)] px-2 py-1.5 text-[13px] leading-5 text-[var(--cal-ink)] placeholder:text-[var(--cal-muted-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
          />
          {canEdit ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--cal-muted)]">Ctrl+Enter saves · Esc cancels</span>
              <div className="flex gap-1">
                {hasNote ? (
                  <button type="button" data-testid={`${testId}-clear`} onClick={() => { setDraft(''); onSave?.(null); setOpen(false); }}
                    className="h-7 rounded-[var(--cal-radius-md)] px-2 text-[12px] text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]">
                    Clear
                  </button>
                ) : null}
                <button type="button" data-testid={`${testId}-save`} onClick={() => close(true)}
                  className="h-7 rounded-[var(--cal-radius-md)] px-2 text-[12px] font-medium text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]">
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

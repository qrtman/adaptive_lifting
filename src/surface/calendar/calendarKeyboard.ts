export type CalendarShortcut =
  | { type: 'move'; key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' }
  | { type: 'open' }
  | { type: 'create' }
  | { type: 'prevMonth' }
  | { type: 'nextMonth' }
  | { type: 'today' }
  | { type: 'help' }
  | { type: 'escape' };

export function calendarShortcut(event: {
  key: string;
  target?: EventTarget | { tagName?: string } | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): CalendarShortcut | null {
  const tag = event.target && 'tagName' in event.target ? String(event.target.tagName) : undefined;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    return { type: 'move', key: event.key };
  }
  if (event.key === 'Enter') return { type: 'open' };
  if (event.key === 'n' || event.key === 'N') return { type: 'create' };
  if (event.key === '[') return { type: 'prevMonth' };
  if (event.key === ']') return { type: 'nextMonth' };
  if (event.key === 't' || event.key === 'T') return { type: 'today' };
  if (event.key === '?') return { type: 'help' };
  if (event.key === 'Escape') return { type: 'escape' };
  return null;
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { apiService } from '../services/api';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import type { DashboardMode } from '../navigation';
import { ATHLETE_SEARCH_THRESHOLD } from '../navigation';

export type RosterAthlete = {
  id: string;
  email: string;
  displayName?: string | null;
  activeMicrocycles?: number;
};

type ScopeItem = {
  id: string;
  label: string;
  email: string;
};

export function AthleteScopeSelector({
  collapsed = false,
  forceOpen = false,
  onOpened,
  onNavigate,
}: {
  collapsed?: boolean;
  forceOpen?: boolean;
  onOpened?: () => void;
  onNavigate?: (mode: DashboardMode) => void;
}) {
  const { user } = useAuth();
  const { activeAthleteId, setActiveAthleteId } = usePeriodization();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';

  const [roster, setRoster] = useState<RosterAthlete[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isCoach) return;
    let cancelled = false;
    apiService.fetchRoster()
      .then((data) => {
        if (cancelled) return;
        const linked = Array.isArray(data) ? data : [];
        setRoster(linked);
        const ids = new Set(linked.map((athlete) => athlete.id));
        if (linked.length === 0) {
          setActiveAthleteId(null);
          return;
        }
        if (!activeAthleteId || !ids.has(activeAthleteId)) {
          setActiveAthleteId(linked[0].id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRoster([]);
        setActiveAthleteId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isCoach, setActiveAthleteId]);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      onOpened?.();
      window.requestAnimationFrame(() => {
        listRef.current?.focus();
      });
    }
  }, [forceOpen, onOpened]);

  const items: ScopeItem[] = useMemo(
    () => roster.map((athlete) => ({ id: athlete.id, label: athlete.displayName?.trim() || athlete.email, email: athlete.email })),
    [roster],
  );

  const searchable = items.length > ATHLETE_SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q) || item.email.toLowerCase().includes(q));
  }, [items, query]);

  const selected = items.find((item) => item.id === activeAthleteId);
  const triggerLabel = selected?.label || 'Select athlete…';

  const selectItem = (id: string) => {
    setActiveAthleteId(id);
    setOpen(false);
    setQuery('');
  };

  const openSecurity = () => {
    setOpen(false);
    onNavigate?.('security');
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlight(filtered.length - 1);
    } else if (event.key === 'Enter' && filtered[highlight]) {
      event.preventDefault();
      selectItem(filtered[highlight].id);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const pushProgram = async () => {
    if (!activeAthleteId) return;
    setPushBusy(true);
    setPushNote('');
    try {
      const result = await apiService.pushProgramming(activeAthleteId, 'Custom');
      setPushNote(result.message || 'Push acknowledged. Create sessions on the athlete plan.');
    } catch (err) {
      setPushNote(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushBusy(false);
    }
  };

  if (!isCoach) return null;

  const emptyList = (
    <div className="px-2 py-2">
      <p className="text-[11px] text-[var(--cal-muted)]">No linked athletes.</p>
      <button
        type="button"
        data-testid="athlete-scope-security"
        onClick={openSecurity}
        className="mt-1 text-left text-[11px] text-[var(--cal-accent)] hover:text-[var(--cal-ink)]"
      >
        Generate a coach code in Security
      </button>
    </div>
  );

  const optionList = (
    <div
      ref={listRef}
      id="athlete-scope-list"
      role="listbox"
      tabIndex={0}
      aria-label="Linked athletes"
      data-testid="athlete-scope-list"
      onKeyDown={onListKeyDown}
      className="max-h-48 overflow-y-auto outline-none"
    >
      {filtered.length === 0
        ? (items.length === 0 ? emptyList : (
          <p className="px-2 py-2 text-[11px] text-[var(--cal-muted)]">No matches.</p>
        ))
        : filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === activeAthleteId}
              data-testid={`athlete-option-${item.id}`}
              onClick={() => selectItem(item.id)}
              className={`w-full px-2 py-1.5 text-left text-[12px] truncate ${
                index === highlight
                  ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]'
                  : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]'
              }`}
            >
              <span className="block truncate">{item.label}</span>
              {item.label !== item.email && <span className="block truncate text-[10px] text-[var(--cal-muted)]">{item.email}</span>}
            </button>
          ))}
    </div>
  );

  if (collapsed) {
    return (
      <div className="relative mb-2">
        <button
          type="button"
          data-testid="athlete-scope-selector"
          title={triggerLabel}
          aria-label="Select athlete"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="w-full h-8 flex items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] border border-transparent"
        >
          {(selected?.label || '·').slice(0, 1).toUpperCase()}
        </button>
        {open && (
          <div className="absolute left-full top-0 ml-1 z-50 w-56 border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-elevated)] shadow-sm">
            {optionList}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="px-2 pb-3 border-b border-[var(--cal-hairline)] mb-3">
      <button
        type="button"
        id="athlete-scope-selector"
        data-testid="athlete-scope-selector"
        aria-label="Select athlete"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="athlete-scope-list"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-8 px-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] text-[12px] text-[var(--cal-ink)] text-left truncate hover:bg-[var(--cal-surface-card)]"
      >
        {triggerLabel}
      </button>
      {open && (
        <div className="mt-1 cal-nested-card p-0 shadow-[var(--cal-shadow-lift)]" data-elevated="true">
          {searchable && (
            <input
              id="athlete-scope-input"
              data-testid="athlete-scope-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              placeholder="Search athletes"
              className="w-full h-8 px-2 text-[12px] bg-transparent text-[var(--cal-ink)] border-b border-[var(--cal-hairline)] placeholder:text-[var(--cal-muted)]"
            />
          )}
          {optionList}
        </div>
      )}
      {selected && (
        <div className="mt-1">
          <button
            type="button"
            data-testid="athlete-scope-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="text-[11px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] h-7"
          >
            Plan actions
          </button>
          {menuOpen && (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className="h-7 text-left text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                onClick={() => onNavigate?.('calendar')}
              >
                Open calendar
              </button>
              <button
                type="button"
                className="h-7 text-left text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
                onClick={() => onNavigate?.('sessions')}
              >
                Open sessions
              </button>
              <button
                type="button"
                data-testid="athlete-push-program"
                disabled={pushBusy}
                className="h-7 text-left text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] disabled:opacity-50"
                onClick={() => void pushProgram()}
              >
                {pushBusy ? 'Pushing…' : 'Acknowledge push'}
              </button>
              {pushNote && <p className="text-[10px] text-[var(--cal-muted)]">{pushNote}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

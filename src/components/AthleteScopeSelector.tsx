import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useSync } from '../contexts/SyncContext';
import { apiService } from '../services/api';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import type { DashboardMode } from '../navigation';
import { ATHLETE_SEARCH_THRESHOLD } from '../navigation';

export type RosterAthlete = {
  id: string;
  email: string;
  activeMicrocycles?: number;
};

type ScopeItem = {
  id: string;
  label: string;
  hint: string;
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
  const { isOnline, pendingCount } = useSync();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const selfId = String(user?.id || getUiPref(UI_KEYS.userId) || 'self');
  const selfEmail = (user?.email as string | undefined) || getUiPref(UI_KEYS.email) || 'You';

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

  const items: ScopeItem[] = useMemo(() => {
    if (!isCoach) {
      return [{ id: selfId, label: selfEmail, hint: 'Your plan' }];
    }
    return roster.map((athlete) => ({
      id: athlete.id,
      label: athlete.email,
      hint: athlete.activeMicrocycles
        ? `${athlete.activeMicrocycles} active block${athlete.activeMicrocycles === 1 ? '' : 's'}`
        : 'Linked',
    }));
  }, [isCoach, roster, selfEmail, selfId]);

  const searchable = isCoach && items.length > ATHLETE_SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  const selected = items.find((item) => item.id === activeAthleteId) || (!isCoach ? items[0] : undefined);

  const selectItem = (id: string) => {
    if (isCoach) setActiveAthleteId(id);
    setOpen(false);
    setQuery('');
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

  if (collapsed) {
    return (
      <div className="relative mb-2">
        <button
          type="button"
          data-testid="athlete-scope-selector"
          title={selected?.label || 'Athlete plan'}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="w-full h-8 flex items-center justify-center rounded text-[#AEAEB2] hover:text-white hover:bg-white/5"
        >
          {(selected?.label || 'A').slice(0, 1).toUpperCase()}
        </button>
        {open && (
          <div className="absolute left-full top-0 ml-1 z-50 w-56 border border-white/10 rounded bg-[#161616]">
            <div
              ref={listRef}
              id="athlete-scope-list"
              role="listbox"
              tabIndex={0}
              aria-label="Athlete plan space"
              data-testid="athlete-scope-list"
              onKeyDown={onListKeyDown}
              className="max-h-48 overflow-y-auto outline-none"
            >
              {filtered.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === (activeAthleteId || selfId)}
                  data-testid={`athlete-option-${item.id}`}
                  onClick={() => selectItem(item.id)}
                  className={`w-full px-2 py-1.5 text-left text-[12px] ${
                    index === highlight ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="px-2 pb-3 border-b border-white/10 mb-3">
      <label htmlFor="athlete-scope-input" className="text-[10px] text-[#636366] uppercase tracking-wider block mb-1">
        Athlete plan
      </label>
      <button
        type="button"
        id="athlete-scope-selector"
        data-testid="athlete-scope-selector"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="athlete-scope-list"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-8 px-2 rounded bg-[#1a1a1a] border border-white/10 text-[12px] text-white text-left truncate"
      >
        {selected?.label || (isCoach ? 'Select athlete…' : selfEmail)}
      </button>
      <p className="mt-1 text-[10px] text-[#636366] font-mono">
        {isOnline ? (pendingCount > 0 ? `Queue ${pendingCount}` : 'Live') : 'Offline'}
        {selected?.hint ? ` · ${selected.hint}` : ''}
      </p>
      {open && (
        <div className="mt-1 border border-white/10 rounded bg-[#161616]">
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
              className="w-full h-8 px-2 text-[12px] bg-transparent text-white border-b border-white/10"
            />
          )}
          <div
            ref={listRef}
            id="athlete-scope-list"
            role="listbox"
            tabIndex={0}
            aria-label="Athlete plan space"
            data-testid="athlete-scope-list"
            onKeyDown={onListKeyDown}
            className="max-h-48 overflow-y-auto outline-none"
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-[#AEAEB2]">
                {isCoach ? 'No linked athletes.' : 'No plan.'}
              </p>
            ) : (
              filtered.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === (activeAthleteId || selfId)}
                  data-testid={`athlete-option-${item.id}`}
                  onClick={() => selectItem(item.id)}
                  className={`w-full px-2 py-1.5 text-left text-[12px] ${
                    index === highlight ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
                  }`}
                >
                  <span className="block truncate">{item.label}</span>
                  <span className="block text-[10px] text-[#636366]">{item.hint}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {isCoach && selected && (
        <div className="mt-1">
          <button
            type="button"
            data-testid="athlete-scope-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="text-[11px] text-[#AEAEB2] hover:text-white h-7"
          >
            Plan actions
          </button>
          {menuOpen && (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className="h-7 text-left text-[12px] text-[#AEAEB2] hover:text-white"
                onClick={() => onNavigate?.('calendar')}
              >
                Open calendar
              </button>
              <button
                type="button"
                className="h-7 text-left text-[12px] text-[#AEAEB2] hover:text-white"
                onClick={() => onNavigate?.('sessions')}
              >
                Open sessions
              </button>
              <button
                type="button"
                data-testid="athlete-push-program"
                disabled={pushBusy}
                className="h-7 text-left text-[12px] text-[#AEAEB2] hover:text-white disabled:opacity-50"
                onClick={() => void pushProgram()}
              >
                {pushBusy ? 'Pushing…' : 'Acknowledge push'}
              </button>
              {pushNote && <p className="text-[10px] text-[#AEAEB2]">{pushNote}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

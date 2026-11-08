import React, { useEffect, useRef } from 'react';

export interface BlockTab {
  key: string;
  label: string;
  /** Second line: date range for a labeled block, session count for Unassigned. */
  detail: string;
  count: number;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

function parts(date: string): { month: string; day: number } | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!parsed) return null;
  const value = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
  return { month: MONTH.format(value), day: value.getUTCDate() };
}

/** "Nov 3", "Nov 3 – 30", "Nov 28 – Dec 21" from ISO session dates. */
export function formatBlockRange(first: string, last: string): string {
  const a = parts(first);
  const b = parts(last);
  if (!a) return b ? `${b.month} ${b.day}` : '';
  if (!b || (a.month === b.month && a.day === b.day)) return `${a.month} ${a.day}`;
  return a.month === b.month ? `${a.month} ${a.day} – ${b.day}` : `${a.month} ${a.day} – ${b.month} ${b.day}`;
}

export const sessionCountLabel = (count: number) => `${count} session${count === 1 ? '' : 's'}`;

/**
 * One tab per Block (plus Unassigned). Replaces the native select so the choices,
 * their dates and the current one are visible at a glance. ← → / Home / End move
 * between tabs (WAI-ARIA tabs, automatic activation).
 */
export const BlockTabs: React.FC<{
  tabs: BlockTab[];
  selectedKey: string;
  onSelect: (key: string) => void;
}> = ({ tabs, selectedKey, onSelect }) => {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    buttons.current.get(selectedKey)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedKey]);

  const move = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.key === selectedKey);
    const last = tabs.length - 1;
    const next = event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : -1;
    if (next < 0 || !tabs[next]) return;
    event.preventDefault();
    onSelect(tabs[next].key);
    buttons.current.get(tabs[next].key)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Block"
      data-testid="sessions-block-picker"
      data-value={selectedKey}
      onKeyDown={move}
      className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:thin]"
    >
      {tabs.map((tab) => {
        const selected = tab.key === selectedKey;
        return (
          <button
            key={tab.key}
            ref={(node) => { if (node) buttons.current.set(tab.key, node); else buttons.current.delete(tab.key); }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={`${tab.label} · ${sessionCountLabel(tab.count)}`}
            data-testid={`sessions-block-tab-${tab.key}`}
            onClick={() => onSelect(tab.key)}
            className={`shrink-0 min-w-24 h-10 px-2.5 flex flex-col items-start justify-center rounded-[var(--cal-radius-md)] border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${selected
              ? 'border-[var(--cal-hairline)] bg-[var(--cal-surface-strong)] text-[var(--cal-ink)] shadow-[inset_2px_0_0_var(--cal-accent)]'
              : 'border-transparent text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)] hover:text-[var(--cal-ink)]'}`}
          >
            <span className="text-[11px] font-semibold leading-tight">{tab.label}</span>
            <span className="text-[10px] leading-tight tnum text-[var(--cal-muted)]">{tab.detail}</span>
          </button>
        );
      })}
    </div>
  );
};

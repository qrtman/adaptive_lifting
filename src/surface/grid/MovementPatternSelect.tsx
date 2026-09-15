import { useEffect, useRef, useState } from 'react';
import { MOVEMENT_PATTERNS, type MovementPattern } from '../../services/exerciseCatalog';
import { AnchoredMenu, getOpenMenu, MenuOption, setOpenMenu, subscribeOpenMenu } from '../ui/ComboBox';

export function MovementPatternSelect({
  value,
  onChange,
  locked = false,
  id,
  collapsed = false,
}: {
  value?: MovementPattern | string | null;
  onChange: (value: MovementPattern) => void;
  locked?: boolean;
  id?: string;
  collapsed?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const menuId = id ? `movement-pattern-${id}` : 'movement-pattern';
  const selected = (MOVEMENT_PATTERNS as readonly string[]).includes(value || '')
    ? (value as MovementPattern)
    : 'Misc';
  const filtered = query.trim()
    ? MOVEMENT_PATTERNS.filter((pattern) => pattern.toLowerCase().includes(query.trim().toLowerCase()))
    : [...MOVEMENT_PATTERNS];

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (open) setOpenMenu(menuId);
    return () => {
      if (getOpenMenu() === menuId) setOpenMenu(null);
    };
  }, [open, menuId]);

  useEffect(() => subscribeOpenMenu((next) => {
    if (next && next !== menuId) setOpen(false);
  }), [menuId]);

  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [active, filtered.length]);

  const pick = (pattern: MovementPattern) => {
    onChange(pattern);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        data-testid={menuId}
        data-value={selected}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Pattern ${selected}`}
        disabled={locked}
        onClick={() => {
          if (collapsed) return;
          setOpen((next) => !next);
          setQuery('');
        }}
        onPointerEnter={() => {
          if (collapsed || locked) return;
          if (getOpenMenu() && getOpenMenu() !== menuId) {
            buttonRef.current?.focus();
            setOpen(true);
            setQuery('');
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === 'ArrowDown' && open) {
            event.preventDefault();
            setActive((index) => Math.min(filtered.length - 1, index + 1));
            return;
          }
          if (event.key === 'ArrowUp' && open) {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
            return;
          }
          if (event.key === 'Enter' && open) {
            event.preventDefault();
            const next = filtered[active];
            if (next) pick(next);
            return;
          }
          if (open && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
            setQuery((prev) => prev + event.key);
            setActive(0);
          }
          if (open && event.key === 'Backspace') {
            event.preventDefault();
            setQuery((prev) => prev.slice(0, -1));
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as HTMLElement | null;
          if (next?.closest?.('[role="listbox"]')) return;
          setOpen(false);
          setQuery('');
        }}
        className="h-5 max-w-[9rem] px-1.5 text-micro bg-cell border border-border rounded text-fg-muted truncate disabled:opacity-40"
      >
        {selected}
      </button>
      <AnchoredMenu
        open={open && !collapsed}
        onOpenChange={setOpen}
        reference={buttonRef.current}
        label="Movement pattern"
        minWidth={220}
      >
        {filtered.map((pattern, index) => (
          <MenuOption
            key={pattern}
            active={index === active}
            selected={pattern === selected}
            onEnter={() => setActive(index)}
            onPick={() => pick(pattern)}
          >
            {pattern}
          </MenuOption>
        ))}
      </AnchoredMenu>
    </div>
  );
}

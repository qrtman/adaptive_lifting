import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

type TabsContextValue = {
  value: string;
  setValue: (next: string) => void;
  baseId: string;
  lazy: boolean;
  orientation: 'horizontal' | 'vertical';
  registerTab: (id: string) => void;
  tabIds: string[];
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const value = useContext(TabsContext);
  if (!value) throw new Error('Tabs parts must be used inside <Tabs>');
  return value;
}

export function Tabs({
  value,
  defaultValue,
  onChange,
  lazy = false,
  orientation = 'horizontal',
  children,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  lazy?: boolean;
  orientation?: 'horizontal' | 'vertical';
  children: ReactNode;
}) {
  const baseId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue || '');
  const [tabIds, setTabIds] = useState<string[]>([]);
  const current = value ?? uncontrolled;

  const setValue = useCallback((next: string) => {
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
  }, [onChange, value]);

  const registerTab = useCallback((id: string) => {
    setTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const ctx = useMemo(
    () => ({ value: current, setValue, baseId, lazy, orientation, registerTab, tabIds }),
    [current, setValue, baseId, lazy, orientation, registerTab, tabIds],
  );

  return <TabsContext.Provider value={ctx}>{children}</TabsContext.Provider>;
}

export function TabList({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const { orientation } = useTabsContext();
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={className}
    >
      {children}
    </div>
  );
}

export function Tab({
  id,
  children,
  className = '',
  activeClassName = 'bg-white/10 text-white',
  inactiveClassName = 'text-[#AEAEB2] hover:text-white',
}: {
  id: string;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  key?: string | number;
}) {
  const { value, setValue, baseId, orientation, registerTab, tabIds } = useTabsContext();
  const selected = value === id;
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    registerTab(id);
  }, [id, registerTab]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = orientation === 'vertical'
      ? ['ArrowUp', 'ArrowDown']
      : ['ArrowLeft', 'ArrowRight'];
    const idx = tabIds.indexOf(id);
    if (idx < 0) return;
    let nextIdx = idx;
    if (event.key === keys[0]) nextIdx = (idx - 1 + tabIds.length) % tabIds.length;
    else if (event.key === keys[1]) nextIdx = (idx + 1) % tabIds.length;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = tabIds.length - 1;
    else return;
    event.preventDefault();
    const nextId = tabIds[nextIdx];
    setValue(nextId);
    const nextEl = document.getElementById(`${baseId}-tab-${nextId}`);
    nextEl?.focus();
  };

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${baseId}-tab-${id}`}
      aria-controls={`${baseId}-panel-${id}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-testid={`tab-${id}`}
      className={`${className} ${selected ? activeClassName : inactiveClassName}`}
      onClick={() => setValue(id)}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

export function TabPanel({
  id,
  children,
  className = '',
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { value, baseId, lazy } = useTabsContext();
  const selected = value === id;
  if (lazy && !selected) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={!selected}
      className={className}
    >
      {children}
    </div>
  );
}

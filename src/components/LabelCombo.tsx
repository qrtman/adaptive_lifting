import { useMemo, useState } from 'react';
import type { MicrocycleData } from '../types';

const NEW_VALUE = '__new__';

export function uniquePlanLabels(
  microcycles: MicrocycleData[],
  key: 'blockLabel' | 'weekLabel',
): string[] {
  const seen = new Set<string>();
  for (const micro of microcycles) {
    for (const workout of micro.workouts) {
      const value = workout[key]?.trim();
      if (value) seen.add(value);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function LabelCombo({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  testId: string;
}) {
  const known = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of options) {
      const item = raw.trim();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      list.push(item);
    }
    return list;
  }, [options]);

  const [adding, setAdding] = useState(() => Boolean(value.trim()) && !known.includes(value.trim()));
  const custom = adding || (value.trim() !== '' && !known.includes(value.trim()));
  const selectValue = custom ? NEW_VALUE : value;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#636366]">{label}</span>
      <select
        data-testid={testId}
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === NEW_VALUE) {
            setAdding(true);
            if (known.includes(value)) onChange('');
            return;
          }
          setAdding(false);
          onChange(next);
        }}
        className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
      >
        <option value="">None</option>
        {known.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
        <option value={NEW_VALUE}>Add new…</option>
      </select>
      {custom ? (
        <input
          data-testid={`${testId}-custom`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
        />
      ) : null}
    </label>
  );
}

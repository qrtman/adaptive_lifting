import { useMemo, useState } from 'react';
import { formatPlanLabel, normalizeDayLabel } from '../features/plan/sessionLabels';
import type { MicrocycleData } from '../types';

const DAY_PRESETS = ['1', '2', '3', '4', '5', '6', '7'];

const NEW_VALUE = '__new__';

const inputClass =
  'h-10 w-full min-w-0 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

const labelClass = 'text-[10px] uppercase tracking-wider text-[var(--cal-muted)] leading-4';

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

export function uniquePlanTitles(microcycles: MicrocycleData[]): string[] {
  const seen = new Set<string>();
  for (const micro of microcycles) {
    for (const workout of micro.workouts) {
      const title = workout.title?.trim();
      if (!title || title === 'Session') continue;
      seen.add(title);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function dayComboOptions(microcycles: MicrocycleData[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const add = (label: string) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  };
  for (const preset of DAY_PRESETS) {
    add(formatPlanLabel('Day', preset) || `Day ${preset}`);
  }
  for (const micro of microcycles) {
    for (const workout of micro.workouts) {
      const canonical = normalizeDayLabel(workout.dayLabel);
      if (!canonical) continue;
      add(formatPlanLabel('Day', canonical) || canonical);
    }
  }
  return labels;
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
    <label className="flex w-full min-w-0 flex-col gap-1">
      <span className={labelClass}>{label}</span>
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
        className={inputClass}
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
          className={inputClass}
        />
      ) : null}
    </label>
  );
}

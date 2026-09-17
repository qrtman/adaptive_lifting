import { ComboBox } from '../surface/ui/ComboBox';
import type { MicrocycleData } from '../types';

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
  const workouts = microcycles.flatMap((micro) => micro.workouts);
  workouts.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const workout of workouts) {
    const title = workout.title?.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
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
  return (
    <ComboBox
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      testId={testId}
      allowEmpty
      allowCreate
      emptyLabel="None"
    />
  );
}

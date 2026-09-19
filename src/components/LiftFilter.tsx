import { Tab, TabList, Tabs } from './ui/Tabs';

export type LiftFilterValue = 'All' | 'Squat' | 'Bench' | 'Deadlift';

const LIFTS: readonly LiftFilterValue[] = ['All', 'Squat', 'Bench', 'Deadlift'];

export function LiftFilter({
  value,
  onChange,
}: {
  value: LiftFilterValue;
  onChange: (value: LiftFilterValue) => void;
}) {
  return (
    <Tabs value={value} onChange={(next) => onChange(next as LiftFilterValue)}>
      <TabList
        label="Lift filter"
        className="inline-flex items-center gap-0.5 p-1 rounded-[var(--cal-radius-pill)] bg-[var(--cal-surface-soft)]"
      >
        {LIFTS.map((lift) => (
          <Tab
            key={lift}
            id={lift}
            className="px-2.5 h-7 text-xs rounded-[var(--cal-radius-md)] tnum font-medium transition-colors"
            activeClassName="bg-[var(--cal-surface-elevated)] text-[var(--cal-ink)] shadow-sm"
            inactiveClassName="text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
          >
            {lift}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}

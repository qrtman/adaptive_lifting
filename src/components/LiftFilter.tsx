import { Tab, TabList, Tabs } from './ui/Tabs';

export type LiftFilterValue = 'All' | 'Squat' | 'Bench' | 'Deadlift';

export function LiftFilter({
  value,
  onChange,
}: {
  value: LiftFilterValue;
  onChange: (value: LiftFilterValue) => void;
}) {
  return (
    <Tabs value={value} onChange={(next) => onChange(next as LiftFilterValue)}>
      <TabList label="Lift filter" className="flex items-center gap-0.5">
        {(['All', 'Squat', 'Bench', 'Deadlift'] as const).map((lift) => (
          <Tab
            key={lift}
            id={lift}
            className="px-2 h-7 text-caption rounded"
          >
            {lift}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}

export type LiftFilterValue = 'All' | 'Squat' | 'Bench' | 'Deadlift';

export function LiftFilter({
  value,
  onChange,
}: {
  value: LiftFilterValue;
  onChange: (value: LiftFilterValue) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {(['All', 'Squat', 'Bench', 'Deadlift'] as const).map((lift) => (
        <button
          key={lift}
          type="button"
          onClick={() => onChange(lift)}
          className={`px-2 h-7 text-xs rounded ${
            value === lift ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
          }`}
        >
          {lift}
        </button>
      ))}
    </div>
  );
}

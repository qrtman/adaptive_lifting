import type { KeyboardEvent } from 'react';

const MAX = 99;

const buttonClass =
  'h-10 w-9 shrink-0 flex items-center justify-center text-base text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cal-accent)]';

/** Whole number 1–99 or empty ("none"). − from 1 clears; + from empty gives 1. */
export function NumberStepper({
  label,
  value,
  onChange,
  testId,
  id,
  autoFocus = false,
}: {
  id?: string;
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  testId: string;
  autoFocus?: boolean;
}) {
  const step = (delta: 1 | -1) => {
    if (value === null) {
      if (delta > 0) onChange(1);
      return;
    }
    const next = value + delta;
    onChange(next < 1 ? null : Math.min(next, MAX));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowDown') { event.preventDefault(); step(-1); }
  };

  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-10 w-[120px] shrink-0 items-stretch overflow-hidden rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-canvas)] focus-within:border-[var(--cal-accent)]"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Decrease ${label}`}
        data-testid={`${testId}-dec`}
        disabled={value === null}
        onClick={() => step(-1)}
        className={buttonClass}
      >
        −
      </button>
      <input
        id={id}
        data-testid={testId}
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        data-autofocus={autoFocus ? 'true' : undefined}
        value={value === null ? '' : String(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 2);
          const next = digits ? Number(digits) : null;
          onChange(next && next >= 1 ? next : null);
        }}
        onKeyDown={onKeyDown}
        className="h-10 w-full min-w-0 bg-transparent text-center text-base font-semibold tnum text-[var(--cal-ink)] outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Increase ${label}`}
        data-testid={`${testId}-inc`}
        disabled={value !== null && value >= MAX}
        onClick={() => step(1)}
        className={buttonClass}
      >
        +
      </button>
    </div>
  );
}

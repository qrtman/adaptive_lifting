import { useState } from 'react';

const NONE = '';
const NEW = '__new__';

const fieldClass =
  'h-10 w-full min-w-0 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] placeholder:text-[var(--cal-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

/** One spelling per block, compared case-insensitively. First spelling wins. */
export function distinctBlocks(labels: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const raw of labels) {
    const value = raw?.trim();
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()];
}

/** A typed name that matches an existing block (any case) uses the existing spelling. */
export function resolveBlockName(typed: string, existing: string[]): string | null {
  const value = typed.trim();
  if (!value) return null;
  return existing.find((block) => block.toLowerCase() === value.toLowerCase()) ?? value;
}

/** The existing block with this name (any case), or null when there is none. */
export function existingBlock(name: string | null | undefined, existing: string[]): string | null {
  const value = name?.trim().toLowerCase();
  if (!value) return null;
  return existing.find((block) => block.toLowerCase() === value) ?? null;
}

/**
 * Block: pick an existing one so names stay consistent, or add a new one.
 * `value` is the stored label (null = no block).
 */
export function BlockPicker({
  value,
  blocks,
  onChange,
  testId,
  id,
  autoFocus = false,
}: {
  id?: string;
  autoFocus?: boolean;
  value: string | null;
  blocks: string[];
  onChange: (next: string | null) => void;
  testId: string;
}) {
  const known = value ? blocks.find((block) => block.toLowerCase() === value.toLowerCase()) : undefined;
  const [adding, setAdding] = useState(Boolean(value) && !known);
  const [draft, setDraft] = useState(value && !known ? value : '');
  const selected = adding ? NEW : known ?? NONE;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <select
        id={id}
        data-testid={testId}
        data-autofocus={autoFocus ? 'true' : undefined}
        value={selected}
        onChange={(event) => {
          const next = event.target.value;
          if (next === NEW) {
            setAdding(true);
            onChange(resolveBlockName(draft, blocks));
            return;
          }
          setAdding(false);
          onChange(next === NONE ? null : next);
        }}
        className={fieldClass}
      >
        <option value={NONE}>No block</option>
        {blocks.map((block) => <option key={block} value={block}>{block}</option>)}
        <option value={NEW}>New block…</option>
      </select>
      {adding ? (
        <input
          data-testid={`${testId}-new`}
          aria-label="New block name"
          autoFocus
          autoComplete="off"
          placeholder="Block name"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(resolveBlockName(event.target.value, blocks));
          }}
          className={fieldClass}
        />
      ) : null}
    </div>
  );
}

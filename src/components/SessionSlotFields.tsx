import { useId, type ReactNode } from 'react';
import { BlockPicker } from './BlockPicker';
import { ComboBox } from './ComboBox';
import { NumberStepper } from './NumberStepper';

const rowLabelClass = 'text-sm font-medium text-[var(--cal-ink)]';

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-3">
      <label htmlFor={htmlFor} className={`${rowLabelClass} pt-2.5`}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * New / Edit session form: Block, Week + Day, Name. Labels sit beside the fields.
 * Day and Week are numbers; Block is picked from existing blocks.
 */
export function SessionSlotFields({
  day,
  week,
  block,
  blocks,
  title,
  nameOptions,
  onDay,
  onWeek,
  onBlock,
  onTitle,
  testIdPrefix,
  titleTestId,
  legacyDay,
  legacyWeek,
  autoFocusFirst = false,
  dateField,
}: {
  day: number | null;
  week: number | null;
  block: string | null;
  blocks: string[];
  title: string;
  nameOptions: string[];
  onDay: (next: number | null) => void;
  onWeek: (next: number | null) => void;
  onBlock: (next: string | null) => void;
  onTitle: (next: string) => void;
  testIdPrefix: string;
  titleTestId: string;
  /** A stored text label that is not a number (kept unless a number is picked). */
  legacyDay?: string | null;
  legacyWeek?: string | null;
  /** Focus the first field (Block) when the dialog opens. */
  autoFocusFirst?: boolean;
  /** Optional date input row (Sessions view lets you pick the date). */
  dateField?: { id: string; node: ReactNode };
}) {
  const ids = useId();
  const blockId = `${ids}-block`;
  const weekId = `${ids}-week`;
  const dayId = `${ids}-day`;
  const legacy = [
    legacyWeek && week === null ? `Week "${legacyWeek}"` : null,
    legacyDay && day === null ? `Day "${legacyDay}"` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3" data-testid={`${testIdPrefix}-slot-row`}>
      {dateField ? <Row label="Date" htmlFor={dateField.id}>{dateField.node}</Row> : null}
      <Row label="Block" htmlFor={blockId}>
        <BlockPicker id={blockId} value={block} blocks={blocks} onChange={onBlock} testId={`${testIdPrefix}-block`} autoFocus={autoFocusFirst} />
      </Row>
      <Row label="Week" htmlFor={weekId}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <NumberStepper id={weekId} label="Week" value={week} onChange={onWeek} testId={`${testIdPrefix}-week`} />
          {/* "Day" stays with its stepper when the row wraps on narrow screens. */}
          <span className="inline-flex items-center gap-2">
            <label htmlFor={dayId} className={rowLabelClass}>Day</label>
            <NumberStepper id={dayId} label="Day" value={day} onChange={onDay} testId={`${testIdPrefix}-day`} />
          </span>
        </div>
        {legacy.length ? (
          <p data-testid={`${testIdPrefix}-legacy`} className="mt-1.5 text-xs text-[var(--cal-muted)]">
            Current {legacy.join(', ')}. Pick a number to replace it, or leave it as is.
          </p>
        ) : null}
      </Row>
      <Row label="Name">
        <ComboBox
          label="Name"
          hideLabel
          value={title}
          onChange={onTitle}
          options={nameOptions}
          testId={titleTestId}
        />
      </Row>
    </div>
  );
}

import { Copy, Trash2 } from 'lucide-react';

interface MicrocycleBoundsEditorProps {
  microId: string;
  start: string;
  end: string;
  readOnly?: boolean;
  showCopy?: boolean;
  showDelete?: boolean;
  onBoundsChange: (start: string, end: string) => void;
  onCopy?: () => void;
  onDelete?: () => void;
}

const dateInputClass =
  'h-7 bg-[#161616] border border-white/10 text-[#AEAEB2] font-mono text-[11px] px-1';

export function MicrocycleBoundsEditor({
  microId,
  start,
  end,
  readOnly = false,
  showCopy = false,
  showDelete = false,
  onBoundsChange,
  onCopy,
  onDelete,
}: MicrocycleBoundsEditorProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 scheme-dark">
      {readOnly ? (
        <span
          data-testid={`sessions-week-dates-${microId}`}
          className="font-mono text-[11px] text-[#AEAEB2]"
        >
          {start === end ? start : `${start} – ${end}`}
        </span>
      ) : (
        <>
          <label className="sr-only" htmlFor={`micro-bound-start-${microId}`}>
            Microcycle start
          </label>
          <input
            id={`micro-bound-start-${microId}`}
            data-testid={`micro-bound-start-${microId}`}
            type="date"
            value={start}
            onChange={(event) => {
              const next = event.target.value;
              if (next && next <= end) onBoundsChange(next, end);
            }}
            className={dateInputClass}
          />
          <span className="text-[11px] text-[#636366]">–</span>
          <label className="sr-only" htmlFor={`micro-bound-end-${microId}`}>
            Microcycle end
          </label>
          <input
            id={`micro-bound-end-${microId}`}
            data-testid={`micro-bound-end-${microId}`}
            type="date"
            value={end}
            onChange={(event) => {
              const next = event.target.value;
              if (next && next >= start) onBoundsChange(start, next);
            }}
            className={dateInputClass}
          />
        </>
      )}
      {showCopy ? (
        <button
          type="button"
          data-testid={`copy-microcycle-${microId}`}
          onClick={onCopy}
          className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
        >
          <Copy size={12} />
          Copy
        </button>
      ) : null}
      {showDelete ? (
        <button
          type="button"
          data-testid={`delete-microcycle-${microId}`}
          onClick={onDelete}
          className="h-7 px-2 text-[11px] text-[#FF453A] hover:text-white flex items-center gap-1"
        >
          <Trash2 size={12} />
          Delete
        </button>
      ) : null}
    </div>
  );
}

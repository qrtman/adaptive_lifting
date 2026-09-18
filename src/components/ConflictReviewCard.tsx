import React from 'react';
import { AlertCircle, Check, X } from 'lucide-react';

interface ConflictReviewCardProps {
  entityType: string;
  field: string;
  serverValue: string;
  clientValue: string;
  onResolve: (action: 'keep_server' | 'force_client') => void;
}

export const ConflictReviewCard: React.FC<ConflictReviewCardProps> = ({
  entityType,
  field,
  serverValue,
  clientValue,
  onResolve
}) => {
  return (
    <div className="bg-[color-mix(in_srgb,var(--cal-error)_10%,var(--cal-surface-elevated))] border border-[color-mix(in_srgb,var(--cal-error)_30%,transparent)] rounded-[var(--cal-radius-lg)] p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="text-[var(--cal-error)] shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <h4 className="text-[var(--cal-error)] font-semibold text-sm tracking-tight mb-1">
            Sync conflict
          </h4>
          <p className="text-xs text-[var(--cal-body)] mb-3 leading-relaxed">
            Another device modified the <span className="text-[var(--cal-ink)]">{field}</span> on this <span className="text-[var(--cal-ink)]">{entityType}</span>.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="cal-nested-card p-[var(--cal-space-xs)]">
              <div className="text-[10px] text-[var(--cal-muted)] uppercase tracking-wider mb-1">Server (Current)</div>
              <div className="text-sm tnum text-[var(--cal-ink)] break-all">{serverValue || '—'}</div>
            </div>
            <div className="cal-nested-card p-[var(--cal-space-xs)]" data-elevated="true">
              <div className="text-[10px] text-[var(--cal-accent)] uppercase tracking-wider mb-1">Your Edit</div>
              <div className="text-sm tnum text-[var(--cal-ink)] break-all">{clientValue || '—'}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onResolve('keep_server')}
              className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] text-xs font-medium rounded-[var(--cal-radius-md)]"
            >
              <Check size={14} /> Keep Server
            </button>
            <button
              onClick={() => onResolve('force_client')}
              className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-[color-mix(in_srgb,var(--cal-error)_15%,transparent)] hover:bg-[color-mix(in_srgb,var(--cal-error)_25%,transparent)] text-[var(--cal-error)] text-xs font-medium rounded-[var(--cal-radius-md)]"
            >
              <X size={14} /> Force Mine
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

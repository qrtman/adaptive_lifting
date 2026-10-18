import React from 'react';
import { AlertCircle, Check, Download } from 'lucide-react';

interface ConflictReviewCardProps {
  mutationId: string;
  entityType: string;
  entityId: string;
  reason: string;
  serverFields?: Record<string, unknown>;
  clientFields: Record<string, unknown>;
  onKeepServer: () => void;
  onExport: () => void;
}

function display(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  return JSON.stringify(value, null, 2) ?? '—';
}

export const ConflictReviewCard: React.FC<ConflictReviewCardProps> = ({
  mutationId, entityType, entityId, reason, serverFields = {}, clientFields, onKeepServer, onExport,
}) => {
  const keys = [...new Set([...Object.keys(clientFields), ...Object.keys(serverFields)])];
  return (
    <section className="bg-[color-mix(in_srgb,var(--cal-error)_10%,var(--cal-surface-elevated))] border border-[color-mix(in_srgb,var(--cal-error)_30%,transparent)] rounded-[var(--cal-radius-lg)] p-4 mb-4" aria-label="Workout sync conflict">
      <div className="flex items-start gap-3">
        <AlertCircle className="text-[var(--cal-error)] shrink-0 mt-0.5" size={20} />
        <div className="flex-1 min-w-0">
          <h4 className="text-[var(--cal-error)] font-semibold text-sm tracking-tight mb-1">Sync conflict needs review</h4>
          <p className="text-xs text-[var(--cal-body)] mb-3 leading-relaxed">
            {reason === 'TOMBSTONE_CONFLICT'
              ? `The server deleted ${entityType} ${entityId}. Your queued edit remains saved on this device.`
              : `${entityType} ${entityId} has a newer server version (${reason}). Your queued edit is still saved on this device.`}
          </p>
          <div className="space-y-2 mb-4">
            {keys.map(key => (
              <div key={key} className="grid grid-cols-2 gap-3">
                <div className="cal-nested-card p-[var(--cal-space-xs)] min-w-0">
                  <div className="text-[10px] text-[var(--cal-muted)] uppercase tracking-wider mb-1">Server · {key}</div>
                  <pre className="text-xs tnum text-[var(--cal-ink)] break-words whitespace-pre-wrap">{display(serverFields[key])}</pre>
                </div>
                <div className="cal-nested-card p-[var(--cal-space-xs)] min-w-0" data-elevated="true">
                  <div className="text-[10px] text-[var(--cal-accent)] uppercase tracking-wider mb-1">Your edit · {key}</div>
                  <pre className="text-xs tnum text-[var(--cal-ink)] break-words whitespace-pre-wrap">{display(clientFields[key])}</pre>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={onKeepServer} className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] text-xs font-medium rounded-[var(--cal-radius-md)]">
              <Check size={14} /> Keep Server
            </button>
            <button onClick={onExport} aria-label={`Export edit ${mutationId}`} className="flex items-center justify-center gap-1.5 flex-1 py-2 border border-[var(--cal-border)] text-[var(--cal-ink)] text-xs font-medium rounded-[var(--cal-radius-md)]">
              <Download size={14} /> Export my edit
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

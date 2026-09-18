import { AlertCircle, CloudOff, RefreshCw } from 'lucide-react';
import { useSync } from '../contexts/SyncContext';
import { syncOverlayState, type SyncOverlayState } from '../services/syncOverlayState';

type VisibleOverlay = Exclude<SyncOverlayState, { kind: 'hidden' }>;

function chipClass(kind: VisibleOverlay['kind']): string {
  const base =
    'fixed z-40 pointer-events-none bg-[var(--cal-surface-elevated)] border border-[var(--cal-hairline)] text-[11px] font-mono shadow-[var(--cal-shadow-soft)]';
  if (kind === 'syncing') {
    return `${base} h-8 w-8 rounded-full text-[var(--cal-accent)] flex items-center justify-center`;
  }
  if (kind === 'offline') {
    return `${base} h-8 max-w-[120px] rounded-[var(--cal-radius-md)] px-2 text-[var(--cal-warning)] flex items-center gap-1`;
  }
  return `${base} h-8 max-w-[120px] rounded-[var(--cal-radius-md)] border-[color-mix(in_srgb,var(--cal-error)_30%,transparent)] px-2 text-[var(--cal-error)] flex items-center gap-1`;
}

function chipCorner(collide: boolean): string {
  return collide ? 'top-4 right-4' : 'right-4 bottom-4';
}

function overlayLabel(state: VisibleOverlay): { ariaLabel: string; title: string; text: string } {
  switch (state.kind) {
    case 'offline':
      return {
        ariaLabel: 'Offline — queued locally',
        title: 'Offline — queued locally',
        text: 'Offline — queued locally',
      };
    case 'syncing':
      return {
        ariaLabel: `Sync queue ${state.pendingCount}`,
        title: `Sync queue ${state.pendingCount}`,
        text: '',
      };
    case 'error':
      return {
        ariaLabel: `Rejected ${state.rejectedCount}`,
        title: `Rejected ${state.rejectedCount}`,
        text: 'Needs review',
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function SyncQueueOverlay({ collide }: { collide: boolean }) {
  const { isOnline, pendingCount, rejectedCount } = useSync();
  const state = syncOverlayState({ isOnline, pendingCount, rejectedCount });
  if (state.kind === 'hidden') return null;

  const copy = overlayLabel(state);

  return (
    <div
      data-testid="sync-status"
      data-state={state.kind}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={copy.ariaLabel}
      title={copy.title}
      className={`${chipClass(state.kind)} ${chipCorner(collide)}`}
    >
      {state.kind === 'syncing' ? (
        <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
      ) : state.kind === 'offline' ? (
        <>
          <CloudOff size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{copy.text}</span>
        </>
      ) : (
        <>
          <AlertCircle size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{copy.text}</span>
        </>
      )}
    </div>
  );
}

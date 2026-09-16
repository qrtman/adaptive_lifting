import { AlertCircle, CloudOff, RefreshCw } from 'lucide-react';
import { useSync } from '../contexts/SyncContext';
import { syncOverlayState, type SyncOverlayState } from '../services/syncOverlayState';

type VisibleOverlay = Exclude<SyncOverlayState, { kind: 'hidden' }>;

function chipClass(kind: VisibleOverlay['kind']): string {
  const base = 'fixed z-40 pointer-events-none bg-[#131313] text-[11px] font-mono';
  if (kind === 'syncing') {
    return `${base} h-8 w-8 rounded-full border border-white/10 text-[#007AFF] flex items-center justify-center`;
  }
  if (kind === 'offline') {
    return `${base} h-8 max-w-[120px] rounded-lg border border-white/10 px-2 text-[#F5A623] flex items-center gap-1`;
  }
  return `${base} h-8 max-w-[120px] rounded-lg border border-red-500/30 px-2 text-red-500 flex items-center gap-1`;
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

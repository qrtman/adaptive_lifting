import { useAuth } from './AuthContext';
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { countMutationsByStatus, getPendingMutations, getConflictedMutations, resolveMutationKeepServer, exportConflictMutation, type SyncMutation } from '../services/db';
import { processPendingQueues, processSyncQueue } from '../services/sync_engine';
import { ConflictReviewCard } from '../components/ConflictReviewCard';
import { WorkoutLockBanner } from '../components/WorkoutLockBanner';
import { SyncQueueOverlay } from '../components/SyncQueueOverlay';

interface SyncLockNotice {
  workout_id: string;
  code: string;
  message: string;
}

interface SyncState {
  isOnline: boolean;
  pendingCount: number;
  rejectedCount: number;
  triggerSync: (workout_id: string) => void;
  conflicts: any[];
}

const SyncContext = createContext<SyncState>({
  isOnline: true,
  pendingCount: 0,
  rejectedCount: 0,
  triggerSync: () => {},
  conflicts: []
});

export const useSync = () => useContext(SyncContext);

export const SyncProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const { user } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [conflicts, setConflicts] = useState<SyncMutation[]>([]);
  const [locks, setLocks] = useState<SyncLockNotice[]>([]);

  const refreshCounts = async () => {
    const pending = await getPendingMutations();
    const rejected = await countMutationsByStatus('REJECTED');
    setPendingCount(pending.length);
    setRejectedCount(rejected);
  };

  const refreshConflicts = async () => setConflicts(await getConflictedMutations());

  useEffect(() => {
    if (!user) { setPendingCount(0); setRejectedCount(0); setConflicts([]); setLocks([]); return; }
    const flushPending = async () => {
      try {
        const nextConflicts = await processPendingQueues();
        if (nextConflicts.length > 0) await refreshConflicts();
        await refreshCounts();
      } catch {
        // Preserve the IndexedDB queue when storage or the network is unavailable.
      }
    };
    const handleOnline = () => {
      setIsOnline(true);
      void flushPending();
    };
    const handleOffline = () => setIsOnline(false);
    
    const handleConflicts = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) void refreshConflicts().catch(() => undefined);
    };

    const handleLock = (e: any) => {
      const detail = e.detail as SyncLockNotice | undefined;
      if (!detail?.workout_id) return;
      setLocks((prev) => {
        if (prev.some((lock) => lock.workout_id === detail.workout_id)) return prev;
        return [...prev, {
          workout_id: detail.workout_id,
          code: detail.code || 'WORKOUT_LOCKED',
          message: detail.message || 'This workout is locked right now.',
        }];
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sync-conflicts', handleConflicts);
    window.addEventListener('sync-lock', handleLock);

    // The user may reauthenticate while the browser is already online; do not
    // wait for a future `online` event before attempting retained mutations.
    void flushPending();
    void refreshConflicts().catch(() => undefined);
    void refreshCounts().catch(() => {
      // IndexedDB may not be ready
    });

    // Poll for pending count
    const interval = window.setInterval(async () => {
      try {
        await refreshCounts();
      } catch (e) {
        // Ignore DB not ready yet
      }
    }, 1000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sync-conflicts', handleConflicts);
      window.removeEventListener('sync-lock', handleLock);
      clearInterval(interval);
    };
  }, [user?.id]);

  const triggerSync = (workout_id: string) => {
    if (!user) return;
    processSyncQueue(workout_id).then(async () => {
       await refreshConflicts();
       try {
         await refreshCounts();
       } catch {
         // IndexedDB may not be ready
       }
    });
  };

  const handleKeepServer = async (mutationId: string) => {
    if (!window.confirm('Keep the current server values? Your unsynchronized edit will remain available for 28 days and can be exported first.')) return;
    try {
      await resolveMutationKeepServer(mutationId);
      await refreshConflicts();
    } catch {
      // Keep the conflict visible until the local resolution is durably stored.
    }
  };

  const handleExportConflict = async (mutationId: string) => {
    const mutation = await exportConflictMutation(mutationId);
    if (!mutation) return;
    const blob = new Blob([JSON.stringify(mutation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `adaptive-lifting-conflict-${mutationId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SyncContext.Provider value={{ isOnline, pendingCount, rejectedCount, triggerSync, conflicts }}>
      {children}
      {user && <SyncQueueOverlay collide={locks.length > 0 || conflicts.length > 0} />}
      {(locks.length > 0 || conflicts.length > 0) && (
        <div className="fixed bottom-20 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm mx-auto">
          {locks.map((lock) => (
            <div key={lock.workout_id} className="pointer-events-auto">
              <WorkoutLockBanner
                message={lock.message}
                onDismiss={() => setLocks((prev) => prev.filter((item) => item.workout_id !== lock.workout_id))}
              />
            </div>
          ))}
          {conflicts.map((c) => (
             <div key={`conflict-${c.mutation_id}`} className="pointer-events-auto shadow-2xl">
               <ConflictReviewCard
                  mutationId={c.mutation_id}
                  entityType={c.entity_type}
                  entityId={c.entity_id}
                  reason={c.conflict?.reason || 'server revision changed'}
                  serverFields={c.conflict?.server_fields || {}}
                  clientFields={c.fields}
                  onKeepServer={() => void handleKeepServer(c.mutation_id)}
                  onExport={() => void handleExportConflict(c.mutation_id)}
               />
             </div>
          ))}
        </div>
      )}
    </SyncContext.Provider>
  );
};

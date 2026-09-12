import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getPendingMutations } from '../services/db';
import { isLockSyncCode, processSyncQueue } from '../services/sync_engine';
import { ConflictReviewCard } from '../components/ConflictReviewCard';
import { WorkoutLockBanner } from '../components/WorkoutLockBanner';

interface SyncLockNotice {
  workout_id: string;
  code: string;
  message: string;
}

interface SyncState {
  isOnline: boolean;
  pendingCount: number;
  triggerSync: (workout_id: string) => void;
  conflicts: any[];
}

const SyncContext = createContext<SyncState>({
  isOnline: true,
  pendingCount: 0,
  triggerSync: () => {},
  conflicts: []
});

export const useSync = () => useContext(SyncContext);

function isTrueConflict(item: { reason?: string }): boolean {
  const reason = item?.reason;
  if (!reason) return true;
  if (isLockSyncCode(reason) || reason === '409_CONFLICT') return false;
  return true;
}

export const SyncProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [locks, setLocks] = useState<SyncLockNotice[]>([]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void (async () => {
        try {
          const pending = await getPendingMutations();
          const workoutIds = [...new Set(pending.map((m) => m.workout_id).filter(Boolean))] as string[];
          for (const id of workoutIds) {
            const nextConflicts = await processSyncQueue(id);
            if (nextConflicts && nextConflicts.length > 0) {
              setConflicts((prev) => [...prev, ...nextConflicts.filter(isTrueConflict)]);
            }
          }
          const left = await getPendingMutations();
          setPendingCount(left.length);
        } catch {
          // IndexedDB may not be ready
        }
      })();
    };
    const handleOffline = () => setIsOnline(false);
    
    const handleConflicts = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) {
        setConflicts(prev => [...prev, ...e.detail.filter(isTrueConflict)]);
      }
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

    // Poll for pending count
    const interval = window.setInterval(async () => {
      try {
        const pending = await getPendingMutations();
        setPendingCount(pending.length);
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
  }, []);

  const triggerSync = (workout_id: string) => {
    processSyncQueue(workout_id).then(newConflicts => {
       if (newConflicts && newConflicts.length > 0) {
         setConflicts(prev => [...prev, ...newConflicts.filter(isTrueConflict)]);
       }
    });
  };

  const handleResolveConflict = (index: number, action: string) => {
     // For now just dismiss it. Real app would re-submit or discard.
     setConflicts(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <SyncContext.Provider value={{ isOnline, pendingCount, triggerSync, conflicts }}>
      {children}
      {(locks.length > 0 || conflicts.length > 0) && (
        <div className="fixed bottom-20 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm mx-auto">
          {locks.map((lock) => (
            <div key={lock.workout_id} className="pointer-events-auto">
              <WorkoutLockBanner
                mode={/session is locked/i.test(lock.message) ? 'completed' : 'other_writer'}
                message={lock.message}
                onDismiss={() => setLocks((prev) => prev.filter((item) => item.workout_id !== lock.workout_id))}
              />
            </div>
          ))}
          {conflicts.map((c, i) => (
             <div key={`conflict-${i}`} className="pointer-events-auto shadow-2xl">
               <ConflictReviewCard 
                  entityType={c.entity_type || 'Workout'}
                  field={c.field_path || 'State'}
                  serverValue={c.reason || 'Server change detected'}
                  clientValue={'Local un-synced edit'}
                  onResolve={(action) => handleResolveConflict(i, action)}
               />
             </div>
          ))}
        </div>
      )}
    </SyncContext.Provider>
  );
};

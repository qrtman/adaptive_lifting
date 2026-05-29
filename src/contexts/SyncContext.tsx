import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getPendingMutations } from '../services/db';
import { processSyncQueue } from '../services/sync_engine';
import { ConflictReviewCard } from '../components/ConflictReviewCard';

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

export const SyncProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<any[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    const handleConflicts = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) {
        setConflicts(prev => [...prev, ...e.detail]);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sync-conflicts', handleConflicts);

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
      clearInterval(interval);
    };
  }, []);

  const triggerSync = (workout_id: string) => {
    processSyncQueue(workout_id).then(newConflicts => {
       if (newConflicts && newConflicts.length > 0) {
         setConflicts(prev => [...prev, ...newConflicts]);
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
      {/* Global Conflict Overlay */}
      {conflicts.length > 0 && (
        <div className="fixed bottom-20 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm mx-auto">
          {conflicts.map((c, i) => (
             <div key={i} className="pointer-events-auto shadow-2xl">
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

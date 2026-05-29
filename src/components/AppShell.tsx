import React, { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useSync } from '../contexts/SyncContext';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { isOnline, pendingCount } = useSync();

  return (
    <div className="flex min-h-screen relative overflow-hidden bg-[#0A0A0A] font-sans text-gray-200">
      {/* Background radial glow */}
      <div className="absolute top-[-25%] left-[-20%] w-[90vw] h-[90vh] rounded-full bg-mac-blue/2 opacity-[0.06] blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-25%] right-[-10%] w-[90vw] h-[90vh] rounded-full bg-mac-green/2 opacity-[0.04] blur-[150px] pointer-events-none" />

      <Sidebar />
      <main className="ml-64 flex-1 flex flex-col h-screen overflow-hidden relative">
        <Header />
        
        {/* Global Offline/Sync Status Strip */}
        {(!isOnline || pendingCount > 0) && (
          <div className={`h-7 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest shrink-0 ${
            !isOnline ? 'bg-red-500/20 text-red-500 border-b border-red-500/30' : 'bg-mac-blue/20 text-mac-blue border-b border-mac-blue/30'
          }`}>
            {!isOnline ? (
              <div className="flex items-center gap-2">
                <CloudOff size={12} />
                <span>Offline - Changes will sync when reconnected</span>
              </div>
            ) : pendingCount > 0 ? (
              <div className="flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" />
                <span>Syncing {pendingCount} changes...</span>
              </div>
            ) : null}
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
};

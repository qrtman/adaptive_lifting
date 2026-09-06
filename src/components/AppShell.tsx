import React, { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useSync } from '../contexts/SyncContext';
import { CloudOff, RefreshCw } from 'lucide-react';

export type DashboardMode = 'calendar' | 'sessions' | 'integrations' | 'insights' | 'security' | 'roster';

export const AppShell = ({
  children,
  dashboardMode,
  onNavigate,
  onResetPlan,
}: {
  children: ReactNode;
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  onResetPlan?: () => void;
}) => {
  const { isOnline, pendingCount } = useSync();

  return (
    <div className="flex min-h-screen overflow-hidden bg-[#0A0A0A] font-sans text-gray-200">
      <Sidebar
        dashboardMode={dashboardMode}
        onNavigate={onNavigate}
        onResetPlan={onResetPlan}
      />
      <main className="ml-[240px] flex-1 flex flex-col h-screen overflow-hidden">
        {(!isOnline || pendingCount > 0) && (
          <div
            data-testid="sync-status"
            data-state={!isOnline ? 'offline' : 'syncing'}
            className={`h-7 flex items-center px-4 text-[11px] font-mono shrink-0 ${
              !isOnline
                ? 'bg-red-500/20 text-red-500 border-b border-red-500/30'
                : 'bg-[#007AFF]/20 text-[#007AFF] border-b border-[#007AFF]/30'
            }`}
          >
            {!isOnline ? (
              <div className="flex items-center gap-2">
                <CloudOff size={12} />
                <span>Offline — queued locally</span>
              </div>
            ) : pendingCount > 0 ? (
              <div className="flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" />
                <span>Sync queue {pendingCount}</span>
              </div>
            ) : null}
          </div>
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          {children}
        </div>
      </main>
    </div>
  );
};

import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useSync } from '../contexts/SyncContext';
import { CloudOff, RefreshCw } from 'lucide-react';
import type { DashboardMode } from '../navigation';

export type { DashboardMode };

export const AppShell = ({
  children,
  dashboardMode,
  onNavigate,
  onResetPlan,
  sidebarCollapsed,
  onToggleSidebar,
  focusAthleteScope = false,
  onAthleteScopeFocused,
}: {
  children: ReactNode;
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  onResetPlan?: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  focusAthleteScope?: boolean;
  onAthleteScopeFocused?: () => void;
}) => {
  const { isOnline, pendingCount } = useSync();

  return (
    <div className="flex min-h-screen overflow-hidden bg-canvas font-sans text-fg">
      <Sidebar
        dashboardMode={dashboardMode}
        onNavigate={onNavigate}
        onResetPlan={onResetPlan}
        collapsed={sidebarCollapsed}
        onToggleCollapse={onToggleSidebar}
        focusAthleteScope={focusAthleteScope}
        onAthleteScopeFocused={onAthleteScopeFocused}
      />
      <main
        className={`relative flex-1 flex flex-col h-screen overflow-hidden ${sidebarCollapsed ? 'ml-[var(--sidebar-collapsed)]' : 'ml-[var(--sidebar-expanded)]'}`}
        data-testid="app-main"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        {(!isOnline || pendingCount > 0) && (
          <div
            data-testid="sync-status"
            data-state={!isOnline ? 'offline' : 'syncing'}
            className={`absolute top-0 left-0 right-0 z-20 h-7 flex items-center px-4 text-mini font-mono ${
              !isOnline
                ? 'bg-error/20 text-error border-b border-error/30'
                : 'bg-syncing/20 text-syncing border-b border-syncing/30'
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

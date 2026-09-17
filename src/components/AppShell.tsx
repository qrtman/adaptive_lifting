import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
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
  return (
    <div className="flex min-h-screen overflow-hidden bg-[#0A0A0A] font-sans text-gray-200">
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
        className={`flex-1 flex flex-col h-screen overflow-hidden ${sidebarCollapsed ? 'ml-[60px]' : 'ml-[240px]'}`}
        data-testid="app-main"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        <div className="flex-1 flex flex-col overflow-hidden">
          {children}
        </div>
      </main>
    </div>
  );
};

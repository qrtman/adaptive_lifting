import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import type { DashboardMode } from '../navigation';
import type { ThemePreference } from '../theme/themePref';

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
  theme,
  onToggleTheme,
}: {
  children: ReactNode;
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  onResetPlan?: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  focusAthleteScope?: boolean;
  onAthleteScopeFocused?: () => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
}) => {
  return (
    <div className="flex min-h-screen overflow-hidden bg-[var(--cal-canvas)] text-[var(--cal-ink)] font-sans">
      <Sidebar
        dashboardMode={dashboardMode}
        onNavigate={onNavigate}
        onResetPlan={onResetPlan}
        collapsed={sidebarCollapsed}
        onToggleCollapse={onToggleSidebar}
        focusAthleteScope={focusAthleteScope}
        onAthleteScopeFocused={onAthleteScopeFocused}
        theme={theme}
        onToggleTheme={onToggleTheme}
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

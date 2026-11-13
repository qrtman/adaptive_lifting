import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import type { DashboardMode } from '../navigation';
import type { ThemePreference } from '../theme/themePref';

export type { DashboardMode };

export const AppShell = ({
  children,
  dashboardMode,
  onNavigate,
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
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  focusAthleteScope?: boolean;
  onAthleteScopeFocused?: () => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
}) => {
  return (
    <div className="flex min-h-screen overflow-hidden bg-[var(--cal-canvas)] text-[var(--cal-ink)] font-sans antialiased">
      <Sidebar
        dashboardMode={dashboardMode}
        onNavigate={onNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={onToggleSidebar}
        focusAthleteScope={focusAthleteScope}
        onAthleteScopeFocused={onAthleteScopeFocused}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <main
        className={`app-main flex-1 flex flex-col h-screen overflow-hidden ${sidebarCollapsed ? 'md:ml-[60px]' : 'md:ml-[240px]'}`}
        data-testid="app-main"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        <div className="flex-1 flex flex-col overflow-hidden">
          {children}
        </div>
      </main>
      {/* Phones (< 768px): bottom tabs instead of the sidebar (.cursor/scopes/phone/PLAN.md, M1). */}
      <BottomNav
        dashboardMode={dashboardMode}
        onNavigate={onNavigate}
        focusAthleteScope={focusAthleteScope}
        onAthleteScopeFocused={onAthleteScopeFocused}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
    </div>
  );
};

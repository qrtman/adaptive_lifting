import { Calendar, BarChart3, Link2, Settings, List, PanelLeftClose, PanelLeft, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import type { ThemePreference } from '../theme/themePref';
import type { DashboardMode } from '../navigation';
import { AthleteScopeSelector } from './AthleteScopeSelector';

const PRIMARY: { mode: DashboardMode; label: string; testId?: string }[] = [
  { mode: 'calendar', label: 'Calendar', testId: 'nav-calendar' },
  { mode: 'sessions', label: 'Sessions', testId: 'nav-sessions' },
  { mode: 'insights', label: 'Insights', testId: 'nav-insights' },
];

const OPS: { mode: DashboardMode; label: string; testId?: string }[] = [
  { mode: 'integrations', label: 'Integrations', testId: 'nav-integrations' },
  { mode: 'security', label: 'Security', testId: 'nav-security' },
];

const ICONS: Record<DashboardMode, typeof Calendar> = {
  calendar: Calendar,
  sessions: List,
  insights: BarChart3,
  integrations: Link2,
  security: Settings,
};

function NavButton({
  mode,
  label,
  testId,
  active,
  collapsed,
  onNavigate,
}: {
  mode: DashboardMode;
  label: string;
  testId?: string;
  active: boolean;
  collapsed: boolean;
  onNavigate: (mode: DashboardMode) => void;
  key?: string;
}) {
  const Icon = ICONS[mode];
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      onClick={() => onNavigate(mode)}
      className={`w-full px-2 h-8 rounded flex items-center gap-2 text-left text-[13px] ${
        collapsed ? 'justify-center' : ''
      } ${
        active ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon size={14} className={active ? 'text-[#007AFF]' : ''} />
      {!collapsed && label}
    </button>
  );
}

export const Sidebar = ({
  dashboardMode,
  onNavigate,
  onResetPlan,
  collapsed,
  onToggleCollapse,
  focusAthleteScope = false,
  onAthleteScopeFocused,
  theme,
  onToggleTheme,
}: {
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  onResetPlan?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  focusAthleteScope?: boolean;
  onAthleteScopeFocused?: () => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
}) => {
  const { user, roleMode, signOut } = useAuth();
  const email = (user?.email as string | undefined) || getUiPref(UI_KEYS.email) || 'Signed in';
  const widthClass = collapsed ? 'w-[60px] min-w-[60px] max-w-[60px] px-1' : 'w-[240px] min-w-[240px] max-w-[240px] px-3';

  return (
    <aside
      data-testid="app-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`fixed left-0 top-0 h-screen ${widthClass} bg-[var(--cal-surface)] border-r border-[var(--cal-hairline)] flex flex-col py-4 z-50`}
    >
      <div className={`mb-4 flex items-center ${collapsed ? 'justify-center' : 'px-2 justify-between gap-2'}`}>
        {!collapsed && (
          <h1 className="text-xs font-semibold text-white tracking-wide uppercase truncate">Adaptive Lifting</h1>
        )}
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapse}
          className="h-8 w-8 flex items-center justify-center text-[#AEAEB2] hover:text-white"
        >
          {collapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      <AthleteScopeSelector
        collapsed={collapsed}
        forceOpen={focusAthleteScope}
        onOpened={onAthleteScopeFocused}
        onNavigate={onNavigate}
      />

      <nav className="flex-1 flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <NavButton
              key={item.mode}
              {...item}
              collapsed={collapsed}
              active={dashboardMode === item.mode}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2 pb-1 text-[10px] text-[#636366] uppercase tracking-wider">Ops</p>
          )}
          {OPS.map((item) => (
            <NavButton
              key={item.mode}
              {...item}
              collapsed={collapsed}
              active={dashboardMode === item.mode}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      <div className={`pt-3 border-t border-[var(--cal-hairline)] flex flex-col gap-1 ${collapsed ? 'items-center px-1' : 'px-2'}`}>
        {!collapsed && (
          <>
            <p className="text-xs text-[var(--cal-ink)] truncate">{email}</p>
            <p className="text-[11px] text-[var(--cal-muted)] capitalize">{roleMode}</p>
          </>
        )}
        <button
          type="button"
          data-testid="theme-toggle"
          aria-label={theme === 'light' ? 'Dark' : 'Light'}
          title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          onClick={onToggleTheme}
          className={`flex items-center gap-2 text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] h-7 ${
            collapsed ? 'justify-center w-full' : 'text-left'
          }`}
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          {!collapsed && (theme === 'light' ? 'Dark' : 'Light')}
        </button>
        <button type="button" onClick={signOut} className="text-left text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] h-7">
          {collapsed ? 'Out' : 'Sign out'}
        </button>
        {onResetPlan && (
          <button type="button" onClick={onResetPlan} className="text-left text-[12px] text-[#AEAEB2] hover:text-red-400 h-7">
            {collapsed ? 'Rst' : 'Reset plan'}
          </button>
        )}
      </div>
    </aside>
  );
};

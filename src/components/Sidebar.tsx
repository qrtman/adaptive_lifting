import { Calendar, BarChart3, Link2, Settings, List, Users, PanelLeftClose, PanelLeft, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import type { ThemePreference } from '../theme/themePref';
import type { DashboardMode } from '../navigation';
import { AthleteScopeSelector } from './AthleteScopeSelector';

const PRIMARY: { mode: DashboardMode; label: string; testId?: string }[] = [
  { mode: 'calendar', label: 'Calendar', testId: 'nav-calendar' },
  { mode: 'sessions', label: 'Sessions', testId: 'nav-sessions' },
  { mode: 'insights', label: 'Insights', testId: 'nav-insights' },
  { mode: 'roster', label: 'Roster', testId: 'nav-roster' },
];

const OPS: { mode: DashboardMode; label: string; testId?: string }[] = [
  { mode: 'integrations', label: 'Integrations', testId: 'nav-integrations' },
  { mode: 'security', label: 'Security', testId: 'nav-security' },
];

const ICONS: Record<DashboardMode, typeof Calendar> = {
  calendar: Calendar,
  sessions: List,
  insights: BarChart3,
  roster: Users,
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
      className={`w-full px-2 h-8 rounded-[var(--cal-radius-md)] flex items-center gap-2 text-left text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${
        collapsed ? 'justify-center' : ''
      } ${
        active
          ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)] border border-[var(--cal-hairline)]'
          : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] border border-transparent'
      }`}
    >
      <Icon size={14} className={active ? 'text-[var(--cal-accent)]' : ''} />
      {!collapsed && label}
    </button>
  );
}

export const Sidebar = ({
  dashboardMode,
  onNavigate,
  collapsed,
  onToggleCollapse,
  focusAthleteScope = false,
  onAthleteScopeFocused,
  theme,
  onToggleTheme,
}: {
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  focusAthleteScope?: boolean;
  onAthleteScopeFocused?: () => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
}) => {
  const { user, roleMode, signOut } = useAuth();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const email = (user?.email as string | undefined) || getUiPref(UI_KEYS.email) || 'Signed in';
  const widthClass = collapsed ? 'w-[60px] min-w-[60px] max-w-[60px] px-1' : 'w-[240px] min-w-[240px] max-w-[240px] px-3';

  return (
    <aside
      data-testid="app-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`fixed left-0 top-0 h-screen ${widthClass} bg-[var(--cal-canvas)] border-r border-[var(--cal-hairline)] flex flex-col py-[var(--cal-space-md)] z-50`}
    >
      <div className={`mb-[var(--cal-space-md)] flex items-center ${collapsed ? 'justify-center' : 'px-2 justify-between gap-2'}`}>
        {!collapsed && (
          <h1 className="text-[13px] font-semibold text-[var(--cal-ink)] tracking-tight truncate">
            Adaptive Lifting
          </h1>
        )}
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapse}
          className="h-8 w-8 flex items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
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

      <nav className="flex-1 flex flex-col gap-[var(--cal-space-md)] overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {PRIMARY.filter((item) => item.mode !== 'roster' || isCoach).map((item) => (
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
            <p className="px-2 pb-1 text-[10px] text-[var(--cal-muted)] uppercase tracking-wider">Ops</p>
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

      <div
        className={`pt-[var(--cal-space-sm)] border-t border-[var(--cal-hairline)] flex flex-col gap-1 ${
          collapsed ? 'items-center px-1' : 'px-2'
        }`}
      >
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
          className={`flex items-center gap-2 text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)] h-7 px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${
            collapsed ? 'justify-center w-full' : 'text-left w-full'
          }`}
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          {!collapsed && (theme === 'light' ? 'Dark' : 'Light')}
        </button>
        <button
          type="button"
          onClick={signOut}
          className={`text-[12px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)] h-7 px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)] ${
            collapsed ? 'w-full text-center' : 'text-left w-full'
          }`}
        >
          {collapsed ? 'Out' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
};

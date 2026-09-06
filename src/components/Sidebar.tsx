import { Calendar, BarChart3, Dumbbell, Link2, Settings, List } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import type { DashboardMode } from './AppShell';

const PRIMARY: { mode: DashboardMode; label: string; testId?: string }[] = [
  { mode: 'calendar', label: 'Calendar', testId: 'nav-calendar' },
  { mode: 'sessions', label: 'Sessions' },
  { mode: 'roster', label: 'Roster' },
  { mode: 'insights', label: 'Insights' },
];

const OPS: { mode: DashboardMode; label: string }[] = [
  { mode: 'integrations', label: 'Integrations' },
  { mode: 'security', label: 'Security' },
];

const ICONS: Record<DashboardMode, typeof Calendar> = {
  calendar: Calendar,
  sessions: List,
  roster: Dumbbell,
  insights: BarChart3,
  integrations: Link2,
  security: Settings,
};

function NavButton({
  mode,
  label,
  testId,
  active,
  onNavigate,
}: {
  mode: DashboardMode;
  label: string;
  testId?: string;
  active: boolean;
  onNavigate: (mode: DashboardMode) => void;
}) {
  const Icon = ICONS[mode];
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onNavigate(mode)}
      className={`w-full px-2 h-8 rounded flex items-center gap-2 text-left text-[13px] ${
        active ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon size={14} className={active ? 'text-[#007AFF]' : ''} />
      {label}
    </button>
  );
}

export const Sidebar = ({
  dashboardMode,
  onNavigate,
  onResetPlan,
}: {
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  onResetPlan?: () => void;
}) => {
  const { user, roleMode, signOut } = useAuth();
  const email = (user?.email as string | undefined) || getUiPref(UI_KEYS.email) || 'Signed in';

  return (
    <aside className="fixed left-0 top-0 h-screen w-[240px] min-w-[240px] max-w-[240px] bg-[#131313] border-r border-white/10 flex flex-col px-3 py-4 z-50">
      <div className="px-2 mb-4">
        <h1 className="text-xs font-semibold text-white tracking-wide uppercase">Adaptive Lifting</h1>
      </div>

      <nav className="flex-1 flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <NavButton
              key={item.mode}
              {...item}
              active={dashboardMode === item.mode}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[10px] text-[#636366] uppercase tracking-wider">Ops</p>
          {OPS.map((item) => (
            <NavButton
              key={item.mode}
              {...item}
              active={dashboardMode === item.mode}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      <div className="pt-3 border-t border-white/10 px-2 flex flex-col gap-1">
        <p className="text-xs text-white truncate">{email}</p>
        <p className="text-[11px] text-[#AEAEB2] capitalize">{roleMode}</p>
        <button type="button" onClick={signOut} className="text-left text-[12px] text-[#AEAEB2] hover:text-white h-7">
          Sign out
        </button>
        {onResetPlan && (
          <button type="button" onClick={onResetPlan} className="text-left text-[12px] text-[#AEAEB2] hover:text-red-400 h-7">
            Reset plan
          </button>
        )}
      </div>
    </aside>
  );
};

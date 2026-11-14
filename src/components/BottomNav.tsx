import { useEffect, useState } from 'react';
import { BarChart3, Calendar, Link2, List, LogOut, Moon, MoreHorizontal, Settings, Sun, Users, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUiPref, UI_KEYS } from '../storage/uiPrefs';
import type { ThemePreference } from '../theme/themePref';
import { isDashboardModeAvailable, type DashboardMode } from '../navigation';
import { isPhoneWidth } from '../features/layout/phoneWidth';
import { AthleteScopeSelector } from './AthleteScopeSelector';

/**
 * Phone navigation (`.cursor/scopes/phone/PLAN.md`, M1): a bottom tab bar replaces the sidebar
 * below 768px. Calendar · Sessions · Insights · More; More holds the athlete switcher, Roster,
 * Integrations, Security, theme and sign-out. CSS (`.bottom-nav`) shows it on phones only and
 * hides it while the keyboard is up.
 */

const TABS: { mode: DashboardMode; label: string; Icon: typeof Calendar }[] = [
  { mode: 'calendar', label: 'Calendar', Icon: Calendar },
  { mode: 'sessions', label: 'Sessions', Icon: List },
  { mode: 'insights', label: 'Insights', Icon: BarChart3 },
];

const MORE: { mode: DashboardMode; label: string; Icon: typeof Calendar; coachOnly?: boolean }[] = [
  { mode: 'roster', label: 'Roster', Icon: Users, coachOnly: true },
  { mode: 'integrations', label: 'Integrations', Icon: Link2 },
  { mode: 'security', label: 'Security', Icon: Settings },
];

export function BottomNav({
  dashboardMode,
  onNavigate,
  focusAthleteScope = false,
  onAthleteScopeFocused,
  theme,
  onToggleTheme,
}: {
  dashboardMode: DashboardMode;
  onNavigate: (mode: DashboardMode) => void;
  focusAthleteScope?: boolean;
  onAthleteScopeFocused?: () => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
}) {
  const { user, roleMode, signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const email = (user?.email as string | undefined) || getUiPref(UI_KEYS.email) || 'Signed in';
  const moreItems = MORE.filter((item) => (!item.coachOnly || isCoach) && isDashboardModeAvailable(item.mode));
  const moreActive = moreItems.some((item) => item.mode === dashboardMode);

  // "Pick an athlete" prompts open the switcher; on a phone it lives in More.
  useEffect(() => {
    if (focusAthleteScope && isPhoneWidth()) setMoreOpen(true);
  }, [focusAthleteScope]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const go = (mode: DashboardMode) => {
    setMoreOpen(false);
    onNavigate(mode);
  };

  const tab = (active: boolean) => `flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
    active ? 'text-[var(--cal-accent)]' : 'text-[var(--cal-muted)]'
  } focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--cal-accent)]`;

  return (
    <>
      <nav className="bottom-nav" aria-label="Main" data-testid="bottom-nav">
        {TABS.map(({ mode, label, Icon }) => (
          <button key={mode} type="button" data-testid={`tab-${mode}`} aria-current={dashboardMode === mode ? 'page' : undefined}
            onClick={() => go(mode)} className={tab(dashboardMode === mode)}>
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
        <button type="button" data-testid="tab-more" aria-haspopup="dialog" aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)} className={tab(moreOpen || moreActive)}>
          <MoreHorizontal size={20} aria-hidden="true" />
          More
        </button>
      </nav>
      {moreOpen ? (
        <div className="bottom-sheet-backdrop" onClick={() => setMoreOpen(false)} data-testid="more-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="More"
            data-testid="more-sheet"
            onClick={(event) => event.stopPropagation()}
            className="bottom-sheet"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-[var(--cal-ink)]">{email}</p>
                <p className="text-xs capitalize text-[var(--cal-muted)]">{roleMode}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setMoreOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)]">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <AthleteScopeSelector
              collapsed={false}
              forceOpen={focusAthleteScope}
              onOpened={onAthleteScopeFocused}
              onNavigate={go}
            />
            <div className="flex flex-col">
              {moreItems.map(({ mode, label, Icon }) => (
                <button key={mode} type="button" data-testid={`more-${mode}`} aria-current={dashboardMode === mode ? 'page' : undefined}
                  onClick={() => go(mode)}
                  className={`flex h-12 items-center gap-3 rounded-[var(--cal-radius-md)] px-2 text-left text-[15px] ${dashboardMode === mode ? 'text-[var(--cal-accent)]' : 'text-[var(--cal-ink)]'} hover:bg-[var(--cal-surface-soft)]`}>
                  <Icon size={18} aria-hidden="true" className="text-[var(--cal-muted)]" />
                  {label}
                </button>
              ))}
              <button type="button" data-testid="more-theme" onClick={onToggleTheme}
                className="flex h-12 items-center gap-3 rounded-[var(--cal-radius-md)] px-2 text-left text-[15px] text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]">
                {theme === 'light' ? <Moon size={18} aria-hidden="true" className="text-[var(--cal-muted)]" /> : <Sun size={18} aria-hidden="true" className="text-[var(--cal-muted)]" />}
                {theme === 'light' ? 'Dark theme' : 'Light theme'}
              </button>
              <button type="button" data-testid="more-sign-out" onClick={() => { setMoreOpen(false); void signOut(); }}
                className="flex h-12 items-center gap-3 rounded-[var(--cal-radius-md)] px-2 text-left text-[15px] text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]">
                <LogOut size={18} aria-hidden="true" className="text-[var(--cal-muted)]" />
                Sign out
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

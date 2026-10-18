import { UI_KEYS, getUiPref } from './storage/uiPrefs';

export const WORKSPACE_MODES = ['calendar', 'sessions', 'insights', 'roster'] as const;
export const OPS_MODES = ['integrations', 'security'] as const;
export const DASHBOARD_MODES = [...WORKSPACE_MODES, ...OPS_MODES] as const;

/** Search appears once a coach has more linked athletes than this. Six names still fit the sidebar list. */
export const ATHLETE_SEARCH_THRESHOLD = 6;

export type DashboardMode = (typeof DASHBOARD_MODES)[number];
export type NavPanel = 'athlete-scope';

export type AppLocation = {
  mode: DashboardMode;
  athleteId: string | null;
  panel: NavPanel | null;
};

const MODE_SET = new Set<string>(DASHBOARD_MODES);

const LEGACY_REDIRECTS: Record<string, { mode: DashboardMode; panel: NavPanel | null }> = {
  athletes: { mode: 'roster', panel: null },
  analytics: { mode: 'insights', panel: null },
};

function isDashboardMode(value: string): value is DashboardMode {
  return MODE_SET.has(value);
}

function firstParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value && value.trim() ? value.trim() : null;
}

export function resolveDashboardMode(raw: string | null | undefined): {
  mode: DashboardMode;
  panel: NavPanel | null;
  redirectedFrom: string | null;
} {
  const token = (raw || '').trim().toLowerCase();
  if (isDashboardMode(token)) {
    return { mode: token, panel: null, redirectedFrom: null };
  }
  const legacy = LEGACY_REDIRECTS[token];
  if (legacy) {
    return { ...legacy, redirectedFrom: token };
  }
  return { mode: 'sessions', panel: null, redirectedFrom: token || null };
}

export function parseAppLocation(href: string = typeof window !== 'undefined' ? window.location.href : ''): AppLocation {
  let url: URL;
  try {
    url = new URL(href, 'http://local.invalid');
  } catch {
    return { mode: 'sessions', athleteId: null, panel: null };
  }

  const hash = url.hash.replace(/^#\/?/, '');
  const [hashPath, hashQuery] = hash.split('?');
  const hashMode = (hashPath || '').split('/')[0];
  const hashParams = new URLSearchParams(hashQuery || '');
  const searchParams = url.searchParams;

  const rawMode = hashMode || firstParam(searchParams, 'view') || getUiPref(UI_KEYS.dashboardMode) || 'sessions';
  const resolved = resolveDashboardMode(rawMode);
  const athleteId =
    firstParam(hashParams, 'athlete') ||
    firstParam(searchParams, 'athlete') ||
    null;
  const panelToken = firstParam(hashParams, 'panel') || firstParam(searchParams, 'panel');
  const panel: NavPanel | null =
    resolved.panel ||
    (panelToken === 'athlete-scope' ? 'athlete-scope' : null);

  return { mode: resolved.mode, athleteId, panel };
}

export function formatAppHash(location: AppLocation): string {
  const params = new URLSearchParams();
  if (location.athleteId) params.set('athlete', location.athleteId);
  if (location.panel) params.set('panel', location.panel);
  const query = params.toString();
  return query ? `#/${location.mode}?${query}` : `#/${location.mode}`;
}

export function writeAppLocation(location: AppLocation): void {
  if (typeof window === 'undefined') return;
  const next = formatAppHash(location);
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
  }
}

/** LocalStorage is UI preferences only. Workout trees live in IndexedDB. */
export const UI_KEYS = {
  roleMode: 'al_role_mode',
  role: 'al_role',
  email: 'al_email',
  userId: 'al_user_id',
  appView: 'al_app_view',
  dashboardMode: 'al_dashboard_mode',
  sessionsScrollY: 'al_sessions_scroll_y',
  sessionsExpandedMicro: 'al_sessions_expanded_micro',
  activeWorkoutId: 'al_active_workout_id',
  activeMicrocycleId: 'al_active_microcycle_id',
  activeAthleteId: 'al_active_athlete_id',
  deviceId: 'al_client_device_id',
  sidebarCollapsed: 'al_sidebar_collapsed',
  theme: 'al_theme',
  liftFilter: 'al_lift_filter',
  recentBlock: 'al_recent_block',
  recentWeek: 'al_recent_week',
  recentDay: 'al_recent_day',
  recentName: 'al_recent_name',
} as const;

const LEGACY_UI_MAP: Array<[string, string]> = [
  ['obsidian_role_mode', UI_KEYS.roleMode],
  ['iron_box_role', UI_KEYS.role],
  ['iron_box_email', UI_KEYS.email],
  ['performance_app_view', UI_KEYS.appView],
  ['obsidian_dashboard_mode', UI_KEYS.dashboardMode],
  ['obsidian_sessions_scroll_y', UI_KEYS.sessionsScrollY],
  ['obsidian_active_workout_id', UI_KEYS.activeWorkoutId],
  ['obsidian_active_micro_id', UI_KEYS.activeMicrocycleId],
  ['client_device_id', UI_KEYS.deviceId],
];

const LEGACY_WORKOUT_KEYS = [
  'obsidian_microcycles',
  'iron_box_microcycles',
];

export function migrateAndPurgeLegacyStorage(): void {
  if (typeof localStorage === 'undefined') return;

  for (const [from, to] of LEGACY_UI_MAP) {
    const next = localStorage.getItem(to);
    const legacy = localStorage.getItem(from);
    if (!next && legacy) {
      localStorage.setItem(to, legacy);
    }
    localStorage.removeItem(from);
  }

  for (const key of LEGACY_WORKOUT_KEYS) {
    localStorage.removeItem(key);
  }
}

export function getUiPref(key: string): string | null {
  return localStorage.getItem(key);
}

export function setUiPref(key: string, value: string): void {
  localStorage.setItem(key, value);
}

export function removeUiPref(key: string): void {
  localStorage.removeItem(key);
}

function athletePrefKey(base: string, athleteId: string): string {
  return `${base}:${athleteId}`;
}

function getAthletePref(base: string, athleteId: string | null | undefined): string {
  if (!athleteId) return '';
  return (getUiPref(athletePrefKey(base, athleteId)) || '').trim();
}

function setAthletePref(base: string, athleteId: string | null | undefined, value: string | null | undefined): void {
  const next = (value || '').trim();
  if (!athleteId || !next) return;
  setUiPref(athletePrefKey(base, athleteId), next);
}

/** Athlete-scoped UI pref. Not used for workout sync. */
export function getRecentBlock(athleteId: string | null | undefined): string {
  return getAthletePref(UI_KEYS.recentBlock, athleteId);
}

export function setRecentBlock(athleteId: string | null | undefined, block: string | null | undefined): void {
  setAthletePref(UI_KEYS.recentBlock, athleteId, block);
}

export function getRecentWeek(athleteId: string | null | undefined): string {
  return getAthletePref(UI_KEYS.recentWeek, athleteId);
}

export function setRecentWeek(athleteId: string | null | undefined, week: string | null | undefined): void {
  setAthletePref(UI_KEYS.recentWeek, athleteId, week);
}

export function getRecentDay(athleteId: string | null | undefined): string {
  return getAthletePref(UI_KEYS.recentDay, athleteId);
}

export function setRecentDay(athleteId: string | null | undefined, day: string | null | undefined): void {
  setAthletePref(UI_KEYS.recentDay, athleteId, day);
}

export function getRecentName(athleteId: string | null | undefined): string {
  const value = getAthletePref(UI_KEYS.recentName, athleteId);
  return value === 'Session' ? '' : value;
}

export function setRecentName(athleteId: string | null | undefined, name: string | null | undefined): void {
  const next = (name || '').trim();
  if (next === 'Session') return;
  setAthletePref(UI_KEYS.recentName, athleteId, next);
}

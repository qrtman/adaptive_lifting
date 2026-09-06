/** LocalStorage is UI preferences only. Workout trees live in IndexedDB. */
export const UI_KEYS = {
  roleMode: 'al_role_mode',
  role: 'al_role',
  email: 'al_email',
  appView: 'al_app_view',
  dashboardMode: 'al_dashboard_mode',
  sessionsScrollY: 'al_sessions_scroll_y',
  sessionsExpandedMicro: 'al_sessions_expanded_micro',
  activeWorkoutId: 'al_active_workout_id',
  activeMicrocycleId: 'al_active_microcycle_id',
  deviceId: 'al_client_device_id',
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

import { getUiPref, setUiPref, UI_KEYS } from '../storage/uiPrefs';

export type ThemePreference = 'light' | 'dark';

/** Missing or garbage values resolve to light. */
export function normalizeTheme(value: string | null | undefined): ThemePreference {
  return value === 'dark' ? 'dark' : 'light';
}

export function readThemePref(): ThemePreference {
  return normalizeTheme(getUiPref(UI_KEYS.theme));
}

export function applyThemeToDocument(theme: ThemePreference): void {
  document.documentElement.dataset.theme = theme;
}

export function setThemePref(theme: ThemePreference): void {
  setUiPref(UI_KEYS.theme, theme);
}

export function toggleTheme(current: ThemePreference): ThemePreference {
  return current === 'light' ? 'dark' : 'light';
}

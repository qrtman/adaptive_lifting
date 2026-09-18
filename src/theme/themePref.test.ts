import { describe, expect, it, vi } from 'vitest';
import { normalizeTheme, readThemePref, toggleTheme } from './themePref';
import * as uiPrefs from '../storage/uiPrefs';

describe('themePref', () => {
  it('normalizeTheme defaults garbage to light', () => {
    expect(normalizeTheme(null)).toBe('light');
    expect(normalizeTheme('')).toBe('light');
    expect(normalizeTheme('system')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
  });

  it('readThemePref reads al_theme via getUiPref', () => {
    vi.spyOn(uiPrefs, 'getUiPref').mockReturnValue('dark');
    expect(readThemePref()).toBe('dark');
    vi.mocked(uiPrefs.getUiPref).mockReturnValue(null);
    expect(readThemePref()).toBe('light');
  });

  it('toggleTheme alternates light and dark', () => {
    expect(toggleTheme('light')).toBe('dark');
    expect(toggleTheme('dark')).toBe('light');
  });
});

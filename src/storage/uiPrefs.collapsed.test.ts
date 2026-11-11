// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { COLLAPSED_LIFTS_CAP, UI_KEYS, getCollapsedLifts, getUiPref, setCollapsedLifts, setUiPref } from './uiPrefs';

describe('remembered collapsed lifts', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and clears when empty', () => {
    setCollapsedLifts(new Set(['a', 'b']));
    expect([...getCollapsedLifts()]).toEqual(['a', 'b']);
    setCollapsedLifts(new Set());
    expect(getUiPref(UI_KEYS.collapsedLifts)).toBeNull();
  });

  it('treats malformed storage as "all open"', () => {
    setUiPref(UI_KEYS.collapsedLifts, '{not json');
    expect(getCollapsedLifts().size).toBe(0);
    setUiPref(UI_KEYS.collapsedLifts, '{"a":1}');
    expect(getCollapsedLifts().size).toBe(0);
  });

  it('keeps only the most recent ids', () => {
    const ids = Array.from({ length: COLLAPSED_LIFTS_CAP + 5 }, (_, i) => `lift-${i}`);
    setCollapsedLifts(new Set(ids));
    const kept = getCollapsedLifts();
    expect(kept.size).toBe(COLLAPSED_LIFTS_CAP);
    expect(kept.has('lift-0')).toBe(false);
    expect(kept.has(`lift-${COLLAPSED_LIFTS_CAP + 4}`)).toBe(true);
  });
});

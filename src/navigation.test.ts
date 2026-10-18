import { describe, expect, it } from 'vitest';
import { formatAppHash, parseAppLocation, resolveDashboardMode, ATHLETE_SEARCH_THRESHOLD } from './navigation';

describe('resolveDashboardMode', () => {
  it('keeps workspace modes', () => {
    expect(resolveDashboardMode('calendar')).toEqual({ mode: 'calendar', panel: null, redirectedFrom: null });
    expect(resolveDashboardMode('insights')).toEqual({ mode: 'insights', panel: null, redirectedFrom: null });
    expect(resolveDashboardMode('roster')).toEqual({ mode: 'roster', panel: null, redirectedFrom: null });
  });

  it('redirects athletes and analytics aliases', () => {
    expect(resolveDashboardMode('athletes')).toEqual({ mode: 'roster', panel: null, redirectedFrom: 'athletes' });
    expect(resolveDashboardMode('analytics')).toEqual({
      mode: 'insights',
      panel: null,
      redirectedFrom: 'analytics',
    });
  });
});

describe('parseAppLocation', () => {
  it('reads hash routes', () => {
    expect(parseAppLocation('http://app.local/#/calendar')).toEqual({
      mode: 'calendar',
      athleteId: null,
      panel: null,
    });
  });

  it('opens Roster and preserves athlete from hash query', () => {
    expect(parseAppLocation('http://app.local/#/roster?athlete=ath-1')).toEqual({
      mode: 'roster',
      athleteId: 'ath-1',
      panel: null,
    });
  });

  it('reads Telegram-style search view', () => {
    expect(parseAppLocation('http://app.local/?view=roster&tg_auth=true')).toEqual({
      mode: 'roster',
      athleteId: null,
      panel: null,
    });
  });

  it('keeps the explicit quick-scope panel on Calendar', () => {
    expect(parseAppLocation('http://app.local/#/calendar?panel=athlete-scope')).toEqual({
      mode: 'calendar',
      athleteId: null,
      panel: 'athlete-scope',
    });
  });
});

describe('formatAppHash', () => {
  it('omits empty query', () => {
    expect(formatAppHash({ mode: 'sessions', athleteId: null, panel: null })).toBe('#/sessions');
  });

  it('includes athlete and panel', () => {
    expect(formatAppHash({ mode: 'calendar', athleteId: 'a1', panel: 'athlete-scope' })).toBe(
      '#/calendar?athlete=a1&panel=athlete-scope',
    );
  });
});

describe('athlete search threshold', () => {
  it('keeps search hidden for a typical coach roster', () => {
    expect(ATHLETE_SEARCH_THRESHOLD).toBe(6);
  });
});

import { describe, expect, it } from 'vitest';
import { formatAppHash, parseAppLocation, resolveDashboardMode, ATHLETE_SEARCH_THRESHOLD } from './navigation';

describe('resolveDashboardMode', () => {
  it('keeps workspace modes', () => {
    expect(resolveDashboardMode('calendar')).toEqual({ mode: 'calendar', panel: null, redirectedFrom: null });
    expect(resolveDashboardMode('insights')).toEqual({ mode: 'insights', panel: null, redirectedFrom: null });
  });

  it('redirects athletes and analytics aliases', () => {
    expect(resolveDashboardMode('athletes')).toEqual({
      mode: 'calendar',
      panel: 'athlete-scope',
      redirectedFrom: 'athletes',
    });
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

  it('preserves athlete and panel from hash query', () => {
    expect(parseAppLocation('http://app.local/#/roster?athlete=ath-1')).toEqual({
      mode: 'calendar',
      athleteId: 'ath-1',
      panel: 'athlete-scope',
    });
  });

  it('reads Telegram-style search view', () => {
    expect(parseAppLocation('http://app.local/?view=roster&tg_auth=true')).toEqual({
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

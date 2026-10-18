// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatAthleteUsage, shouldDisableCoachAction } from './accessUi';
import { apiRequestError, ApiRequestError } from './api';
import { saasErrorMessage } from './saasErrors';

describe('coach access UI helpers', () => {
  it('only disables actions for a coach after a resolved capability denial', () => {
    expect(shouldDisableCoachAction(true, false)).toBe(true);
    expect(shouldDisableCoachAction(true, true)).toBe(false);
    expect(shouldDisableCoachAction(true, null)).toBe(false);
    expect(shouldDisableCoachAction(false, false)).toBe(false);
  });

  it('renders bounded and unlimited roster usage from backend counts', () => {
    expect(formatAthleteUsage(4, 5)).toBe('4 / 5 athletes');
    expect(formatAthleteUsage(5, 5)).toBe('5 / 5 athletes');
    expect(formatAthleteUsage(31, null)).toBe('31 athletes · Unlimited');
  });

  it('maps stable SaaS error codes and preserves generic fallback behavior', () => {
    expect(saasErrorMessage(new ApiRequestError('server text', 403, 'WORKSPACE_ACCESS_REQUIRED')))
      .toBe('Active coaching access is required for this action.');
    expect(saasErrorMessage(new ApiRequestError('server text', 403, 'FEATURE_NOT_INCLUDED', 'integrations')))
      .toBe('This coaching plan does not include Google Sheets integrations.');
    expect(saasErrorMessage(new ApiRequestError('server text', 409, 'ATHLETE_LIMIT_REACHED', undefined, 5, 5)))
      .toBe('Athlete limit reached. 5 / 5 active athletes.');
    expect(saasErrorMessage(new ApiRequestError('generic error', 500, 'UNKNOWN'))).toBeNull();
  });

  it('retains structured backend error fields and signals stale access for refresh', async () => {
    let refreshSignal = false;
    const listener = () => { refreshSignal = true; };
    window.addEventListener('saas-access-error', listener);
    const error = await apiRequestError(new Response(JSON.stringify({ detail: {
      code: 'ATHLETE_LIMIT_REACHED', message: 'limit', activeAthletes: 5, maxActiveAthletes: 5,
    } }), { status: 409 }), 'fallback');
    window.removeEventListener('saas-access-error', listener);
    expect(error.code).toBe('ATHLETE_LIMIT_REACHED');
    expect(error.activeAthletes).toBe(5);
    expect(error.maxActiveAthletes).toBe(5);
    expect(refreshSignal).toBe(true);
  });

  it('surfaces a machine-readable feature error without relying on backend prose', async () => {
    const error = await apiRequestError(new Response(JSON.stringify({ detail: {
      code: 'FEATURE_NOT_INCLUDED', feature: 'analytics', message: 'backend wording',
    } }), { status: 403 }), 'fallback');
    expect(error.code).toBe('FEATURE_NOT_INCLUDED');
    expect(error.feature).toBe('analytics');
    expect(saasErrorMessage(error)).toBe('This coaching plan does not include analytics.');
  });
});

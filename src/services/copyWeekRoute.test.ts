import { describe, expect, it } from 'vitest';
import { ApiError } from '../../supabase/functions/_shared/errors/mod.ts';
import { handleCopyWeek, resolveCopyMode } from '../../supabase/functions/_shared/copyWeekRoute.ts';
import type { AppConfig } from '../../supabase/functions/_shared/config.ts';
import type { Database, SqlClient } from '../../supabase/functions/_shared/db/mod.ts';
import type { Principal } from '../../supabase/functions/_shared/types/mod.ts';

const config: AppConfig = {
  databaseUrl: '', jwtCurrent: '', jwtPrevious: null,
  enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3, allowedOrigins: [],
};
const principal: Principal = {
  user: {
    id: 'athlete-a', google_sub: null, email_verified_at: '2026-01-01T00:00:00Z',
    email_verification_required: false, email_verification_legacy_exempt: false, deleted_at: null,
  },
  sessionId: 'session-a',
};
function database(payload: unknown, capture?: (query: string, params: unknown[]) => void): Database {
  return {
    async connect() {
      const client: SqlClient = {
        async queryObject<T>(query: string, params: unknown[] = []) {
          capture?.(query, params);
          return { rows: [{ payload } as T] };
        },
        release() {},
      };
      return client;
    },
  };
}
function request(body: unknown): Request {
  return new Request('https://stage.example/api/sessions/copy-week', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function rejected(action: () => Promise<unknown>, status: number, detail?: unknown) {
  let error: unknown;
  try { await action(); } catch (value) { error = value; }
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
  if (detail !== undefined) expect((error as ApiError).detail).toEqual(detail);
}

describe('copy-week compatibility route', () => {
  it('uses explicit copyMode ahead of legacy includeLogs and preserves request parameters', async () => {
    let query = '';
    let params: unknown[] = [];
    const response = await handleCopyWeek(
      request({ sessionIds: ['w-2', 'w-1'], copyMode: 'lifts', includeLogs: true, athleteId: 'forged', dateOffsetDays: -5, targetBlockLabel: ' Block ', targetWeekLabel: '', preserveWeekLabel: true }),
      database({ denial: null, result: { status: 'success', copied: [{ id: 'w-new', sourceId: 'w-2' }, { id: 'w-new2', sourceId: 'w-1' }] } }, (sql, values) => { query = sql; params = values; }),
      principal,
      config,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success', copied: [{ id: 'w-new', sourceId: 'w-2' }, { id: 'w-new2', sourceId: 'w-1' }] });
    expect(query).toContain('al_private.al_sessions_copy_week');
    expect(params).toEqual(['athlete-a', 'session-a', ['w-2', 'w-1'], -5, ' Block ', '', 'lifts', true, false, 3]);
  });

  it('preserves includeLogs compatibility and explicit-mode precedence', () => {
    expect(resolveCopyMode(null, null)).toBe('logs');
    expect(resolveCopyMode(null, true)).toBe('logs');
    expect(resolveCopyMode(null, false)).toBe('plan');
    expect(resolveCopyMode('lifts', true)).toBe('lifts');
    expect(resolveCopyMode('plan', true)).toBe('plan');
  });

  it('rejects empty IDs and invalid copy modes before database access', async () => {
    await rejected(() => handleCopyWeek(request({ sessionIds: [] }), database(null), principal, config), 400, 'sessionIds required');
    await rejected(() => handleCopyWeek(request({ sessionIds: ['w-1'], copyMode: 'invalid' }), database(null), principal, config), 400, 'copyMode must be lifts, plan, or logs');
  });

  it('retains Pydantic-compatible required-field and type errors', async () => {
    await rejected(() => handleCopyWeek(request({}), database(null), principal, config), 422);
    await rejected(() => handleCopyWeek(request({ sessionIds: ['w-1'], dateOffsetDays: 1.5 }), database(null), principal, config), 422);
    await rejected(() => handleCopyWeek(request({ sessionIds: ['w-1'], preserveWeekLabel: null }), database(null), principal, config), 422);
    await rejected(() => handleCopyWeek(request({ sessionIds: ['w-1'], athleteId: 7 }), database(null), principal, config), 422);
  });

  it('maps missing and tombstoned source denial without losing the requested ID', async () => {
    await rejected(() => handleCopyWeek(request({ sessionIds: ['w-deleted'] }), database({ denial: 'session_not_found', session_id: 'w-deleted' }), principal, config), 404, 'Session not found: w-deleted');
  });
});

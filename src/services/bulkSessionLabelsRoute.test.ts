import { describe, expect, it } from 'vitest';
import {
  handleBulkSessionLabels,
} from '../../supabase/functions/_shared/bulkSessionLabelsRoute';
import type {
  AppConfig,
} from '../../supabase/functions/_shared/config';
import type {
  Database,
  SqlClient,
} from '../../supabase/functions/_shared/db/mod';
import type {
  Principal,
} from '../../supabase/functions/_shared/types/mod';

const config: AppConfig = {
  databaseUrl: '',
  jwtCurrent: '',
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: [],
};
const principal: Principal = {
  user: {
    id: 'athlete-a',
    google_sub: null,
    email_verified_at: '2026-01-01T00:00:00Z',
    email_verification_required: false,
    email_verification_legacy_exempt: false,
    deleted_at: null,
  },
  sessionId: 'session-a',
};

function fakeDatabase(
  payload: unknown,
  capture?: (query: string, params: unknown[]) => void,
): Database {
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

const post = (body: unknown) => new Request('https://stage.example/api/sessions/labels', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('bulk session labels Edge route', () => {
  it('preserves payload semantics and returns only the legacy response fields', async () => {
    let query = '';
    let params: unknown[] = [];
    const response = await handleBulkSessionLabels(
      post({
        sessionIds: ['w-2', 'missing', 'w-2'],
        blockLabel: '  Block 1  ',
        weekLabel: '',
        clearBlock: false,
        clearWeek: true,
        athleteId: 'forged-athlete',
        title: 'ignored',
      }),
      fakeDatabase({
        denial: null,
        result: { status: 'success', updated: ['w-2', 'w-2'] },
      }, (sql, values) => { query = sql; params = values; }),
      principal,
      config,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success', updated: ['w-2', 'w-2'] });
    expect(query).toBe(
      'select al_private.al_sessions_bulk_labels($1::text,$2::text,$3::text[],$4::text,$5::text,$6::boolean,$7::boolean,$8::boolean,$9::integer) as payload',
    );
    expect(params).toEqual([
      'athlete-a', 'session-a', ['w-2', 'missing', 'w-2'],
      '  Block 1  ', '', false, true, false, 3,
    ]);
  });

  it('rejects an empty ID list before database access', async () => {
    await expect(
      handleBulkSessionLabels(post({ sessionIds: [] }), fakeDatabase(null), principal, config),
    ).rejects.toMatchObject({ status: 400, detail: 'sessionIds required' });
  });

  it('rejects malformed JSON and invalid field types', async () => {
    await expect(
      handleBulkSessionLabels(
        new Request('https://stage.example/api/sessions/labels', { method: 'PATCH', body: '{' }),
        fakeDatabase(null), principal, config,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      handleBulkSessionLabels(post({ sessionIds: ['w-1'], clearBlock: 'yes' }), fakeDatabase(null), principal, config),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      handleBulkSessionLabels(post({ sessionIds: ['w-1'], athleteId: 42 }), fakeDatabase(null), principal, config),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('maps auth, ownership, entitlement, and tombstone denials', async () => {
    const cases = [
      ['invalid_session', 401, 'Could not validate credentials'],
      ['account_ineligible', 403, {
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Verify your email before signing in.',
      }],
      ['session_not_found', 404, 'Session not found'],
      ['athlete_forbidden', 403, 'Athletes can only access their own plan'],
      ['coach_relationship_required', 403, 'Not linked to this athlete'],
      ['workspace_access_required', 403, {
        code: 'WORKSPACE_ACCESS_REQUIRED',
        message: 'An active coaching plan is required.',
      }],
      ['feature_not_included', 403, {
        code: 'FEATURE_NOT_INCLUDED',
        feature: 'programming',
        message: 'This coaching plan does not include programming.',
      }],
    ] as const;
    for (const [denial, status, detail] of cases) {
      await expect(
        handleBulkSessionLabels(post({ sessionIds: ['w-1'] }), fakeDatabase({ denial }), principal, config),
      ).rejects.toMatchObject({ status, detail });
    }
  });
});

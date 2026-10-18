import { describe, expect, it } from 'vitest';
import { handleDayNotesRoute, handleExportRoute, csvCell, makeCsv } from '../../supabase/functions/_shared/dayNotesExportsRoute';
import type { AppConfig } from '../../supabase/functions/_shared/config';
import type { Database } from '../../supabase/functions/_shared/db/mod';
import type { Principal } from '../../supabase/functions/_shared/types/mod';

const config: AppConfig = {
  databaseUrl: '', jwtCurrent: '', jwtPrevious: null,
  enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3,
  allowedOrigins: ['http://localhost:3000'],
};
const principal: Principal = {
  user: {
    id: 'athlete-a', google_sub: null, email_verified_at: '2026-01-01T00:00:00Z',
    email_verification_required: false, email_verification_legacy_exempt: false, deleted_at: null,
  },
  sessionId: 'session-a',
};

function fakeDatabase(payloads: unknown[], calls: Array<{ query: string; params: unknown[] }> = []): Database {
  return {
    async connect() {
      return {
        async queryObject<T>(query: string, params: unknown[] = []) {
          calls.push({ query, params });
          return { rows: [{ payload: payloads.shift() } as T] };
        },
        release() {},
      };
    },
  };
}

describe('Day Notes and export Edge routes', () => {
  it('returns only live non-empty notes and keeps the canonical response envelope', async () => {
    const notes = [
      { id: 'dn-1', date: '2026-09-01', body: 'Check SQ', ownerId: 'athlete-a' },
      { id: 'dn-2', date: '2026-09-02', body: ' \t ', ownerId: 'athlete-a' },
    ];
    const response = await handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes?athlete_id='),
      fakeDatabase([{ denial: null, notes }]), principal, config,
    );
    expect(await response.json()).toEqual({ notes: [notes[0]] });
  });

  it('trims dates and body, preserves a stable row response, and uses the narrow upsert RPC', async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const note = { id: 'dn-abc1234567', date: '2026-09-01', body: 'Deload — keep SQ light', ownerId: 'athlete-a' };
    const response = await handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: ' 2026-09-01 ', body: '  Deload — keep SQ light  ' }),
      }),
      fakeDatabase([{ denial: null, note }], calls), principal, config,
    );
    expect(await response.json()).toEqual(note);
    expect(calls[0].query).toContain('al_private.al_day_notes_upsert');
    expect(calls[0].params.slice(0, 5)).toEqual(['athlete-a', 'session-a', null, '2026-09-01', 'Deload — keep SQ light']);
    expect(calls[0].params[5]).toMatch(/^dn-[0-9a-f]{10}$/);
  });

  it('accepts Python-compatible unpadded month/day, rejects invalid dates, and caps normalized text', async () => {
    const note = { id: 'dn-a', date: '2026-9-1', body: 'x', ownerId: 'athlete-a' };
    const good = await handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes', { method: 'PUT', body: JSON.stringify({ date: '2026-9-1', body: 'x' }) }),
      fakeDatabase([{ denial: null, note }]), principal, config,
    );
    expect(good.status).toBe(200);
    for (const date of ['09-01-2026', '2026-02-30']) {
      await expect(handleDayNotesRoute(
        new Request('https://stage.test/api/day-notes', { method: 'PUT', body: JSON.stringify({ date, body: 'x' }) }),
        fakeDatabase([]), principal, config,
      )).rejects.toMatchObject({ status: 400, detail: 'date must be YYYY-MM-DD' });
    }
    await expect(handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes', { method: 'PUT', body: JSON.stringify({ date: '2026-09-01', body: String.fromCodePoint(0x1f600).repeat(2001) }) }),
      fakeDatabase([]), principal, config,
    )).rejects.toMatchObject({ status: 400, detail: 'Note must be 2000 characters or fewer' });
    const exactlyMax = await handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes', { method: 'PUT', body: JSON.stringify({ date: '2026-09-01', body: String.fromCodePoint(0x1f600).repeat(2000) }) }),
      fakeDatabase([{ denial: null, note: { id: 'dn-a', date: '2026-09-01', body: 'valid', ownerId: 'athlete-a' } }]), principal, config,
    );
    expect(exactlyMax.status).toBe(200);
  });

  it('maps the missing coach athlete selector to the stable 400 detail', async () => {
    const coach = { ...principal, user: { ...principal.user, id: 'coach-a', role: 'COACH' } } as Principal;
    await expect(handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes'), fakeDatabase([{ denial: 'athlete_required' }]), coach, config,
    )).rejects.toMatchObject({ status: 400, detail: 'athlete_id is required for coaches' });
  });

  it('returns a null id for an empty-body save with no existing row', async () => {
    const note = { id: null, date: '2026-09-10', body: null, ownerId: 'athlete-a' };
    const response = await handleDayNotesRoute(
      new Request('https://stage.test/api/day-notes', {
        method: 'PUT', body: JSON.stringify({ date: '2026-09-10', body: null }),
      }),
      fakeDatabase([{ denial: null, note }]), principal, config,
    );
    expect(await response.json()).toEqual(note);
  });

  it('uses RFC CSV quoting and prefixes spreadsheet formula-like text cells only', () => {
    const unicode = String.fromCharCode(0x0416, 0x0438, 0x043c);
    expect(csvCell(`Bench, "paused"\n${unicode}`)).toBe(`"Bench, ""paused""\n${unicode}"`);
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-foo')).toBe("'-foo");
    expect(csvCell(120)).toBe('120');
    const csv = makeCsv([{
      ownerId: 'athlete-a', date: '2026-09-01', exerciseId: 'ex-a', setId: 'set-a',
      liftCategory: 'Bench', tier: 'Comp', title: 'Bench, "paused"',
      plannedWeight: 100, actual: 100, reps: 5, rpe: 8,
    }]);
    expect(csv.split('\r\n')[0]).toBe('Date,Lift Category,Tier,Exercise Title,Planned Weight (kg),Actual Weight (kg),Reps,RPE,e1RM (kg),INOL,Tonnage (kg)');
    expect(csv).toContain('2026-09-01,Bench,Comp,"Bench, ""paused"""');
    expect(csv).toContain('100,100,5,8,122,0.28,500');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('returns canonical JSON as a bare pretty array and records its audit via the narrow RPC', async () => {
    const tree = [{ id: 'mc-a', workouts: [] }];
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const response = await handleExportRoute(
      new Request('https://stage.test/api/export/json'), fakeDatabase([{ denial: null, microcycles: tree }], calls), principal, config,
      '/api/export/json',
    );
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename=adaptive_lifting_export.json');
    expect(await response.text()).toBe(JSON.stringify(tree, null, 2));
    expect(calls[0].query).toContain('al_private.al_export_json');
  });

  it('audits only after successful CSV rendering and preserves attachment headers', async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const rows = [{ ownerId: 'athlete-a', date: '2026-09-01', exerciseId: 'ex-a', setId: 'set-a',
      liftCategory: 'Squat', tier: 'Comp', title: 'Back Squat', plannedWeight: 0, actual: 100, reps: 5, rpe: 8 }];
    const response = await handleExportRoute(
      new Request('https://stage.test/api/export/csv?lift_category=All&tier=Comp'),
      fakeDatabase([{ denial: null, rows }, { denial: null }], calls), principal, config, '/api/export/csv',
    );
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename=adaptive_lifting_export.csv');
    expect(await response.text()).toContain('Squat,Comp,Back Squat,—,100,5,8,');
    expect(calls[0].query).toContain('al_private.al_export_csv_rows');
    expect(calls[1].query).toContain('al_private.al_export_csv_audit');
    expect(calls[1].params.slice(2, 6)).toEqual([['athlete-a'], 1, 'All', 'Comp']);
  });
});

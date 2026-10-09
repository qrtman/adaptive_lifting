import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSnapshot, saveSnapshot, clearSnapshot, queueMutation } = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  clearSnapshot: vi.fn(),
  queueMutation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./sync_engine', () => ({ queueMutation }));

vi.mock('./db', () => ({
  getSnapshot,
  saveSnapshot,
  clearSnapshot,
  microcycleSnapshotKey: (ownerId: string) => `microcycles:${ownerId}`,
}));

const plan = [{ id: 'cycle-1', workouts: [{ id: 'session-1' }] }] as any;

describe('apiService.fetchMicrocycles', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    getSnapshot.mockReset().mockResolvedValue(null);
    saveSnapshot.mockReset().mockResolvedValue(undefined);
    clearSnapshot.mockReset().mockResolvedValue(undefined);
  });

  it('requests the same-origin API path when the backend URL is empty', async () => {
    vi.stubEnv('VITE_BACKEND_URL', '');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(plan), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');

    await expect(apiService.fetchMicrocycles()).resolves.toEqual(plan);
    expect(fetchMock).toHaveBeenCalledWith('/api/microcycles', expect.objectContaining({ credentials: 'include' }));
  });

  it('uses configured backend URLs and encodes athlete identifiers', async () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://api.example.test/');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(plan), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');

    await expect(apiService.fetchMicrocycles('athlete / 1')).resolves.toEqual(plan);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/microcycles?athlete_id=athlete%20%2F%201',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(saveSnapshot).toHaveBeenCalledWith('microcycles:athlete / 1', plan);
  });

  it('falls back to the cached snapshot on request failure when offline access is allowed', async () => {
    getSnapshot.mockResolvedValue(plan);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { apiService } = await import('./api');

    const { setOnlineAuthorization } = await import('./authAuthorization');
    setOnlineAuthorization({ id: 'athlete-1', role: 'ATHLETE' }, new Date(Date.now() + 60000).toISOString());
    await expect(apiService.fetchMicrocycles('athlete-1')).resolves.toEqual(plan);
    expect(getSnapshot).toHaveBeenCalledWith('microcycles:athlete-1');
    warn.mockRestore();
  });

  it('rejects request failures when offline access is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { apiService } = await import('./api');

    await expect(apiService.fetchMicrocycles(undefined, { allowOffline: false })).rejects.toThrow('network down');
  });

  it('preserves authentication errors without deleting training data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 })));
    const { apiService } = await import('./api');

    await expect(apiService.fetchMicrocycles('athlete-1')).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 403,
    });
    expect(clearSnapshot).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

describe('apiService.addSessionExercise', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv('VITE_BACKEND_URL', '');
  });

  it('preserves the same-origin POST contract and planned values', async () => {
    const exercise = { id: 'e-1', title: 'Squat', sets: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(exercise), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');
    await expect(apiService.addSessionExercise('w-1', {
      title: 'Squat', variation: 'Pause Squat', tier: 'Variation', liftCategory: 'Squat',
      movementPattern: 'Knee Dominant', plannedWeight: 182.5, plannedReps: 5, plannedRpe: 8.5,
    })).resolves.toEqual(exercise);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/w-1/exercises', expect.objectContaining({
      method: 'POST', credentials: 'include',
      body: JSON.stringify({ title: 'Squat', variation: 'Pause Squat', tier: 'Variation', liftCategory: 'Squat', movementPattern: 'Knee Dominant', liftNote: undefined, plannedWeight: 182.5, plannedReps: 5, plannedRpe: 8.5 }),
    }));
  });
});

describe('apiService.copyWeek', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv('VITE_BACKEND_URL', '');
  });

  it('preserves the same-origin POST, cookies, payload keys, and mode compatibility', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success', copied: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');

    await expect(apiService.copyWeek({
      sessionIds: ['w-2', 'w-1'], athleteId: 'athlete-a', dateOffsetDays: -5,
      targetBlockLabel: ' Block ', targetWeekLabel: '', includeLogs: true,
      copyMode: 'lifts', preserveWeekLabel: true,
    })).resolves.toEqual({ status: 'success', copied: [] });

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/copy-week', expect.objectContaining({
      method: 'POST', credentials: 'include',
      body: JSON.stringify({
        sessionIds: ['w-2', 'w-1'], athleteId: 'athlete-a', dateOffsetDays: -5,
        copyMode: 'lifts', preserveWeekLabel: true,
        targetBlockLabel: ' Block ', targetWeekLabel: '',
      }),
    }));
  });
});

describe('apiService Day Notes and exports', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv('VITE_BACKEND_URL', '');
  });

  it('uses the authenticated same-origin Day Notes contract for athlete and coach plans', async () => {
    const notes = [{ id: 'dn-1', date: '2026-09-01', body: 'Deload', ownerId: 'athlete-a' }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ notes }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'dn-1', date: '2026-09-01', body: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');

    await expect(apiService.fetchDayNotes('athlete / a')).resolves.toEqual(notes);
    await expect(apiService.upsertDayNote({ date: '2026-09-01', body: '', athleteId: 'athlete-a' }))
      .resolves.toMatchObject({ id: 'dn-1', body: null });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/day-notes?athlete_id=athlete%20%2F%20a', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/day-notes', expect.objectContaining({
      method: 'PUT', credentials: 'include',
      body: JSON.stringify({ date: '2026-09-01', body: '', athleteId: 'athlete-a' }),
    }));
  });

  it('returns authenticated export Blobs and preserves encoded CSV filters', async () => {
    const csv = 'Date,Lift Category,Tier\r\n';
    const json = '[]';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename=adaptive_lifting_export.csv' } }))
      .mockResolvedValueOnce(new Response(json, { status: 200, headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename=adaptive_lifting_export.json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');

    const csvBlob = await apiService.downloadExportCSV('Bench & Press', 'Variation');
    const jsonBlob = await apiService.downloadExportJSON();
    expect(csvBlob.type).toBe('text/csv;charset=utf-8');
    await expect(csvBlob.text()).resolves.toBe(csv);
    expect(jsonBlob.type).toBe('application/json');
    await expect(jsonBlob.text()).resolves.toBe(json);
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      '/api/export/csv?lift_category=Bench%20%26%20Press&tier=Variation',
      expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/export/json', expect.objectContaining({ credentials: 'include' }));
  });
});

it('cannot open cached training with an unsigned cached profile', async () => {
  vi.resetModules();
  getSnapshot.mockResolvedValue(plan);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { apiService } = await import('./api');
  await expect(apiService.fetchMicrocycles('unverified')).rejects.toMatchObject({ status: 401 });
});

describe('Mini App logging authorization', () => {
  beforeEach(() => {
    vi.resetModules(); vi.unstubAllGlobals(); vi.stubEnv('VITE_BACKEND_URL', '');
    getSnapshot.mockReset(); saveSnapshot.mockReset().mockResolvedValue(undefined);
    queueMutation.mockClear();
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });

  it('uses the canonical same-origin API while online', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(plan), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiService } = await import('./api');
    await expect(apiService.logSet('workout', 'exercise', 'set', 100, 5, 7)).resolves.toEqual(plan);
    expect(fetchMock).toHaveBeenCalledWith('/api/sets/log', expect.objectContaining({ credentials: 'include' }));
    expect(queueMutation).not.toHaveBeenCalled();
  });

  it('preserves authorized offline logging in the scoped snapshot and sync queue', async () => {
    const cached = [{ id: 'cycle', workouts: [{ id: 'workout', exercises: [{ id: 'exercise', sets: [{ id: 'set', scope: 'both', revision: 7 }] }] }] }];
    getSnapshot.mockResolvedValue(cached);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const { setOnlineAuthorization } = await import('./authAuthorization');
    setOnlineAuthorization({ id: 'athlete', role: 'ATHLETE' }, new Date(Date.now() + 60000).toISOString());
    const { apiService } = await import('./api');
    await apiService.logSet('workout', 'exercise', 'set', 100, 5, 7);
    expect(queueMutation).toHaveBeenCalledWith('workout', 'ExerciseSet', 'set', expect.objectContaining({ actual: 100, reps: 5, executedRpe: 7 }), expect.objectContaining({ revision: 7 }));
    expect(getSnapshot).toHaveBeenCalledWith('microcycles:athlete');
    expect(saveSnapshot).toHaveBeenCalledWith('microcycles:athlete', cached);
  });

  it('parks an online revision conflict with its original baseline for durable review', async () => {
    const cached = [{ id: 'cycle', workouts: [{ id: 'workout', exercises: [{ id: 'exercise', sets: [{
      id: 'set', scope: 'both', revision: 4, actual: 90, reps: 3, executedRpe: 7,
    }] }] }] }];
    getSnapshot.mockResolvedValue(cached);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { error: {
      code: 'SYNC_CONFLICT_REVIEW', message: 'The set changed since it was loaded.',
    } } }), { status: 409 })));
    const { setOnlineAuthorization } = await import('./authAuthorization');
    setOnlineAuthorization({ id: 'athlete', role: 'ATHLETE' }, new Date(Date.now() + 60000).toISOString());
    const { apiService } = await import('./api');

    await apiService.logSet('workout', 'exercise', 'set', 100, 5, 8, undefined, undefined, undefined, undefined, 4);

    expect(queueMutation).toHaveBeenCalledWith('workout', 'ExerciseSet', 'set', expect.objectContaining({
      actual: 100, reps: 5, executedRpe: 8,
    }), expect.objectContaining({
      revision: 4,
      fields: expect.objectContaining({ actual: 90, reps: 3, executedRpe: 7 }),
      snapshot_key: 'microcycles:athlete',
    }));
    expect(saveSnapshot).toHaveBeenCalledWith('microcycles:athlete', cached);
  });

  it('refuses offline logging without current authorization', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const { apiService } = await import('./api');
    await expect(apiService.logSet('workout', 'exercise', 'set', 100, 5, 7)).rejects.toMatchObject({ status: 401 });
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(queueMutation).not.toHaveBeenCalled();
  });

  it('never uses offline fallback after a verification denial', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: 'EMAIL_VERIFICATION_REQUIRED' } }), { status: 403 })));
    const { setOnlineAuthorization, canReadOffline } = await import('./authAuthorization');
    setOnlineAuthorization({ id: 'pending', role: 'ATHLETE' }, new Date(Date.now() + 60000).toISOString());
    const { apiService } = await import('./api');
    await expect(apiService.logSet('workout', 'exercise', 'set', 100, 5, 7)).rejects.toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
    expect(canReadOffline('pending')).toBe(false);
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(queueMutation).not.toHaveBeenCalled();
  });
});

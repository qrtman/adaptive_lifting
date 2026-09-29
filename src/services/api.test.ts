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
    const cached = [{ id: 'cycle', workouts: [{ id: 'workout', exercises: [{ id: 'exercise', sets: [{ id: 'set', scope: 'both' }] }] }] }];
    getSnapshot.mockResolvedValue(cached);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const { setOnlineAuthorization } = await import('./authAuthorization');
    setOnlineAuthorization({ id: 'athlete', role: 'ATHLETE' }, new Date(Date.now() + 60000).toISOString());
    const { apiService } = await import('./api');
    await apiService.logSet('workout', 'exercise', 'set', 100, 5, 7);
    expect(queueMutation).toHaveBeenCalledWith('workout', 'ExerciseSet', 'set', expect.objectContaining({ actual: 100, reps: 5, executedRpe: 7 }));
    expect(getSnapshot).toHaveBeenCalledWith('microcycles:athlete');
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSnapshot, saveSnapshot, clearSnapshot } = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  clearSnapshot: vi.fn(),
}));

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

    await expect(apiService.fetchMicrocycles('athlete-1')).resolves.toEqual(plan);
    expect(getSnapshot).toHaveBeenCalledWith('microcycles:athlete-1');
    warn.mockRestore();
  });

  it('rejects request failures when offline access is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { apiService } = await import('./api');

    await expect(apiService.fetchMicrocycles(undefined, { allowOffline: false })).rejects.toThrow('network down');
  });

  it('preserves authentication errors and clears a forbidden athlete cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 })));
    const { apiService } = await import('./api');

    await expect(apiService.fetchMicrocycles('athlete-1')).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 403,
    });
    expect(clearSnapshot).toHaveBeenCalledWith('microcycles:athlete-1');
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

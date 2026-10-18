// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  databaseNameForBoundary,
  legacyIndexedDbImportAllowed,
  localStorageKeyForBoundary,
  mutationVisibleToAccount,
  PRODUCTION_CLIENT_DATA_GENERATION,
  usesFreshProductionBoundary,
} from './clientDataBoundary';

describe('fresh production client boundary', () => {
  it('uses an isolated generation only on production or an explicit local production build', () => {
    expect(usesFreshProductionBoundary({ productionBuild: true, hostname: 'app.goatedmethod.me' })).toBe(true);
    expect(usesFreshProductionBoundary({
      productionBuild: true,
      configuredGeneration: PRODUCTION_CLIENT_DATA_GENERATION,
      hostname: 'localhost',
    })).toBe(true);
    expect(usesFreshProductionBoundary({
      productionBuild: true,
      configuredGeneration: PRODUCTION_CLIENT_DATA_GENERATION,
      hostname: 'adaptive-lifting-staging.gartman-bekaali.workers.dev',
    })).toBe(false);
    expect(databaseNameForBoundary(true)).toBe('adaptive_lifting_db_production_fresh_v1');
    expect(databaseNameForBoundary(false)).toBe('adaptive_lifting_db');
    expect(localStorageKeyForBoundary('al_client_device_id', true)).toBe(
      'adaptive-lifting:production-fresh-v1:al_client_device_id',
    );
  });

  it('keeps old mutations out of production account views while leaving staging behavior intact', () => {
    expect(legacyIndexedDbImportAllowed(true)).toBe(false);
    expect(legacyIndexedDbImportAllowed(false)).toBe(true);
    expect(mutationVisibleToAccount({ account_id: 'athlete-a' }, 'athlete-a', true)).toBe(true);
    expect(mutationVisibleToAccount({ account_id: 'athlete-a' }, 'athlete-b', true)).toBe(false);
    expect(mutationVisibleToAccount({ account_id: 'athlete-a' }, undefined, true)).toBe(false);
    expect(mutationVisibleToAccount({}, 'athlete-b', false)).toBe(true);
  });
});

describe('production IndexedDB and localStorage isolation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('./clientDataBoundary');
    vi.resetModules();
    localStorage.clear();
  });

  it('opens only the fresh database and cannot restore an offline grant from the old database', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CLIENT_DATA_GENERATION', PRODUCTION_CLIENT_DATA_GENERATION);
    vi.doMock('./clientDataBoundary', async (importOriginal) => ({
      ...await importOriginal<typeof import('./clientDataBoundary')>(),
      IS_FRESH_PRODUCTION_CLIENT: true,
    }));
    vi.resetModules();

    const opened: string[] = [];
    const fakeStore = { get: () => {
      const request: any = { result: undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } };
    const fakeDatabase: any = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({ objectStore: () => fakeStore }),
    };
    const databases = vi.fn(async () => [{ name: 'obsidian_kinetic_db' }, { name: 'adaptive_lifting_db' }]);
    const open = vi.fn((name: string) => {
      opened.push(name);
      const request: any = {};
      queueMicrotask(() => request.onsuccess?.({ target: { result: fakeDatabase } }));
      return request;
    });
    vi.stubGlobal('indexedDB', { open, databases });

    const db = await import('./db');
    const { restoreOfflineAuthorization } = await import('./authAuthorization');
    expect(db.DB_NAME).toBe('adaptive_lifting_db_production_fresh_v1');
    expect(await restoreOfflineAuthorization()).toBeNull();
    expect(opened).toEqual(['adaptive_lifting_db_production_fresh_v1']);
    expect(databases).not.toHaveBeenCalled();
  });

  it('leaves old browser keys intact but inaccessible and gives a new login its own device ID key', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CLIENT_DATA_GENERATION', PRODUCTION_CLIENT_DATA_GENERATION);
    vi.doMock('./clientDataBoundary', async (importOriginal) => ({
      ...await importOriginal<typeof import('./clientDataBoundary')>(),
      IS_FRESH_PRODUCTION_CLIENT: true,
    }));
    vi.resetModules();
    localStorage.setItem('al_user_id', 'old-account');
    localStorage.setItem('al_client_device_id', 'old-device');
    localStorage.setItem('obsidian_role_mode', 'coach');
    localStorage.setItem('obsidian_microcycles', '[{"legacy":true}]');

    const storage = await import('../storage/uiPrefs');
    storage.migrateAndPurgeLegacyStorage();
    expect(storage.getUiPref(storage.UI_KEYS.userId)).toBeNull();
    expect(storage.getUiPref(storage.UI_KEYS.deviceId)).toBeNull();
    expect(localStorage.getItem('al_user_id')).toBe('old-account');
    expect(localStorage.getItem('al_client_device_id')).toBe('old-device');
    expect(localStorage.getItem('obsidian_role_mode')).toBe('coach');
    expect(localStorage.getItem('obsidian_microcycles')).toBe('[{"legacy":true}]');

    storage.setUiPref(storage.UI_KEYS.userId, 'new-account');
    storage.setUiPref(storage.UI_KEYS.deviceId, 'new-device');
    storage.setUiPref(storage.UI_KEYS.activeAthleteId, 'old-selection');
    storage.clearAccountSelectionForSwitch(true);
    expect(storage.getUiPref(storage.UI_KEYS.userId)).toBe('new-account');
    expect(storage.getUiPref(storage.UI_KEYS.deviceId)).toBe('new-device');
    expect(localStorage.getItem('adaptive-lifting:production-fresh-v1:al_user_id')).toBe('new-account');
    expect(localStorage.getItem('adaptive-lifting:production-fresh-v1:al_client_device_id')).toBe('new-device');
    expect(storage.getUiPref(storage.UI_KEYS.activeAthleteId)).toBeNull();
  });
});

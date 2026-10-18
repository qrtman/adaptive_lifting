// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAppServiceWorker } from './serviceWorkerRegistration';

describe('production PWA update handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('checks the fresh service worker and reloads a stale controlled tab once', async () => {
    const listeners = new Map<string, EventListener>();
    const registration = { scope: '/', update: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceWorkerRegistration;
    const container = {
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      register: vi.fn().mockResolvedValue(registration),
    } as unknown as ServiceWorkerContainer;
    const reload = vi.fn();
    let onLoad: EventListener | undefined;

    registerAppServiceWorker(container, { location: { reload } }, true, {
      addEventListener: (_type, listener) => { onLoad = listener; },
    });
    onLoad?.(new Event('load'));
    await vi.waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' }));
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalledOnce());
    const controllerChange = listeners.get('controllerchange');
    expect(controllerChange).toBeDefined();
    controllerChange?.(new Event('controllerchange'));
    controllerChange?.(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps staging service-worker registration behavior unchanged', async () => {
    const container = {
      register: vi.fn().mockResolvedValue({ scope: '/', update: vi.fn() }),
    } as unknown as ServiceWorkerContainer;
    let onLoad: EventListener | undefined;
    registerAppServiceWorker(container, { location: { reload: vi.fn() } }, false, {
      addEventListener: (_type, listener) => { onLoad = listener; },
    });
    onLoad?.(new Event('load'));
    await vi.waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js', undefined));
  });
});

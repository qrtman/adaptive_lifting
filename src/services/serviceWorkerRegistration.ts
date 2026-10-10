export interface ServiceWorkerHost {
  location: { reload: () => void };
}

export interface ServiceWorkerEventTarget {
  addEventListener: (type: string, listener: EventListener) => void;
}

export function registerAppServiceWorker(
  container: ServiceWorkerContainer,
  host: ServiceWorkerHost,
  freshProduction: boolean,
  eventTarget: ServiceWorkerEventTarget = window,
): void {
  let reloadedAfterControllerChange = false;
  if (freshProduction) {
    container.addEventListener('controllerchange', () => {
      // A tab controlled by the old worker may still run its old app bundle.
      // Reload once under the new controller before the user can continue.
      if (reloadedAfterControllerChange) return;
      reloadedAfterControllerChange = true;
      host.location.reload();
    });
  }

  eventTarget.addEventListener('load', () => {
    void container.register('/sw.js', freshProduction ? { updateViaCache: 'none' } : undefined)
      .then((registration) => {
        if (freshProduction) void registration.update();
        console.log('PWA ServiceWorker successfully registered:', registration.scope);
      })
      .catch((error) => console.error('PWA ServiceWorker registration failed:', error));
  });
}

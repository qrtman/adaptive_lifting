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
  // A first-ever visit has no controller yet: the new worker simply takes over
  // and there is no old bundle to replace. Reloading then would wipe the login
  // form or abort a sign-in that is in flight.
  const hadController = Boolean(container.controller);
  if (freshProduction) {
    container.addEventListener('controllerchange', () => {
      // A tab controlled by the old worker may still run its old app bundle.
      // Reload once under the new controller before the user can continue.
      if (!hadController) return;
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

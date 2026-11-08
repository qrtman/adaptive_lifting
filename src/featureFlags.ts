/**
 * Build-time feature flags. Values come from public `VITE_*` build variables only.
 *
 * VITE_INTEGRATIONS_ENABLED gates the Integrations surface (Telegram Mini App link, Google Sheets publish).
 * Explicit 'true' / 'false' wins; when unset it is off in production builds and on in development.
 */
export function resolveIntegrationsEnabled(raw: string | undefined, productionBuild: boolean): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return !productionBuild;
}

export function integrationsEnabled(): boolean {
  return resolveIntegrationsEnabled(import.meta.env.VITE_INTEGRATIONS_ENABLED, Boolean(import.meta.env.PROD));
}

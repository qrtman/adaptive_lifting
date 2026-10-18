export const PRODUCTION_CLIENT_DATA_GENERATION = 'production-fresh-v1';
export const PRODUCTION_CLIENT_NAMESPACE = 'adaptive-lifting:production-fresh-v1';

export interface ClientBoundaryInputs {
  productionBuild: boolean;
  configuredGeneration?: string;
  hostname?: string;
}

export function usesFreshProductionBoundary({
  productionBuild,
  configuredGeneration,
  hostname = '',
}: ClientBoundaryInputs): boolean {
  const host = hostname.toLowerCase();
  // Production uses a hostname boundary; an explicit marker enables local
  // production-build rehearsal but never changes workers.dev staging behavior.
  return host === 'app.goatedmethod.me' ||
    (['localhost', '127.0.0.1'].includes(host) && productionBuild &&
      configuredGeneration === PRODUCTION_CLIENT_DATA_GENERATION);
}

export function getClientBoundaryInputs(): ClientBoundaryInputs {
  return {
    productionBuild: import.meta.env.PROD,
    configuredGeneration: import.meta.env.VITE_CLIENT_DATA_GENERATION,
    hostname: typeof window === 'undefined' ? '' : window.location?.hostname || '',
  };
}

export const IS_FRESH_PRODUCTION_CLIENT = usesFreshProductionBoundary(getClientBoundaryInputs());

export function databaseNameForBoundary(freshProduction: boolean): string {
  return freshProduction ? 'adaptive_lifting_db_production_fresh_v1' : 'adaptive_lifting_db';
}

export function localStorageKeyForBoundary(key: string, freshProduction: boolean): string {
  return freshProduction ? `${PRODUCTION_CLIENT_NAMESPACE}:${key}` : key;
}

export function legacyIndexedDbImportAllowed(freshProduction: boolean): boolean {
  return !freshProduction;
}

export function mutationVisibleToAccount(
  mutation: { account_id?: string },
  accountId: string | undefined,
  freshProduction: boolean,
): boolean {
  if (!freshProduction) return true;
  return Boolean(accountId && mutation.account_id === accountId);
}

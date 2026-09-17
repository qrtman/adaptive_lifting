import { MATH_VERSION } from './mathEngine';

export function warnIfMathVersionMismatch(serverVersion: string | null | undefined, source: string): boolean {
  if (!serverVersion || serverVersion === MATH_VERSION) return false;
  if (import.meta.env.DEV) {
    console.warn(`[math] ${source} returned math_version=${serverVersion}; client is ${MATH_VERSION}`);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('math-version-stale', {
      detail: { server: serverVersion, client: MATH_VERSION, source },
    }));
  }
  return true;
}

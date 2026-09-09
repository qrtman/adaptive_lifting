const RAW = String((import.meta as any).env?.VITE_BACKEND_URL || '');

/** Configured API origin, or empty when the app is running local-first. */
export function backendOrigin(): string {
  return RAW.replace(/\/$/, '');
}

export function backendPath(path: string): string | null {
  const origin = backendOrigin();
  if (!origin) return null;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

const AUTH_PATHS = ['/api/auth/login', '/api/auth/google', '/api/auth/register'];

function shouldSignalRevoked(path: string): boolean {
  return !AUTH_PATHS.some((prefix) => path.startsWith(prefix));
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = backendPath(path);
  if (!url) {
    throw new Error('Backend is not configured.');
  }
  const res = await fetch(url, { credentials: 'include', ...init });
  if (res.status === 401 && shouldSignalRevoked(path) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth-session-revoked'));
  }
  return res;
}

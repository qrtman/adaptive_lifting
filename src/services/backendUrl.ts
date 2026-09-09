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

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = backendPath(path);
  if (!url) {
    throw new Error('Backend is not configured.');
  }
  return fetch(url, { credentials: 'include', ...init });
}

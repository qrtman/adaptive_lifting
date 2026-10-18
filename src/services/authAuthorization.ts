import { clearSnapshot, getSnapshot, saveSnapshot } from './db';

type Authorization = { user: { id: string; role: string; [key: string]: unknown }; scopes: string[]; exp: number };
let authorization: Authorization | null = null;
let revision = 0;
const leaseKey = 'auth:offline-grant';

export function setOnlineAuthorization(user: Authorization['user'], expires: string, scopes: string[] = [user.id]) {
  revision++;
  authorization = { user, scopes, exp: Math.min(Date.parse(expires) / 1000, Date.now() / 1000 + 86400) };
}

export function authorizationExpiresAt(): number { return authorization?.exp ?? 0; }

export function canReadOffline(owner?: string): boolean {
  return !!authorization && authorization.exp > Date.now() / 1000 && !!owner && authorization.scopes.includes(owner);
}

export function authorizedOfflineOwners(): string[] {
  return authorization?.scopes.filter(canReadOffline) ?? [];
}

export async function clearAuthorization() {
  revision++;
  authorization = null;
  await clearSnapshot(leaseKey).catch(() => undefined);
}

export async function verifyOfflineGrant(token: string, publicKey = import.meta.env.VITE_OFFLINE_AUTH_PUBLIC_KEY): Promise<Authorization | null> {
  if (!publicKey || !token) return null;
  try {
    const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const [header, payload, signature, extra] = token.split('.');
    if (extra !== undefined || JSON.parse(new TextDecoder().decode(decode(header))).alg !== 'ES256') return null;
    const key = await crypto.subtle.importKey('spki', decode(publicKey.replace(/-----[^-]+-----|\s/g, '')),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(signature), new TextEncoder().encode(`${header}.${payload}`))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    const now = Date.now() / 1000;
    if (claims.iss !== 'adaptive-lifting' || claims.aud !== 'adaptive-lifting-offline' ||
        !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.exp <= now ||
        claims.iat > now + 30 || claims.exp - claims.iat > 86400 || !claims.sid ||
        !claims.sub || claims.user?.id !== claims.sub || !['ATHLETE', 'COACH'].includes(claims.user?.role) ||
        !Array.isArray(claims.scopes) || !claims.scopes.every((scope: unknown) => typeof scope === 'string')) return null;
    return { user: claims.user, scopes: claims.scopes, exp: claims.exp };
  } catch { return null; }
}

export async function rememberOfflineGrant(token?: string | null) {
  const generation = revision;
  const valid = token && await verifyOfflineGrant(token);
  if (generation !== revision) return;
  if (valid) await saveSnapshot(leaseKey, token);
  else await clearSnapshot(leaseKey).catch(() => undefined);
}

export async function restoreOfflineAuthorization() {
  const generation = revision;
  const grant = await getSnapshot(leaseKey).catch(() => null);
  const restored = typeof grant === 'string' ? await verifyOfflineGrant(grant) : null;
  if (generation !== revision) return null;
  authorization = restored;
  return authorization?.user ?? null;
}

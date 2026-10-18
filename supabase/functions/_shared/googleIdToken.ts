import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ALLOWED_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
type GoogleJwks = { keys: JWK[] };
let cachedKeys: { value: GoogleJwks; expiresAt: number } | null = null;

async function fetchGoogleJwks(force = false): Promise<GoogleJwks> {
  if (!force && cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.value;
  const response = await fetch(GOOGLE_JWKS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const value = await response.json() as GoogleJwks;
  if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error("Google signing keys unavailable");
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(/(?:^|,\s*)max-age=(\d+)/i.exec(cacheControl)?.[1] ?? 300);
  const ttl = Math.max(60, Math.min(Number.isFinite(maxAge) ? maxAge : 300, 3600));
  cachedKeys = { value, expiresAt: Date.now() + ttl * 1000 };
  return value;
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
}

export async function verifyGoogleIdTokenWithJwks(
  token: string,
  audience: string,
  jwks: GoogleJwks,
): Promise<VerifiedGoogleIdentity> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new Error("Invalid Google ID token");
  }
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" && (candidate.use == null || candidate.use === "sig"));
  if (!jwk) throw new Error("Google signing key unavailable");
  const key = await importJWK(jwk, "RS256");
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["RS256"],
    audience,
    issuer: ALLOWED_ISSUERS,
    clockTolerance: 5,
  });
  if (payload.aud !== audience || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000 ||
      typeof payload.sub !== "string" || !payload.sub.trim() ||
      typeof payload.email !== "string" || !payload.email.trim() ||
      payload.email_verified !== true) {
    throw new Error("Google account must have a verified email and subject");
  }
  return { subject: payload.sub.trim(), email: payload.email.trim().toLowerCase() };
}

export async function verifyGoogleIdToken(token: string, audience: string): Promise<VerifiedGoogleIdentity> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new Error("Invalid Google ID token");
  }
  let jwks = await fetchGoogleJwks();
  let jwk = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" && (candidate.use == null || candidate.use === "sig"));
  if (!jwk) {
    jwks = await fetchGoogleJwks(true);
    jwk = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" && (candidate.use == null || candidate.use === "sig"));
  }
  if (!jwk) throw new Error("Google signing key unavailable");
  return await verifyGoogleIdTokenWithJwks(token, audience, { keys: [jwk] });
}

export function resetGoogleJwksCacheForTests(): void {
  cachedKeys = null;
}

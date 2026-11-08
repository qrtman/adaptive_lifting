import { ApiError } from "./errors/mod.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Headers the Cloudflare Worker sets after verifying the visitor address. */
export const SIGNED_CLIENT_IP_HEADER = "x-al-client-ip";
export const SIGNED_CLIENT_IP_TS_HEADER = "x-al-client-ip-ts";
export const SIGNED_CLIENT_IP_SIG_HEADER = "x-al-client-ip-sig";
/** Maximum clock skew, in seconds, for a Worker-signed client address. */
export const SIGNED_CLIENT_IP_MAX_AGE_SECONDS = 60;
const MIN_SIGNING_KEY_BYTES = 32;

export function isIpAddress(value: string): boolean {
  if (!value || value.length > 64) return false;
  const octets = value.split(".");
  if (octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet))) {
    return octets.every((octet) => Number(octet) <= 255);
  }
  if (!value.includes(":") || !/^[0-9A-Fa-f:.]+$/.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the Worker-attested client address, or null when the header set is
 * absent, malformed, stale, or not signed with CLIENT_IP_SIGNING_KEY.
 * The signature covers `${ip}|${unixSeconds}`.
 */
export async function verifiedSignedClientIp(
  headers: Headers,
  signingKey: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (!signingKey || new TextEncoder().encode(signingKey).length < MIN_SIGNING_KEY_BYTES) return null;
  const ip = headers.get(SIGNED_CLIENT_IP_HEADER)?.trim() ?? "";
  const ts = headers.get(SIGNED_CLIENT_IP_TS_HEADER)?.trim() ?? "";
  const sig = headers.get(SIGNED_CLIENT_IP_SIG_HEADER)?.trim().toLowerCase() ?? "";
  if (!isIpAddress(ip) || !/^\d{1,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const skew = Math.abs(Math.floor(nowMs / 1000) - Number(ts));
  if (!Number.isFinite(skew) || skew > SIGNED_CLIENT_IP_MAX_AGE_SECONDS) return null;
  const expected = await hmacSha256Hex(signingKey, `${ip}|${ts}`);
  return constantTimeEqual(sig, expected) ? ip : null;
}

/**
 * Resolves the requester address used for abuse buckets, or null if no
 * trusted address is available.
 *
 * Browser traffic arrives through the Cloudflare Worker, whose subrequest to
 * supabase.co carries the Worker's egress address in cf-connecting-ip. The
 * Worker therefore forwards the visitor's address in an HMAC-signed header,
 * which is trusted only when CLIENT_IP_SIGNING_KEY verifies it and the
 * timestamp is fresh. Otherwise Supabase's ingress cf-connecting-ip is used
 * (direct callers). Forwarded headers are caller-controlled and never used.
 *
 * Local loopback development has no trusted ingress header, so all local
 * attempts share one deliberate bucket.
 */
export async function resolveClientIp(
  request: Request,
  signingKey: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const hostname = new URL(request.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname)) return "127.0.0.1";

  const signed = await verifiedSignedClientIp(request.headers, signingKey, nowMs);
  if (signed) return signed;

  const address = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  return isIpAddress(address) ? address : null;
}

/** A hosted request without a trusted address fails closed. */
export async function rateLimitClientIp(
  request: Request,
  config: { clientIpSigningKey?: string | null },
  nowMs: number = Date.now(),
): Promise<string> {
  const address = await resolveClientIp(request, config.clientIpSigningKey, nowMs);
  if (address) return address;
  throw new ApiError(503, "Authentication rate limiting is unavailable");
}

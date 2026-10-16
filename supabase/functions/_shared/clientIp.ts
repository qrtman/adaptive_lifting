import { ApiError } from "./errors/mod.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(value: string): boolean {
  const octets = value.split(".");
  if (octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet))) {
    return octets.every((octet) => Number(octet) <= 255);
  }
  if (!value.includes(":")) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Supabase's hosted Edge gateway runs behind Cloudflare and supplies
 * cf-connecting-ip from its ingress. Forwarded headers are caller-controlled
 * and must never select an authentication rate-limit bucket.
 *
 * Local loopback development has no trusted ingress header, so all local
 * attempts share one deliberate bucket. A hosted request without a valid
 * ingress address fails closed instead of falling back to spoofable headers.
 */
export function rateLimitClientIp(request: Request): string {
  const hostname = new URL(request.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname)) return "127.0.0.1";

  const address = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (isIpAddress(address)) return address;

  throw new ApiError(503, "Authentication rate limiting is unavailable");
}

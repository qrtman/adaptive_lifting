import type { AppConfig } from "./config.ts";
import { ApiError } from "./errors/mod.ts";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sessionCookiePresent(request: Request): boolean {
  return (request.headers.get("cookie") ?? "").split(";").some((part) =>
    part.trim().startsWith("session_id=")
  );
}

function refererOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Enforce the API's exact-origin policy before dispatching any state-changing
 * route. Cookie-authenticated writes must carry an allowlisted Origin or
 * Referer. Originless server-to-server bearer calls remain valid, while a
 * browser session cookie never acts as an originless bypass.
 */
export function enforceMutationOrigin(request: Request, config: AppConfig): void {
  if (!MUTATION_METHODS.has(request.method)) return;

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const cookiePresent = sessionCookiePresent(request);

  if (originHeader === null && refererHeader === null) {
    if (cookiePresent || !request.headers.get("authorization")?.startsWith("Bearer ")) {
      throw new ApiError(403, "Untrusted request origin");
    }
    return;
  }

  // The explicit Origin header is authoritative. In particular, "null" and
  // malformed values must not fall back to a more favorable Referer.
  const effectiveOrigin = originHeader === null
    ? refererOrigin(refererHeader)
    : originHeader;
  if (
    !effectiveOrigin || effectiveOrigin === "null" ||
    !config.allowedOrigins.includes(effectiveOrigin)
  ) {
    throw new ApiError(403, "Untrusted request origin");
  }

  // When both headers are present, require them to identify the same trusted
  // site. X-Forwarded-* headers are deliberately ignored.
  if (refererHeader !== null && refererOrigin(refererHeader) !== effectiveOrigin) {
    throw new ApiError(403, "Untrusted request origin");
  }
}

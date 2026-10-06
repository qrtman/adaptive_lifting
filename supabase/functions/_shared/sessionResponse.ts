import { SignJWT } from "jose";
import type { AppConfig } from "./config.ts";
import { jsonResponse } from "./errors/mod.ts";

export interface SessionResponseUser {
  id: string;
  email: string;
  role: string;
  displayName?: string | null;
}

export async function sessionResponse(
  user: SessionResponseUser,
  sessionId: string,
  config: AppConfig,
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: user.role, session_id: sessionId })
    .setProtectedHeader({ alg: "HS256", kid: "current" })
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(now + (config.sessionLifetimeSeconds ?? 604800))
    .sign(new TextEncoder().encode(config.jwtCurrent));
  const cookie = [
    `session_id=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=lax",
    `Max-Age=${config.sessionLifetimeSeconds ?? 604800}`,
    ...(config.cookieSecure ? ["Secure"] : []),
  ].join("; ");
  return jsonResponse({
    access_token: token,
    token_type: "bearer",
    user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName ?? null },
  }, 200, { "set-cookie": cookie, "cache-control": "no-store" });
}

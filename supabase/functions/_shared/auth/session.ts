import type { AppConfig } from "../config.ts";
import { invalidCredentials } from "../errors/mod.ts";
import type { AuthRepository, Principal } from "../types/mod.ts";
import { requireEligibleAccount } from "./eligibility.ts";
import { verifyAppJwt } from "./jwt.ts";

// The HttpOnly cookie takes precedence over Bearer, as in main.py.
export function requestToken(request: Request): string | null {
  const cookie = request.headers.get("cookie")?.split(";").map((part) =>
    part.trim()
  )
    .find((part) => part.startsWith("session_id="));
  if (cookie) {
    const raw = cookie.slice("session_id=".length);
    if (raw) {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice(7).split(" ")[0] || null
    : null;
}

export async function authenticate(
  request: Request,
  repository: AuthRepository,
  config: AppConfig,
): Promise<Principal> {
  const token = requestToken(request);
  if (!token) throw invalidCredentials();
  const claims = await verifyAppJwt(token, config);
  const session = await repository.findSession(claims.session_id);
  if (
    !session || session.user_id !== claims.sub ||
    session.jwt_id !== claims.session_id ||
    session.revoked_at !== null || !session.active
  ) throw invalidCredentials();
  const user = await repository.findUser(claims.sub);
  if (!user || user.deleted_at !== null) throw invalidCredentials();
  requireEligibleAccount(user, config.enforceLegacyEmailVerification);
  return { user, sessionId: session.id };
}

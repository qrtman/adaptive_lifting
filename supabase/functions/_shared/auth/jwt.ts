import { decodeProtectedHeader, jwtVerify } from "jose";
import { invalidCredentials } from "../errors/mod.ts";
import type { AppConfig } from "../config.ts";

export interface AppClaims {
  sub: string;
  session_id: string;
  exp: number;
}

// Mirrors main.py decode_access_token: kid is a hint, never an authority.
// A previous-kid token can still verify with the current key, and vice versa.
export async function verifyAppJwt(
  token: string,
  config: Pick<AppConfig, "jwtCurrent" | "jwtPrevious">,
): Promise<AppClaims> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
  } catch {
    // Python falls back to the normal candidate order on a malformed header.
  }
  const keys: string[] = [];
  if (kid === "previous" && config.jwtPrevious) keys.push(config.jwtPrevious);
  keys.push(config.jwtCurrent);
  if (config.jwtPrevious && !keys.includes(config.jwtPrevious)) {
    keys.push(config.jwtPrevious);
  }

  for (const key of keys) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(key),
        { algorithms: ["HS256"] },
      );
      if (
        typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.session_id !== "string" || !payload.session_id ||
        typeof payload.exp !== "number" ||
        payload.aud !== undefined ||
        (payload.iat !== undefined && (
          typeof payload.iat !== "number" ||
          payload.iat > Math.floor(Date.now() / 1000)
        ))
      ) throw invalidCredentials();
      return {
        sub: payload.sub,
        session_id: payload.session_id,
        exp: payload.exp,
      };
    } catch {
      // A failed candidate is never accepted; try the next configured key.
    }
  }
  throw invalidCredentials();
}

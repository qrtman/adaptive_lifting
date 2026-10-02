import { SignJWT } from "jose";
import { type AppConfig, loadConfig } from "../functions/_shared/config.ts";
import {
  authenticate,
  requestToken,
} from "../functions/_shared/auth/session.ts";
import { requireSelf } from "../functions/_shared/auth/authorization.ts";
import { verifyAppJwt } from "../functions/_shared/auth/jwt.ts";
import { ApiError } from "../functions/_shared/errors/mod.ts";
import type {
  AppUser,
  AuthRepository,
  AuthSession,
} from "../functions/_shared/types/mod.ts";
import pythonTokens from "./python_tokens.json" with { type: "json" };

const now = Math.floor(Date.now() / 1000);
const config: AppConfig = {
  databaseUrl: "postgresql://unused:unused@localhost:5432/postgres",
  jwtCurrent: pythonTokens.current_secret,
  jwtPrevious: pythonTokens.previous_secret,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["https://app.example.test"],
};
const user: AppUser = {
  id: "user-1",
  google_sub: null,
  email_verified_at: "2026-01-01T00:00:00",
  email_verification_required: true,
  email_verification_legacy_exempt: false,
  deleted_at: null,
};
const session: AuthSession = {
  id: "session-1",
  user_id: user.id,
  jwt_id: "session-1",
  revoked_at: null,
  active: true,
};
const repository = (
  s: AuthSession | null = session,
  u: AppUser | null = user,
): AuthRepository => ({
  findSession: () => Promise.resolve(s),
  findUser: () => Promise.resolve(u),
});
const request = (token: string) =>
  new Request("https://example.test/api/analytics/catalog", {
    headers: { Authorization: `Bearer ${token}` },
  });
const sign = (key: string, payload: Record<string, unknown>, kid = "current") =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256", kid })
    .sign(new TextEncoder().encode(key));
const claims = (extra: Record<string, unknown> = {}) => ({
  sub: user.id,
  session_id: session.id,
  exp: now + 300,
  ...extra,
});
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(errorStatus: number, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    assert(
      error instanceof ApiError && error.status === errorStatus,
      `expected ${errorStatus}, got ${error}`,
    );
    return;
  }
  throw new Error(`expected ${errorStatus} rejection`);
}

Deno.test("Python-issued current and previous HS256 JWTs verify", async () => {
  for (
    const token of [
      pythonTokens.current_token,
      pythonTokens.previous_token,
      pythonTokens.no_kid_previous_token,
    ]
  ) {
    const principal = await authenticate(request(token), repository(), config);
    assert(principal.user.id === user.id && principal.sessionId === session.id);
  }
});

Deno.test("kid hints preserve Python fallback order", async () => {
  for (
    const [key, kid] of [
      [config.jwtCurrent, "previous"],
      [config.jwtPrevious!, "current"],
      [config.jwtPrevious!, "unknown"],
    ]
  ) {
    const token = await sign(key, claims(), kid);
    assert((await verifyAppJwt(token, config)).sub === user.id);
  }
});

Deno.test("invalid, expired, missing exp, and wrong-algorithm JWTs reject", async () => {
  await rejects(
    401,
    () => authenticate(request("invalid.token.value"), repository(), config),
  );
  await rejects(
    401,
    () => authenticate(requestTokenRequest(), repository(), config),
  );
  await rejects(
    401,
    () =>
      authenticate(
        request(signatureTamper(pythonTokens.current_token)),
        repository(),
        config,
      ),
  );
  await rejects(
    401,
    async () =>
      authenticate(
        request(await sign(config.jwtCurrent, claims({ exp: now - 1 }))),
        repository(),
        config,
      ),
  );
  await rejects(
    401,
    async () =>
      authenticate(
        request(
          await sign(config.jwtCurrent, {
            sub: user.id,
            session_id: session.id,
          }),
        ),
        repository(),
        config,
      ),
  );
  await rejects(
    401,
    async () =>
      authenticate(
        request(await sign(config.jwtCurrent, claims({ session_id: "" }))),
        repository(),
        config,
      ),
  );
  const wrongAlgorithm = await new SignJWT(claims()).setProtectedHeader({
    alg: "HS384",
    kid: "current",
  })
    .sign(new TextEncoder().encode(config.jwtCurrent));
  await rejects(
    401,
    () => authenticate(request(wrongAlgorithm), repository(), config),
  );
  await rejects(
    401,
    async () =>
      authenticate(
        request(await sign(config.jwtCurrent, claims({ aud: "other" }))),
        repository(),
        config,
      ),
  );
  await rejects(
    401,
    async () =>
      authenticate(
        request(await sign(config.jwtCurrent, claims({ iat: now + 300 }))),
        repository(),
        config,
      ),
  );
});
function requestTokenRequest() {
  return new Request("https://example.test/api/analytics/catalog");
}
function signatureTamper(token: string) {
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  return parts.join(".");
}

Deno.test("missing, revoked, expired, mismatched, and wrong-jwt-id sessions reject", async () => {
  const token = await sign(config.jwtCurrent, claims());
  for (
    const changed of [
      null,
      { ...session, revoked_at: "2026-01-01T00:00:00" },
      { ...session, active: false },
      { ...session, user_id: "other-user" },
      { ...session, jwt_id: "other-jwt" },
    ]
  ) {
    await rejects(
      401,
      () => authenticate(request(token), repository(changed), config),
    );
  }
});

Deno.test("deleted and email-verification-required users reject; eligible password and Google users pass", async () => {
  const token = await sign(config.jwtCurrent, claims());
  await rejects(
    401,
    () =>
      authenticate(
        request(token),
        repository(session, { ...user, deleted_at: "2026-01-01T00:00:00" }),
        config,
      ),
  );
  const pending = { ...user, email_verified_at: null };
  try {
    await authenticate(request(token), repository(session, pending), config);
    throw new Error("expected verification rejection");
  } catch (error) {
    assert(error instanceof ApiError && error.status === 403);
    assert(
      typeof error.detail !== "string" &&
        error.detail.code === "EMAIL_VERIFICATION_REQUIRED",
    );
  }
  assert(
    (await authenticate(request(token), repository(), config)).user.id ===
      user.id,
  );
  assert(
    (await authenticate(
      request(token),
      repository(session, { ...pending, google_sub: "google-sub" }),
      config,
    )).user.id === user.id,
  );
  assert(
    (await authenticate(
      request(token),
      repository(session, {
        ...pending,
        email_verification_legacy_exempt: true,
      }),
      config,
    )).user.id === user.id,
  );
  await rejects(
    403,
    () =>
      authenticate(
        request(token),
        repository(session, {
          ...pending,
          email_verification_legacy_exempt: true,
        }),
        { ...config, enforceLegacyEmailVerification: true },
      ),
  );
});

Deno.test("cookie takes precedence and authorization is based on DB user", async () => {
  const token = await sign(config.jwtCurrent, claims({ role: "COACH" }));
  const req = new Request("https://example.test/api/analytics/catalog", {
    headers: {
      Cookie: `session_id=${pythonTokens.current_token}`,
      Authorization: `Bearer ${token}`,
    },
  });
  assert(requestToken(req) === pythonTokens.current_token);
  const principal = await authenticate(request(token), repository(), config);
  assert(!Object.hasOwn(principal.user, "role"));
  requireSelf(principal, user.id);
  await rejects(
    403,
    () => Promise.resolve().then(() => requireSelf(principal, "other-user")),
  );
});

Deno.test("config fails closed and preserves legacy flag", () => {
  const env = new Map(Object.entries({
    DATABASE_URL: config.databaseUrl,
    JWT_SECRET_CURRENT: config.jwtCurrent,
    JWT_SECRET_PREVIOUS: config.jwtPrevious!,
    CORS_ALLOWED_ORIGINS: "https://app.example.test",
    EMAIL_VERIFICATION_ENFORCE_LEGACY: "true",
  }));
  assert(loadConfig((name) => env.get(name)).enforceLegacyEmailVerification);
  env.delete("JWT_SECRET_CURRENT");
  try {
    loadConfig((name) => env.get(name));
    throw new Error("expected config rejection");
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes("JWT_SECRET_CURRENT"),
    );
  }
});

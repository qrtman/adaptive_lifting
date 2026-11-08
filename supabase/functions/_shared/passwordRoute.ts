import type { AppConfig } from "./config.ts";
import { authRepository, type Database } from "./db/mod.ts";
import { ApiError, jsonResponse } from "./errors/mod.ts";
import { authenticate } from "./auth/session.ts";
import { fernetEncrypt } from "./fernet.ts";
import { requireEmailRegistrationReady } from "./emailReadiness.ts";
import {
  addressHashInput,
  emailAddress,
  emailPayloadKey,
  jsonBody,
  randomToken,
  sha256Hex,
  validationError,
} from "./onboardingRoute.ts";

type Json = Record<string, unknown>;

export const PASSWORD_FORGOT_MESSAGE =
  "If an account exists for that email, a password reset link will arrive shortly. The link expires in 30 minutes.";
const INVALID_RESET_TOKEN = {
  code: "INVALID_RESET_TOKEN",
  message: "This password reset link is invalid or expired. Request a new one.",
};
const PASSWORD_POLICY_MESSAGE = "Password must be at least 8 characters and at most 72 UTF-8 bytes";
const RESET_UNAVAILABLE = "Password reset is temporarily unavailable";

async function rpc(db: Database, sql: string, args: unknown[]): Promise<Json> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ payload: Json }>(sql, args);
    if (!result.rows[0]) throw new Error("Password RPC returned no result");
    return result.rows[0].payload;
  } finally {
    client.release();
  }
}

/** Same policy as registration: 8+ characters, at most 72 UTF-8 bytes (bcrypt). */
export function passwordField(body: Json, field: string): string {
  const value = body[field];
  if (value === undefined) validationError(field, true);
  if (typeof value !== "string") validationError(field);
  if (Array.from(value).length < 8 || new TextEncoder().encode(value).length > 72) {
    throw new ApiError(422, PASSWORD_POLICY_MESSAGE);
  }
  return value;
}

function clearSessionCookie(config: AppConfig): string {
  const parts = ["session_id=", "Path=/", "HttpOnly", "SameSite=lax", "Max-Age=0"];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function privateHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "cache-control": "no-store", pragma: "no-cache", "referrer-policy": "no-referrer", ...extra };
}

async function forgot(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const body = await jsonBody(request);
  const email = emailAddress(body.email);
  // Resolve the trusted rate-limit identity before any database work.
  const ipSubject = await sha256Hex(await addressHashInput(request, "password-forgot", config));
  const emailSubject = await sha256Hex(`auth:password-forgot-email:${email}`);
  try {
    await requireEmailRegistrationReady(config, async () => {
      const client = await db.connect();
      try {
        const result = await client.queryObject<{ config: { apiKey?: string; emailFrom?: string; appUrl?: string } }>(
          "select al_private.al_email_delivery_config() as config",
        );
        return result.rows[0]?.config ?? {};
      } finally { client.release(); }
    });
  } catch {
    // Delivery readiness is account-independent, so this reveals nothing.
    throw new ApiError(503, RESET_UNAVAILABLE);
  }
  let key: string;
  try { key = await emailPayloadKey(db, config); } catch {
    throw new ApiError(503, RESET_UNAVAILABLE);
  }
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  let ciphertext: string;
  try { ciphertext = await fernetEncrypt(token, key); } catch {
    throw new ApiError(503, RESET_UNAVAILABLE);
  }
  const result = await rpc(db,
    "select al_private.al_password_forgot($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::boolean) as payload",
    [email, ipSubject, emailSubject, crypto.randomUUID(), crypto.randomUUID(), tokenHash, ciphertext,
      config.enforceLegacyEmailVerification],
  );
  if (result.denial === "email_config_unavailable") throw new ApiError(503, RESET_UNAVAILABLE);
  // Unknown, ineligible, throttled and queued requests share one reply.
  return jsonResponse({ message: PASSWORD_FORGOT_MESSAGE }, 202, privateHeaders());
}

async function reset(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const body = await jsonBody(request);
  if (body.token === undefined) validationError("token", true);
  if (typeof body.token !== "string") validationError("token");
  const token = body.token;
  const password = passwordField(body, "password");
  const validFormat = /^[A-Za-z0-9_-]{43}$/.test(token);
  const result = await rpc(db,
    "select al_private.al_password_reset($1::text,$2::boolean,$3::text,$4::text) as payload",
    [await sha256Hex(token), validFormat, await sha256Hex(await addressHashInput(request, "password-reset", config)), password],
  );
  if (result.denial === "invalid_password") throw new ApiError(422, PASSWORD_POLICY_MESSAGE);
  if (result.denial) throw new ApiError(400, INVALID_RESET_TOKEN);
  return jsonResponse(
    { message: "Password updated. You were signed out on every device. Sign in with your new password." },
    200,
    privateHeaders({ "set-cookie": clearSessionCookie(config) }),
  );
}

async function change(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const principal = await authenticate(request, authRepository(db), config);
  const body = await jsonBody(request);
  if (body.currentPassword === undefined) validationError("currentPassword", true);
  if (typeof body.currentPassword !== "string") validationError("currentPassword");
  const currentPassword = body.currentPassword;
  const newPassword = passwordField(body, "newPassword");
  const result = await rpc(db,
    "select al_private.al_password_change($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::boolean) as payload",
    [principal.user.id, principal.sessionId, currentPassword, newPassword,
      await sha256Hex(`auth:password-change-user:${principal.user.id}`),
      await sha256Hex(await addressHashInput(request, "password-change", config)),
      config.enforceLegacyEmailVerification],
  );
  const denials: Record<string, [number, string | Json]> = {
    invalid_session: [401, "Could not validate credentials"],
    account_ineligible: [403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." }],
    rate_limited: [429, "Too many password attempts. Try again later."],
    invalid_password: [422, PASSWORD_POLICY_MESSAGE],
    password_unchanged: [422, "Choose a password different from your current one"],
    // Deliberately not 401: a wrong current password must not end the session.
    invalid_current_password: [400, { code: "INVALID_CURRENT_PASSWORD", message: "Current password is incorrect." }],
  };
  if (result.denial != null) {
    const [status, detail] = denials[String(result.denial)] ?? [500, "Internal server error"];
    throw new ApiError(status, detail);
  }
  return jsonResponse(
    {
      message: "Password changed. You were signed out on every device. Sign in with your new password.",
      sessionsRevoked: typeof result.sessionsRevoked === "number" ? result.sessionsRevoked : 0,
    },
    200,
    privateHeaders({ "set-cookie": clearSessionCookie(config) }),
  );
}

export async function handlePasswordRoute(
  request: Request,
  db: Database,
  config: AppConfig,
): Promise<Response | null> {
  const rawPath = new URL(request.url).pathname.replace(/^\/functions\/v1\/api/, "");
  const path = rawPath === "/api" || rawPath.startsWith("/api/") ? rawPath : `/api${rawPath}`;
  const handlers: Record<string, (req: Request) => Promise<Response>> = {
    "/api/auth/password/forgot": (req) => forgot(req, db, config),
    "/api/auth/password/reset": (req) => reset(req, db, config),
    "/api/auth/password/change": (req) => change(req, db, config),
  };
  const handler = handlers[path];
  if (!handler) return null;
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  return await handler(request);
}

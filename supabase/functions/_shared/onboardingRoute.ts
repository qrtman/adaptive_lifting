import type { AppConfig } from "./config.ts";
import { authRepository, type Database, type SqlClient } from "./db/mod.ts";
import { ApiError, jsonResponse } from "./errors/mod.ts";
import { requestToken, authenticate } from "./auth/session.ts";
import { verifyAppJwt } from "./auth/jwt.ts";
import { fernetEncrypt } from "./fernet.ts";
import { verifyGoogleIdToken } from "./googleIdToken.ts";
import { sessionResponse } from "./sessionResponse.ts";
import { tryProcessEmailVerificationJob } from "./emailWorkerCore.ts";

type Json = Record<string, unknown>;
const GENERIC_MESSAGE = "If this address is eligible, a verification email will arrive shortly. Verify your email, then sign in.";
const INVALID_TOKEN = {
  code: "INVALID_VERIFICATION_TOKEN",
  message: "This verification link is invalid or expired. Request a new email.",
};

async function rpc<T extends Json>(db: Database, sql: string, args: unknown[]): Promise<T> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ payload: T }>(sql, args);
    if (!result.rows[0]) throw new Error("Onboarding RPC returned no result");
    return result.rows[0].payload;
  } finally {
    client.release();
  }
}

async function emailPayloadKey(db: Database, config: AppConfig): Promise<string> {
  if (config.emailPayloadEncryptionKey) return config.emailPayloadEncryptionKey;
  try {
    const client = await db.connect();
    try {
      const result = await client.queryObject<{ key: string }>(
        "select al_private.al_email_payload_encryption_key() as key",
      );
      const key = result.rows[0]?.key?.trim();
      if (key) return key;
    } finally {
      client.release();
    }
  } catch {
    // Never include secret-bearing RPC errors in logs or public responses.
  }
  throw new ApiError(503, "Email verification is temporarily unavailable");
}

function validationError(field: string, missing = false): never {
  throw new ApiError(422, [{
    loc: ["body", field],
    msg: missing ? "Field required" : "Input should be a valid string",
    type: missing ? "missing" : "string_type",
  }]);
}

async function jsonBody(request: Request): Promise<Json> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, [{ loc: ["body"], msg: "Input should be a valid object", type: "model_type" }]);
  }
  return value as Json;
}

function emailAddress(value: unknown): string {
  if (value === undefined) validationError("email", true);
  if (typeof value !== "string") validationError("email");
  const email = value.trim().toLowerCase();
  if (Array.from(email).length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, "Enter a valid email address");
  }
  return email;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function addressHashInput(request: Request, route: "register" | "resend" | "verify" | "google"): string {
  const address = request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  return `auth:${route}:${address}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function noStore(body: unknown): Response {
  return jsonResponse(body, 200, { "cache-control": "no-store" });
}

async function register(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const body = await jsonBody(request);
  const email = emailAddress(body.email);
  if (body.password === undefined) validationError("password", true);
  if (typeof body.password !== "string") validationError("password");
  const password = body.password;
  if (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72) {
    throw new ApiError(422, "Password must be at least 8 characters and at most 72 UTF-8 bytes");
  }

  const requiresEmail = config.newEmailVerificationEnabled !== false;
  let token = "";
  let tokenHash = "";
  let ciphertext = "";
  if (requiresEmail) {
    const key = await emailPayloadKey(db, config);
    token = randomToken();
    tokenHash = await sha256Hex(token);
    try { ciphertext = await fernetEncrypt(token, key); } catch {
      throw new ApiError(503, "Email verification is temporarily unavailable");
    }
  }

  const result = await rpc<Json>(db,
    "select al_private.al_onboarding_register($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::boolean) as payload",
    [email, password, await sha256Hex(addressHashInput(request, "register")), crypto.randomUUID(),
      requiresEmail ? crypto.randomUUID() : null, requiresEmail ? crypto.randomUUID() : null,
      requiresEmail ? tokenHash : null, requiresEmail ? ciphertext : null, requiresEmail],
  );
  if (result.denial === "invalid_request") throw new ApiError(422, "Invalid registration request");
  if (result.denial === "email_config_unavailable") throw new ApiError(503, "Email verification is temporarily unavailable");
  // Rate limited, duplicate, and new registrations deliberately share one reply.
  return noStore({ message: GENERIC_MESSAGE });
}

async function resend(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const body = await jsonBody(request);
  if (body.email === undefined) validationError("email", true);
  if (typeof body.email !== "string") validationError("email");
  const email = body.email.trim().toLowerCase();
  const key = await emailPayloadKey(db, config);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  let ciphertext: string;
  try { ciphertext = await fernetEncrypt(token, key); } catch {
    throw new ApiError(503, "Email verification is temporarily unavailable");
  }
  const result = await rpc<Json>(db,
    "select al_private.al_onboarding_resend($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::boolean) as payload",
    [email, await sha256Hex(addressHashInput(request, "resend")), crypto.randomUUID(), crypto.randomUUID(),
      tokenHash, ciphertext, config.enforceLegacyEmailVerification],
  );
  if (result.denial === "email_config_unavailable") throw new ApiError(503, "Email verification is temporarily unavailable");
  return noStore({ message: GENERIC_MESSAGE });
}

async function verify(request: Request, db: Database): Promise<Response> {
  const body = await jsonBody(request);
  if (body.token === undefined) validationError("token", true);
  if (typeof body.token !== "string") validationError("token");
  const token = body.token;
  const validFormat = /^[A-Za-z0-9_-]{43}$/.test(token);
  const result = await rpc<Json>(db,
    "select al_private.al_onboarding_verify($1::text,$2::boolean,$3::text) as payload",
    [await sha256Hex(token), validFormat, await sha256Hex(addressHashInput(request, "verify"))],
  );
  if (result.denial === "rate_limited" || result.denial === "invalid_token") {
    throw new ApiError(400, INVALID_TOKEN);
  }
  if (result.denial) throw new ApiError(400, INVALID_TOKEN);
  return noStore({ message: "Email verified. You can now sign in." });
}

async function google(request: Request, db: Database, config: AppConfig): Promise<Response> {
  if (!config.googleClientId) {
    throw new ApiError(503, "Google login is not configured (GOOGLE_CLIENT_ID is required)");
  }
  const body = await jsonBody(request);
  if (body.token === undefined) validationError("token", true);
  if (typeof body.token !== "string" || !body.token) validationError("token");
  let identity: { subject: string; email: string };
  try { identity = await verifyGoogleIdToken(body.token, config.googleClientId); } catch {
    throw new ApiError(401, "Invalid Google ID token");
  }

  let authenticatedUserId: string | null = null;
  let authenticatedSessionId: string | null = null;
  if (requestToken(request)) {
    try {
      const principal = await authenticate(request, authRepository(db), config);
      authenticatedUserId = principal.user.id;
      authenticatedSessionId = principal.sessionId;
    } catch {
      // Linking errors are deliberately expressed as 409 by the account RPC.
    }
  }
  const sessionId = crypto.randomUUID();
  let result: Json;
  try {
    result = await rpc<Json>(db,
      "select al_private.al_onboarding_google($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::boolean) as payload",
      [identity.subject, identity.email, await sha256Hex(addressHashInput(request, "google")), crypto.randomUUID(),
        sessionId, authenticatedUserId, authenticatedSessionId, config.enforceLegacyEmailVerification],
    );
  } catch {
    // A uniqueness race is mapped by the SQL routine; unexpected DB details stay private.
    throw new ApiError(503, "Google login is temporarily unavailable");
  }
  const denials: Record<string, [number, string]> = {
    rate_limited: [429, "Too many authentication attempts"],
    invalid_google_identity: [401, "Invalid Google ID token"],
    account_unavailable: [403, "This account is unavailable"],
    ambiguous_email: [409, "Multiple local accounts match this Google email"],
    google_identity_conflict: [409, "Google identity is already linked to another account"],
    password_session_required: [409, "Sign in with your password before linking Google"],
    matching_password_session_required: [409, "Sign in to the matching account before linking Google"],
  };
  const denial = denials[String(result.denial)];
  if (denial) throw new ApiError(denial[0], denial[1]);
  if (!result.id || !result.email || !result.role) throw new ApiError(503, "Google login is temporarily unavailable");
  return await sessionResponse({
    id: String(result.id), email: String(result.email), role: String(result.role),
    displayName: typeof result.displayName === "string" ? result.displayName : null,
  }, sessionId, config);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function handleEmailVerificationWorker(
  request: Request,
  db: Database,
  config: AppConfig,
): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  let expected: string;
  try {
    const client = await db.connect();
    try {
      const result = await client.queryObject<{ secret: string }>(
        "select al_private.al_email_worker_internal_secret() as secret",
      );
      expected = result.rows[0]?.secret ?? "";
    } finally { client.release(); }
  } catch {
    throw new ApiError(503, "Email worker is not configured");
  }
  if (!expected || !constantTimeEqual(bearer, expected)) throw new ApiError(401, "Not authorized");

  let emailApiKey = config.emailProviderApiKey ?? "";
  let emailFrom = config.emailFrom ?? "";
  let appUrl = config.appUrl ?? "";
  if (!emailApiKey || !emailFrom || !appUrl) {
    try {
      const client = await db.connect();
      try {
        const result = await client.queryObject<{ config: { apiKey?: string; emailFrom?: string; appUrl?: string } }>(
          "select al_private.al_email_delivery_config() as config",
        );
        emailApiKey ||= result.rows[0]?.config?.apiKey ?? "";
        emailFrom ||= result.rows[0]?.config?.emailFrom ?? "";
        appUrl ||= result.rows[0]?.config?.appUrl ?? "";
      } finally { client.release(); }
    } catch {
      throw new ApiError(503, "Email delivery is not configured");
    }
  }
  if (!emailApiKey || !emailFrom || !appUrl) throw new ApiError(503, "Email delivery is not configured");
  let payloadKey: string;
  try {
    const client = await db.connect();
    try {
      const result = await client.queryObject<{ key: string }>(
        "select al_private.al_email_payload_encryption_key() as key",
      );
      payloadKey = result.rows[0]?.key ?? "";
    } finally { client.release(); }
  } catch {
    throw new ApiError(503, "Email delivery is not configured");
  }
  if (!payloadKey) throw new ApiError(503, "Email delivery is not configured");
  const origin = new URL(appUrl).origin;
  if (!origin.startsWith("https://") && !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
    throw new ApiError(503, "Email delivery is not configured");
  }

  const counters = { claimed: 0, accepted: 0, deferred: 0, cancelled: 0 };
  for (let index = 0; index < 10; index++) {
    const outcome = await tryProcessEmailVerificationJob(db, {
      payloadKey,
      emailApiKey,
      emailFrom,
      appUrl: origin,
      enforceLegacy: config.enforceLegacyEmailVerification,
      fetcher: fetch,
    });
    if (outcome === "empty") break;
    counters.claimed++;
    if (outcome === "accepted") counters.accepted++;
    else if (outcome === "cancelled") counters.cancelled++;
    else counters.deferred++;
  }
  return jsonResponse({ status: "ok", ...counters }, 200, { "cache-control": "no-store" });
}

export async function handleOnboardingRoute(
  request: Request,
  db: Database,
  config: AppConfig,
): Promise<Response | null> {
  const rawPath = new URL(request.url).pathname.replace(/^\/functions\/v1\/api/, "");
  const path = rawPath === "/api" || rawPath.startsWith("/api/") ? rawPath : `/api${rawPath}`;
  const handlers: Record<string, (req: Request) => Promise<Response>> = {
    "/api/auth/register": (req) => register(req, db, config),
    "/api/auth/resend-verification": (req) => resend(req, db, config),
    "/api/auth/verify-email": (req) => verify(req, db),
    "/api/auth/google": (req) => google(req, db, config),
  };
  const handler = handlers[path];
  if (!handler) return null;
  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  return await handler(request);
}

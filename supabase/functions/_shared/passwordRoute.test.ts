import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SignJWT } from "jose";
import { handlePasswordRoute, PASSWORD_FORGOT_MESSAGE } from "./passwordRoute.ts";
import { createHandler } from "./handler.ts";
import { ApiError } from "./errors/mod.ts";
import { fernetDecrypt, fernetEncrypt } from "./fernet.ts";
import { tryProcessPasswordResetJob } from "./emailWorkerCore.ts";
import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";

const ORIGIN = "https://app.example.test";
const PAYLOAD_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))
  .replace(/\+/g, "-").replace(/\//g, "_");

const config: AppConfig = {
  databaseUrl: "postgres://unused",
  jwtCurrent: "test-app-secret-that-is-long-enough-for-hs256-validation",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: [ORIGIN],
  appEnv: "production",
  cookieSecure: true,
  appUrl: ORIGIN,
  emailFrom: "Adaptive Lifting <no-reply@example.test>",
  emailProviderApiKey: "resend-test-key",
  emailPayloadEncryptionKey: PAYLOAD_KEY,
};

type Call = { query: string; params: unknown[] };

/** Routes queries by RPC name; unknown queries fail the test loudly. */
function scriptedDb(answers: Record<string, (params: unknown[]) => unknown>) {
  const calls: Call[] = [];
  let connections = 0;
  const db: Database = {
    async connect() {
      connections++;
      const client: SqlClient = {
        async queryObject<T>(query: string, params: unknown[] = []) {
          calls.push({ query, params });
          for (const [needle, answer] of Object.entries(answers)) {
            if (query.includes(needle)) return { rows: [answer(params) as T] };
          }
          throw new Error(`Unexpected query: ${query}`);
        },
        release() {},
      };
      return client;
    },
  };
  return { db, calls, connections: () => connections };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://edge.example.test/functions/v1/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.20", ...headers },
    body: JSON.stringify(body),
  });
}

async function sessionCookie(userId = "user-1", sessionId = "session-1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: "ATHLETE", session_id: sessionId })
    .setProtectedHeader({ alg: "HS256", kid: "current" })
    .setSubject(userId).setIssuedAt(now).setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(config.jwtCurrent));
  return `session_id=${encodeURIComponent(token)}`;
}

const authAnswers = {
  "from public.sessions": () => ({ id: "session-1", user_id: "user-1", jwt_id: "session-1", revoked_at: null, active: true }),
  "from public.users": () => ({
    id: "user-1", email: "athlete@example.test", role: "ATHLETE", display_name: null, google_sub: null,
    email_verified_at: "2026-01-01T00:00:00", email_verification_required: true,
    email_verification_legacy_exempt: false, deleted_at: null,
  }),
};

// --- forgot -------------------------------------------------------------------

Deno.test("forgot returns one generic 202 for queued, unknown and throttled outcomes", async () => {
  const bodies: string[] = [];
  for (const payload of [{ denial: null }, { denial: null }, { denial: null }]) {
    const harness = scriptedDb({ al_password_forgot: () => ({ payload }) });
    const response = await handlePasswordRoute(post("/api/auth/password/forgot", { email: "x@example.test" }), harness.db, config);
    assertEquals(response?.status, 202);
    assertEquals(response?.headers.get("cache-control"), "no-store");
    bodies.push(await response!.text());
  }
  assertEquals(new Set(bodies).size, 1);
  assertEquals(JSON.parse(bodies[0]).message, PASSWORD_FORGOT_MESSAGE);
});

Deno.test("forgot stores only a token hash and Fernet ciphertext, with separate IP and email limits", async () => {
  const harness = scriptedDb({ al_password_forgot: () => ({ payload: { denial: null } }) });
  await handlePasswordRoute(post("/api/auth/password/forgot", { email: "  Athlete@Example.TEST " }), harness.db, config);
  const call = harness.calls.find((c) => c.query.includes("al_password_forgot"))!;
  const [email, ipSubject, emailSubject, tokenId, outboxId, tokenHash, ciphertext] = call.params as string[];
  assertEquals(email, "athlete@example.test");
  assert(/^[0-9a-f]{64}$/.test(ipSubject));
  assert(/^[0-9a-f]{64}$/.test(emailSubject));
  assertNotEquals(ipSubject, emailSubject);
  assertNotEquals(tokenId, outboxId);
  assert(/^[0-9a-f]{64}$/.test(tokenHash));
  const raw = await fernetDecrypt(ciphertext, PAYLOAD_KEY);
  assert(/^[A-Za-z0-9_-]{43}$/.test(raw));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  assertEquals([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), tokenHash);
  assert(!call.params.includes(raw), "the raw token must never be passed to SQL");
});

Deno.test("forgot email limit is keyed by address, not by spoofable forwarding headers", async () => {
  const subjects: string[] = [];
  for (const forwarded of ["198.51.100.1", "198.51.100.2"]) {
    const harness = scriptedDb({ al_password_forgot: (p) => { subjects.push(String(p[1])); return { payload: { denial: null } }; } });
    await handlePasswordRoute(post("/api/auth/password/forgot", { email: "a@example.test" }, { "x-forwarded-for": forwarded }), harness.db, config);
  }
  assertEquals(subjects[0], subjects[1]);
});

Deno.test("forgot fails closed without a trusted client IP and never touches the database", async () => {
  const harness = scriptedDb({});
  const request = new Request("https://edge.example.test/functions/v1/api/auth/password/forgot", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "198.51.100.1" },
    body: JSON.stringify({ email: "a@example.test" }),
  });
  const error = await assertRejects(() => handlePasswordRoute(request, harness.db, config), ApiError);
  assertEquals(error.status, 503);
  assertEquals(harness.connections(), 0);
});

Deno.test("forgot returns 503 before account lookup when delivery is not configured", async () => {
  const harness = scriptedDb({ al_email_delivery_config: () => ({ config: {} }) });
  const error = await assertRejects(() => handlePasswordRoute(
    post("/api/auth/password/forgot", { email: "a@example.test" }),
    harness.db,
    { ...config, emailProviderApiKey: null },
  ), ApiError);
  assertEquals(error.status, 503);
  assert(!harness.calls.some((c) => c.query.includes("al_password_forgot")));
});

Deno.test("password routes are POST only", async () => {
  for (const path of ["/api/auth/password/forgot", "/api/auth/password/reset", "/api/auth/password/change"]) {
    const error = await assertRejects(() => handlePasswordRoute(
      new Request(`https://edge.example.test${path}`, { method: "GET" }), scriptedDb({}).db, config), ApiError);
    assertEquals(error.status, 405, path);
  }
});

// --- reset --------------------------------------------------------------------

Deno.test("reset enforces the registration password policy before the database", async () => {
  for (const password of ["short", "é".repeat(37)]) {
    const harness = scriptedDb({});
    const error = await assertRejects(() => handlePasswordRoute(
      post("/api/auth/password/reset", { token: "a".repeat(43), password }), harness.db, config), ApiError);
    assertEquals(error.status, 422);
    assertEquals(harness.connections(), 0);
  }
});

Deno.test("reset maps invalid, expired, reused and throttled tokens to one 400", async () => {
  for (const denial of ["invalid_token", "rate_limited"]) {
    const harness = scriptedDb({ al_password_reset: () => ({ payload: { denial } }) });
    const error = await assertRejects(() => handlePasswordRoute(
      post("/api/auth/password/reset", { token: "a".repeat(43), password: "new password 1" }), harness.db, config), ApiError);
    assertEquals(error.status, 400);
    assertEquals((error.detail as Record<string, unknown>).code, "INVALID_RESET_TOKEN");
  }
});

Deno.test("reset hashes the token, flags malformed tokens, and clears the session cookie on success", async () => {
  const harness = scriptedDb({ al_password_reset: () => ({ payload: { denial: null, sessionsRevoked: 3 } }) });
  const token = "b".repeat(43);
  const response = await handlePasswordRoute(
    post("/api/auth/password/reset", { token, password: "new password 1" }), harness.db, config);
  assertEquals(response?.status, 200);
  const [tokenHash, validFormat, subject, password] = harness.calls[0].params;
  assert(/^[0-9a-f]{64}$/.test(String(tokenHash)));
  assertNotEquals(tokenHash, token);
  assertEquals(validFormat, true);
  assert(/^[0-9a-f]{64}$/.test(String(subject)));
  assertEquals(password, "new password 1");
  assertStringIncludes(response!.headers.get("set-cookie") ?? "", "Max-Age=0");
  assertEquals(response!.headers.get("referrer-policy"), "no-referrer");

  const malformed = scriptedDb({ al_password_reset: () => ({ payload: { denial: "invalid_token" } }) });
  await assertRejects(() => handlePasswordRoute(
    post("/api/auth/password/reset", { token: "not-a-token", password: "new password 1" }), malformed.db, config), ApiError);
  assertEquals(malformed.calls[0].params[1], false);
});

// --- change -------------------------------------------------------------------

Deno.test("change requires an authenticated session", async () => {
  const harness = scriptedDb({});
  const error = await assertRejects(() => handlePasswordRoute(
    post("/api/auth/password/change", { currentPassword: "old password", newPassword: "new password 1" }),
    harness.db, config), ApiError);
  assertEquals(error.status, 401);
  assertEquals(harness.connections(), 0);
});

Deno.test("change reports a wrong current password as 400, never 401", async () => {
  const harness = scriptedDb({ ...authAnswers, al_password_change: () => ({ payload: { denial: "invalid_current_password" } }) });
  const cookie = await sessionCookie();
  const error = await assertRejects(() => handlePasswordRoute(
    post("/api/auth/password/change", { currentPassword: "wrong password", newPassword: "new password 1" },
      { cookie }),
    harness.db, config), ApiError);
  assertEquals(error.status, 400);
  assertEquals((error.detail as Record<string, unknown>).code, "INVALID_CURRENT_PASSWORD");
});

Deno.test("change passes actor, session and per-user plus per-IP limits, then clears the cookie", async () => {
  const harness = scriptedDb({ ...authAnswers, al_password_change: () => ({ payload: { denial: null, sessionsRevoked: 2 } }) });
  const response = await handlePasswordRoute(
    post("/api/auth/password/change", { currentPassword: "old password", newPassword: "new password 1" },
      { cookie: await sessionCookie() }),
    harness.db, config);
  assertEquals(response?.status, 200);
  assertEquals((await response!.json()).sessionsRevoked, 2);
  assertStringIncludes(response!.headers.get("set-cookie") ?? "", "Max-Age=0");
  const call = harness.calls.find((c) => c.query.includes("al_password_change"))!;
  const [actor, session, current, next, userSubject, ipSubject] = call.params as string[];
  assertEquals([actor, session, current, next], ["user-1", "session-1", "old password", "new password 1"]);
  assert(/^[0-9a-f]{64}$/.test(userSubject) && /^[0-9a-f]{64}$/.test(ipSubject));
  assertNotEquals(userSubject, ipSubject);
});

Deno.test("change maps rate limiting and policy denials", async () => {
  const cases: Array<[string, number]> = [["rate_limited", 429], ["password_unchanged", 422], ["invalid_session", 401]];
  const cookie = await sessionCookie();
  for (const [denial, status] of cases) {
    const harness = scriptedDb({ ...authAnswers, al_password_change: () => ({ payload: { denial } }) });
    const error = await assertRejects(() => handlePasswordRoute(
      post("/api/auth/password/change", { currentPassword: "old password", newPassword: "new password 1" },
        { cookie }),
      harness.db, config), ApiError);
    assertEquals(error.status, status, denial);
  }
});

// --- shared boundary ----------------------------------------------------------

Deno.test("password routes reject untrusted origins before any database access", async () => {
  const harness = scriptedDb({});
  const handler = createHandler({ ...config, appEnv: "staging" }, harness.db);
  for (const path of ["/api/auth/password/forgot", "/api/auth/password/reset", "/api/auth/password/change"]) {
    const variants: Array<Record<string, string>> = [{ origin: "https://attacker.example" }, { cookie: "session_id=x" }];
    for (const headers of variants) {
      const response = await handler(new Request(`https://edge.example.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20", ...headers },
        body: "{}",
      }));
      assertEquals(response.status, 403, `${path} ${JSON.stringify(headers)}`);
    }
  }
  assertEquals(harness.connections(), 0);
});

// --- delivery worker ----------------------------------------------------------

Deno.test("password reset worker delivers a /reset-password fragment link with the job idempotency key", async () => {
  const raw = "c".repeat(43);
  const encryptedPayload = await fernetEncrypt(raw, PAYLOAD_KEY);
  let claimed = false;
  const finishes: unknown[][] = [];
  const harness = scriptedDb({
    al_password_reset_worker_claim: (p) => {
      if (claimed) return { payload: { job: null } };
      claimed = true;
      return { payload: { jobId: "job-9", claimToken: p[0] } };
    },
    al_password_reset_worker_begin: () => ({ payload: { send: true, userId: "user-1", email: "a@example.test", encryptedPayload } }),
    al_password_reset_worker_finish: (p) => { finishes.push(p); return { payload: { updated: true } }; },
  });
  const sends: RequestInit[] = [];
  const outcome = await tryProcessPasswordResetJob(harness.db, {
    payloadKey: PAYLOAD_KEY, emailApiKey: "k", emailFrom: "from@example.test", appUrl: ORIGIN,
    enforceLegacy: false, fetcher: async (_url, init) => { sends.push(init ?? {}); return new Response("", { status: 202 }); },
  });
  assertEquals(outcome, "accepted");
  assertEquals((sends[0].headers as Record<string, string>)["idempotency-key"], "job-9");
  const message = JSON.parse(String(sends[0].body));
  assertEquals(message.subject, "Reset your Adaptive Lifting password");
  assertStringIncludes(message.text, `${ORIGIN}/reset-password#token=${raw}`);
  assertStringIncludes(message.text, "30 minutes");
  assert(!message.text.includes("?token="));
  assertEquals(finishes[0][3], "success");
  assert(!harness.calls.some((c) => c.query.includes("al_email_worker")), "reset jobs never use verification RPCs");
  assertEquals(await tryProcessPasswordResetJob(harness.db, {
    payloadKey: PAYLOAD_KEY, emailApiKey: "k", emailFrom: "f", appUrl: ORIGIN, enforceLegacy: false, fetcher: fetch,
  }), "empty");
});

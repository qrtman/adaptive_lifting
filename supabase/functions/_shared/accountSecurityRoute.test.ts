import { assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jwtVerify } from "jose";
import {
  formatCoachCode,
  generateCoachCode,
  handleAccountSecurityRoute,
  normalizeCoachCode,
} from "./accountSecurityRoute.ts";
import { sessionResponse } from "./sessionResponse.ts";
import { ApiError } from "./errors/mod.ts";
import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";

const config: AppConfig = {
  databaseUrl: "postgres://unused",
  jwtCurrent: "test-app-secret-that-is-long-enough-for-hs256-validation",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["https://staging.example.test"],
  cookieSecure: true,
  sessionLifetimeSeconds: 604800,
  offlineAuthPrivateKey: null,
};

function db(payload: unknown, capture?: (query: string, parameters: unknown[]) => void): Database {
  return {
    async connect() {
      const client: SqlClient = {
        async queryObject<T>(query: string, parameters: unknown[] = []) {
          capture?.(query, parameters);
          return { rows: [{ payload } as unknown as T] };
        },
        release() {},
      };
      return client;
    },
  };
}

Deno.test("password login preserves form contract, token claims, and secure cookie", async () => {
  let query = "";
  let values: unknown[] = [];
  const response = await handleAccountSecurityRoute(
    new Request("https://stage.test/functions/v1/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://staging.example.test",
        "cf-connecting-ip": "203.0.113.7",
      },
      body: new URLSearchParams({ username: " User@Example.test ", password: "synthetic password" }),
    }),
    db({ id: "user-1", email: "user@example.test", role: "ATHLETE", displayName: null, expiresEpoch: 1900000000 },
      (sql, params) => { query = sql; values = params; }),
    config,
  );
  assertEquals(response?.status, 200);
  assertStringIncludes(query, "al_private.al_auth_login");
  assertEquals(values[0], "user@example.test");
  const body = await response!.json();
  assertEquals("access_token" in body, false);
  assertEquals("token_type" in body, false);
  assertEquals(body.user.id, "user-1");
  const cookieToken = decodeURIComponent(/session_id=([^;]+)/.exec(response!.headers.get("set-cookie") ?? "")![1]);
  const verified = await jwtVerify(cookieToken, new TextEncoder().encode(config.jwtCurrent), { algorithms: ["HS256"] });
  assertEquals(verified.payload.sub, "user-1");
  assertEquals(verified.payload.role, "ATHLETE");
  assertEquals(verified.protectedHeader.kid, "current");
  assertStringIncludes(response!.headers.get("set-cookie") ?? "", "HttpOnly");
  assertStringIncludes(response!.headers.get("set-cookie") ?? "", "SameSite=lax");
  assertStringIncludes(response!.headers.get("set-cookie") ?? "", "Secure");
  assertStringIncludes(response!.headers.get("set-cookie") ?? "", "Max-Age=604800");
});

Deno.test("login rejects an Edge JSON-only request and retains legacy bad-password status", async () => {
  await assertRejects(
    () => handleAccountSecurityRoute(new Request("https://stage.test/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "x", password: "y" }),
    }), db({}), config),
    ApiError,
  );
  const error = await assertRejects(
    () => handleAccountSecurityRoute(new Request("https://stage.test/api/auth/login", {
      method: "POST", headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": "203.0.113.7",
      },
      body: new URLSearchParams({ username: "x", password: "wrong" }),
    }), db({ denial: "invalid_credentials" }), config),
    ApiError,
  );
  assertEquals(error.status, 400);
  assertEquals(error.detail, "Incorrect email or password");
});

Deno.test("login spoofed forwarding headers cannot select a fresh rate-limit bucket", async () => {
  const attempts = new Map<string, number>();
  const seenSubjects: string[] = [];
  const rateLimitedDb: Database = {
    async connect() {
      const client: SqlClient = {
        async queryObject<T>(_query: string, parameters: unknown[] = []) {
          const subject = String(parameters[2]);
          seenSubjects.push(subject);
          const count = (attempts.get(subject) ?? 0) + 1;
          attempts.set(subject, count);
          const payload = count > 1
            ? { denial: "rate_limited" }
            : { denial: "invalid_credentials" };
          return { rows: [{ payload } as unknown as T] };
        },
        release() {},
      };
      return client;
    },
  };

  const request = (forwardedFor: string, realIp: string) =>
    new Request("https://stage.test/functions/v1/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": forwardedFor,
        "x-real-ip": realIp,
      },
      body: new URLSearchParams({ username: "user@example.test", password: "wrong" }),
    });

  const first = await assertRejects(
    () => handleAccountSecurityRoute(request("198.51.100.1", "198.51.100.2"), rateLimitedDb, config),
    ApiError,
  );
  const second = await assertRejects(
    () => handleAccountSecurityRoute(request("198.51.100.9", "198.51.100.8"), rateLimitedDb, config),
    ApiError,
  );

  assertEquals(first.status, 400);
  assertEquals(second.status, 429);
  assertEquals(seenSubjects.length, 2);
  assertEquals(seenSubjects[0], seenSubjects[1]);
});

Deno.test("hosted login fails closed when the trusted ingress IP is missing", async () => {
  let databaseTouched = false;
  const untouchedDb: Database = {
    async connect() {
      databaseTouched = true;
      throw new Error("Database must not be queried without a trusted rate-limit identity");
    },
  };
  const error = await assertRejects(
    () => handleAccountSecurityRoute(new Request("https://stage.test/functions/v1/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "198.51.100.1",
        "x-real-ip": "198.51.100.2",
      },
      body: new URLSearchParams({ username: "user@example.test", password: "wrong" }),
    }), untouchedDb, config),
    ApiError,
  );
  assertEquals(error.status, 503);
  assertEquals(databaseTouched, false);
});

Deno.test("login buckets Worker-proxied visitors by their signed IP, not the Worker egress IP", async () => {
  const signingKey = "test-client-ip-signing-key-0123456789abcdef";
  const subjects: string[] = [];
  const capturingDb = db({ denial: "invalid_credentials" }, (_sql, params) => subjects.push(String(params[2])));
  const sign = async (ip: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ip}|${ts}`));
    const sig = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { "x-al-client-ip": ip, "x-al-client-ip-ts": ts, "x-al-client-ip-sig": sig };
  };
  for (const visitor of ["203.0.113.21", "203.0.113.22"]) {
    await assertRejects(async () => handleAccountSecurityRoute(new Request("https://stage.test/functions/v1/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": "104.28.0.9", // Worker egress address shared by every visitor
        ...(await sign(visitor)),
      },
      body: new URLSearchParams({ username: "user@example.test", password: "wrong" }),
    }), capturingDb, { ...config, clientIpSigningKey: signingKey }), ApiError);
  }
  assertEquals(subjects.length, 2);
  assertEquals(subjects[0] === subjects[1], false);
});

Deno.test("per-account login limiting returns the generic rate-limit error", async () => {
  const error = await assertRejects(
    () => handleAccountSecurityRoute(new Request("https://stage.test/functions/v1/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.7" },
      body: new URLSearchParams({ username: "locked@example.test", password: "wrong" }),
    }), db({ denial: "rate_limited" }), config),
    ApiError,
  );
  assertEquals(error.status, 429);
  assertEquals(error.detail, "Too many authentication attempts");
});

Deno.test("unmigrated auth paths fall through unchanged", async () => {
  const response = await handleAccountSecurityRoute(
    new Request("https://stage.test/api/auth/register", { method: "POST", body: "{}" }),
    db({}), config,
  );
  assertEquals(response, null);
});

Deno.test("coach unlink by athlete ID is recognized and requires a custom app session", async () => {
  const error = await assertRejects(
    () => handleAccountSecurityRoute(new Request("https://stage.test/api/auth/link/athlete-1", {
      method: "DELETE",
    }), db({}), config),
    ApiError,
  );
  assertEquals(error.status, 401);
});

const COACH_CODE = /^[A-HJ-NP-Z2-9]{10}$/;

async function sessionCookie(id: string, role: string, sessionId: string): Promise<string> {
  const response = await sessionResponse({ id, email: `${id}@example.test`, role }, sessionId, config);
  return /(session_id=[^;]+)/.exec(response.headers.get("set-cookie") ?? "")![1];
}

function authedDb(
  user: { id: string; role: string },
  sessionId: string,
  payload: unknown,
  capture: (query: string, parameters: unknown[]) => void,
): Database {
  return {
    async connect() {
      const client: SqlClient = {
        async queryObject<T>(query: string, parameters: unknown[] = []) {
          if (query.includes("from public.sessions")) {
            return { rows: [{ id: sessionId, user_id: user.id, jwt_id: sessionId, revoked_at: null, active: true } as unknown as T] };
          }
          if (query.includes("from public.users")) {
            return { rows: [{ id: user.id, email: `${user.id}@example.test`, role: user.role, display_name: null,
              google_sub: null, email_verified_at: "2026-01-01T00:00:00", email_verification_required: true,
              email_verification_legacy_exempt: false, deleted_at: null } as unknown as T] };
          }
          capture(query, parameters);
          return { rows: [{ payload } as unknown as T] };
        },
        release() {},
      };
      return client;
    },
  };
}

Deno.test("coach codes are 10 unambiguous symbols, grouped for display, and normalize back", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index++) {
    const code = generateCoachCode();
    assertEquals(COACH_CODE.test(code), true, code);
    seen.add(code);
    const display = formatCoachCode(code);
    assertEquals(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(display), true, display);
    assertEquals(normalizeCoachCode(` ${display.toLowerCase()} `), code);
  }
  assertEquals(seen.size, 200);
  assertEquals(normalizeCoachCode("abcde - fghjk"), "ABCDEFGHJK");
});

Deno.test("coach code rotation hands the raw code to the HMAC RPC and returns the 15-minute expiry", async () => {
  let query = "";
  let values: unknown[] = [];
  const cookie = await sessionCookie("coach-1", "COACH", "session-c");
  const response = await handleAccountSecurityRoute(
    new Request("https://stage.test/api/auth/coach-code", { method: "POST", headers: { cookie } }),
    authedDb({ id: "coach-1", role: "COACH" }, "session-c", { denial: null, expiresAt: "2026-11-08T12:15:00.000000" },
      (sql, params) => { query = sql; values = params; }),
    config,
  );
  assertEquals(response?.status, 200);
  assertStringIncludes(query, "al_private.al_coach_code_issue");
  assertEquals(COACH_CODE.test(String(values[2])), true);
  const body = await response!.json();
  assertEquals(body.code, formatCoachCode(String(values[2])));
  assertEquals(body.expires_at, "2026-11-08T12:15:00.000000");
});

Deno.test("athlete link sends the normalized code with an IP rate-limit subject and hides coach identity", async () => {
  let query = "";
  let values: unknown[] = [];
  const cookie = await sessionCookie("athlete-1", "ATHLETE", "session-a");
  const response = await handleAccountSecurityRoute(
    new Request("https://stage.test/functions/v1/api/auth/link-athlete", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ code: " abcde-fghjk " }),
    }),
    authedDb({ id: "athlete-1", role: "ATHLETE" }, "session-a",
      { denial: null, status: "success", message: "Linked to your coach." },
      (sql, params) => { query = sql; values = params; }),
    config,
  );
  assertEquals(response?.status, 200);
  assertStringIncludes(query, "al_private.al_athlete_link_code");
  assertEquals(values[0], "athlete-1");
  assertEquals(values[2], "ABCDEFGHJK");
  assertEquals(/^[0-9a-f]{64}$/.test(String(values[3])), true);
  const text = await response!.text();
  assertEquals(text.includes("@"), false);
  assertEquals(JSON.parse(text).message, "Linked to your coach.");
});

Deno.test("athlete link returns one generic answer for invalid, expired, and rate-limited codes", async () => {
  const cookie = await sessionCookie("athlete-1", "ATHLETE", "session-a");
  const subjects: unknown[] = [];
  for (const code of ["ZZZZZZ", "ABCDEFGHJK", "x".repeat(200)]) {
    const error = await assertRejects(
      () => handleAccountSecurityRoute(new Request("https://stage.test/api/auth/link", {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
        body: JSON.stringify({ code }),
      }), authedDb({ id: "athlete-1", role: "ATHLETE" }, "session-a", { denial: "invalid_code" },
        (_sql, params) => subjects.push(params[3])), config),
      ApiError,
    );
    assertEquals(error.status, 400);
    assertEquals(error.detail, "Invalid or expired code");
  }
  // Every attempt reaches the rate limiter, with a stable per-IP subject.
  assertEquals(subjects.length, 3);
  assertEquals(new Set(subjects).size, 1);
});

Deno.test("hosted athlete link fails closed without the trusted ingress IP", async () => {
  const cookie = await sessionCookie("athlete-1", "ATHLETE", "session-a");
  let rpcCalled = false;
  const error = await assertRejects(
    () => handleAccountSecurityRoute(new Request("https://stage.test/api/auth/link-athlete", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
      body: JSON.stringify({ code: "ABCDE-FGHJK" }),
    }), authedDb({ id: "athlete-1", role: "ATHLETE" }, "session-a", {}, () => { rpcCalled = true; }), config),
    ApiError,
  );
  assertEquals(error.status, 503);
  assertEquals(rpcCalled, false);
});

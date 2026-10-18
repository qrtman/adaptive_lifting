import { assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jwtVerify } from "jose";
import { handleAccountSecurityRoute } from "./accountSecurityRoute.ts";
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
  const verified = await jwtVerify(body.access_token, new TextEncoder().encode(config.jwtCurrent), { algorithms: ["HS256"] });
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

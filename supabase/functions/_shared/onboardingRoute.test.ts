import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleOnboardingRoute } from "./onboardingRoute.ts";
import { ApiError } from "./errors/mod.ts";
import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";

const config: AppConfig = {
  databaseUrl: "postgres://unused",
  jwtCurrent: "test-app-secret-that-is-long-enough-for-hs256-validation",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["https://app.example.test"],
  appEnv: "production",
  emailOnboardingEnabled: true,
};

function verifyRequest(forwardedFor: string, realIp: string): Request {
  return new Request("https://stage.test/functions/v1/api/auth/verify-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.11",
      "x-forwarded-for": forwardedFor,
      "x-real-ip": realIp,
    },
    body: JSON.stringify({ token: "invalid-token" }),
  });
}

Deno.test("verification attempts with spoofed forwarding headers share one rate-limit subject", async () => {
  const attempts = new Map<string, number>();
  const subjects: string[] = [];
  const rateLimitedDb: Database = {
    async connect() {
      const client: SqlClient = {
        async queryObject<T>(_query: string, parameters: unknown[] = []) {
          const subject = String(parameters[2]);
          subjects.push(subject);
          const count = (attempts.get(subject) ?? 0) + 1;
          attempts.set(subject, count);
          const payload = count > 1
            ? { denial: "rate_limited" }
            : { denial: "invalid_token" };
          return { rows: [{ payload } as unknown as T] };
        },
        release() {},
      };
      return client;
    },
  };

  for (const request of [
    verifyRequest("198.51.100.1", "198.51.100.2"),
    verifyRequest("198.51.100.9", "198.51.100.8"),
  ]) {
    const error = await assertRejects(
      () => handleOnboardingRoute(request, rateLimitedDb, config),
      ApiError,
    );
    assertEquals(error.status, 400);
  }

  assertEquals(subjects.length, 2);
  assertEquals(subjects[0], subjects[1]);
});

Deno.test("hosted verification fails closed without trusted IP despite forwarded headers", async () => {
  let databaseTouched = false;
  const untouchedDb: Database = {
    async connect() {
      databaseTouched = true;
      throw new Error("Database must not be queried without a trusted rate-limit identity");
    },
  };
  const error = await assertRejects(
    () => handleOnboardingRoute(new Request("https://stage.test/functions/v1/api/auth/verify-email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.1",
        "x-real-ip": "198.51.100.2",
      },
      body: JSON.stringify({ token: "invalid-token" }),
    }), untouchedDb, config),
    ApiError,
  );

  assertEquals(error.status, 503);
  assertEquals(databaseTouched, false);
});

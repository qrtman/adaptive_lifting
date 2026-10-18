import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiError } from "./errors/mod.ts";
import type { AppConfig } from "./config.ts";
import { enforceMutationOrigin } from "./requestOrigin.ts";

const config: AppConfig = {
  databaseUrl: "postgres://unused",
  jwtCurrent: "test-app-secret-that-is-long-enough-for-hs256-validation",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["https://staging.example.test"],
};

function request(method: string, headers: HeadersInit = {}): Request {
  return new Request("https://edge.example.test/api/mutation", { method, headers });
}

Deno.test("allows cookie mutations from the exact configured origin", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    enforceMutationOrigin(request(method, {
      origin: "https://staging.example.test",
      cookie: "session_id=synthetic-session",
    }), config);
  }
});

Deno.test("rejects untrusted, null, missing, and mismatched browser origins", async () => {
  const cases: HeadersInit[] = [
    { origin: "https://attacker.example", cookie: "session_id=synthetic-session" },
    { origin: "null", cookie: "session_id=synthetic-session" },
    { cookie: "session_id=synthetic-session" },
    { origin: "https://staging.example.test", referer: "https://attacker.example/submit", cookie: "session_id=synthetic-session" },
    { referer: "not a URL", cookie: "session_id=synthetic-session" },
    { origin: "https://attacker.example", "x-forwarded-host": "staging.example.test", cookie: "session_id=synthetic-session" },
  ];
  for (const headers of cases) {
    const error = await assertRejects(
      () => Promise.resolve().then(() => enforceMutationOrigin(request("POST", headers), config)),
      ApiError,
    );
    assertEquals(error.status, 403);
  }
});

Deno.test("accepts an allowlisted Referer when Origin is omitted", () => {
  enforceMutationOrigin(request("PATCH", {
    referer: "https://staging.example.test/account/profile",
    cookie: "session_id=synthetic-session",
  }), config);
});

Deno.test("preserves originless server bearer calls but not unauthenticated writes", async () => {
  enforceMutationOrigin(request("POST", { authorization: "Bearer server-token" }), config);
  const error = await assertRejects(
    () => Promise.resolve().then(() => enforceMutationOrigin(request("POST"), config)),
    ApiError,
  );
  assertEquals(error.status, 403);
});

Deno.test("does not affect safe reads", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    enforceMutationOrigin(request(method, { cookie: "session_id=synthetic-session" }), config);
  }
});

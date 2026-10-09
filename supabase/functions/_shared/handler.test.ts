import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHandler } from "./handler.ts";
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
  appUrl: "https://staging.example.test",
  appEnv: "staging",
};

function database(): { db: Database; connections: () => number } {
  let connections = 0;
  return {
    db: {
      async connect() {
        connections++;
        const client: SqlClient = {
          async queryObject<T>() { return { rows: [] as T[] }; },
          release() {},
        };
        return client;
      },
    },
    connections: () => connections,
  };
}

Deno.test("shared request boundary rejects cross-origin mutations before route or database access", async () => {
  const routes: Array<[string, string]> = [
    ["POST", "/api/auth/logout"],
    ["PATCH", "/api/auth/profile"],
    ["POST", "/api/sessions"],
    ["PATCH", "/api/sessions/synthetic-session"],
    ["DELETE", "/api/sessions/synthetic-session"],
    ["POST", "/api/sets/log"],
    ["PUT", "/api/day-notes"],
    ["POST", "/api/analytics/query"],
    ["POST", "/api/billing/vouchers/redeem"],
    ["POST", "/api/auth/coach-code"],
    ["POST", "/api/coach/push-program"],
    ["POST", "/api/integrations/telegram/link-token"],
    ["POST", "/api/integrations/google-sheets/publish"],
    ["POST", "/api/realtime/token"],
  ];
  const harness = database();
  const handler = createHandler(config, harness.db);

  for (const [method, path] of routes) {
    const response = await handler(new Request(`https://edge.example.test${path}`, {
      method,
      headers: {
        origin: "https://attacker.example",
        cookie: "session_id=synthetic-session",
        "content-type": "application/json",
      },
      body: method === "DELETE" ? undefined : "{}",
    }));
    assertEquals(response.status, 403, `${method} ${path}`);
  }

  assertEquals(harness.connections(), 0, "origin rejection must precede all route/database work");
});

Deno.test("signed provider webhook exceptions continue to their independent authentication checks", async () => {
  const harness = database();
  const handler = createHandler(config, harness.db);

  const stripe = await handler(new Request("https://edge.example.test/api/billing/stripe/webhook", {
    method: "POST",
    headers: { origin: "https://attacker.example", cookie: "session_id=synthetic-session" },
    body: "{}",
  }));
  const telegram = await handler(new Request("https://edge.example.test/api/integrations/telegram/webhook", {
    method: "POST",
    headers: { origin: "https://attacker.example", cookie: "session_id=synthetic-session", "content-type": "application/json" },
    body: "{}",
  }));

  assert(stripe.status !== 403, "Stripe must reach its signature/configuration guard");
  assert(telegram.status !== 403, "Telegram must reach its secret-token/configuration guard");
});

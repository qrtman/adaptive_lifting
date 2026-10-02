import { createHandler } from "../functions/_shared/handler.ts";
import type { AppConfig } from "../functions/_shared/config.ts";
import type { Database, SqlClient } from "../functions/_shared/db/mod.ts";
import tokens from "./python_tokens.json" with { type: "json" };
import catalog from "../functions/api/catalog.json" with { type: "json" };

const config: AppConfig = {
  databaseUrl: "postgresql://unused:unused@localhost:5432/postgres",
  jwtCurrent: tokens.current_secret,
  jwtPrevious: tokens.previous_secret,
  enforceLegacyEmailVerification: false,
  allowedOrigins: ["https://app.example.test"],
};
const db: Database = {
  connect: () =>
    Promise.resolve({
      queryObject: (query: string) =>
        Promise.resolve({
          rows: query.includes("from public.sessions")
            ? [{
              id: "session-1",
              user_id: "user-1",
              jwt_id: "session-1",
              revoked_at: null,
              active: true,
            }]
            : query.includes("from public.users")
            ? [{
              id: "user-1",
              email: "athlete@example.test",
              role: "ATHLETE",
              display_name: null,
              google_sub: null,
              email_verified_at: "2026-01-01",
              email_verification_required: true,
              email_verification_legacy_exempt: false,
              deleted_at: null,
            }]
            : [{ ok: 1 }],
        }),
      release: () => {},
    } as SqlClient),
};
function assert(value: unknown): asserts value {
  if (!value) throw new Error("assertion failed");
}

Deno.test("health checks the database and returns Python payload", async () => {
  const response = await createHandler(config, db)(
    new Request("https://example.test/api/health"),
  );
  assert(response.status === 200);
  assert(
    JSON.stringify(await response.json()) === JSON.stringify({ status: "ok" }),
  );
  const failure = await createHandler(config, {
    connect: () => Promise.reject(new Error("database unavailable")),
  })(
    new Request("https://example.test/api/health"),
  );
  assert(failure.status === 500);
});

Deno.test("catalog requires app session and matches Python registry fixture", async () => {
  const handler = createHandler(config, db);
  const denied = await handler(
    new Request("https://example.test/api/analytics/catalog"),
  );
  assert(denied.status === 401);
  const response = await handler(
    new Request("https://example.test/functions/v1/api/api/analytics/catalog", {
      headers: {
        Cookie: `session_id=${tokens.current_token}`,
        Origin: "https://app.example.test",
      },
    }),
  );
  assert(response.status === 200);
  assert(
    response.headers.get("Access-Control-Allow-Origin") ===
      "https://app.example.test",
  );
  assert(JSON.stringify(await response.json()) === JSON.stringify(catalog));
  assert(
    (await handler(
      new Request("https://example.test/api/analytics/catalog", {
        method: "POST",
      }),
    )).status === 405,
  );
});

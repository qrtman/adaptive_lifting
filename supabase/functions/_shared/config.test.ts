import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadConfig } from "./config.ts";

function env(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    DATABASE_URL: "postgres://runtime:secret@localhost/postgres",
    JWT_SECRET_CURRENT: "a test application signing secret long enough for HS256",
    CORS_ALLOWED_ORIGINS: "https://app.example.test",
    APP_ENV: "staging",
    ...overrides,
  };
  return (name: string) => values[name];
}

Deno.test("Realtime token switch defaults disabled and accepts explicit false/true", () => {
  assertEquals(loadConfig(env()).realtimeTokensEnabled, false);
  assertEquals(loadConfig(env({ REALTIME_TOKENS_ENABLED: "false" })).realtimeTokensEnabled, false);
  assertEquals(loadConfig(env({ REALTIME_TOKENS_ENABLED: "true" })).realtimeTokensEnabled, true);
});

Deno.test("Realtime token switch rejects ambiguous values", () => {
  assertThrows(
    () => loadConfig(env({ REALTIME_TOKENS_ENABLED: "sometimes" })),
    Error,
    "REALTIME_TOKENS_ENABLED must be a boolean",
  );
});

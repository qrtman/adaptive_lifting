import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rateLimitClientIp, resolveClientIp, verifiedSignedClientIp } from "./clientIp.ts";
import { ApiError } from "./errors/mod.ts";

const KEY = "test-client-ip-signing-key-0123456789abcdef";
const HOSTED = "https://project.supabase.co/functions/v1/api/auth/login";
const NOW_MS = 1_900_000_000_000;
const NOW_S = NOW_MS / 1000;

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signed(ip: string, ts: number, key = KEY): Promise<Record<string, string>> {
  return {
    "x-al-client-ip": ip,
    "x-al-client-ip-ts": String(ts),
    "x-al-client-ip-sig": await hmacHex(key, `${ip}|${ts}`),
  };
}

Deno.test("local loopback requests share a fixed rate-limit identity", async () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const request = new Request(`http://${hostname}/api/auth/login`, {
      headers: {
        "cf-connecting-ip": crypto.randomUUID(),
        "x-forwarded-for": crypto.randomUUID(),
        "x-real-ip": crypto.randomUUID(),
      },
    });
    assertEquals(await rateLimitClientIp(request, { clientIpSigningKey: KEY }), "127.0.0.1");
  }
});

Deno.test("hosted malformed ingress IP fails closed", async () => {
  await assertRejects(
    () => rateLimitClientIp(new Request(HOSTED, {
      headers: {
        "cf-connecting-ip": "203.0.113.1,198.51.100.1",
        "x-forwarded-for": "203.0.113.5",
        "x-real-ip": "203.0.113.6",
      },
    }), {}),
    ApiError,
  );
});

Deno.test("a fresh Worker-signed client IP replaces the Worker egress ingress IP", async () => {
  const request = new Request(HOSTED, {
    headers: { "cf-connecting-ip": "104.28.0.9", ...(await signed("203.0.113.50", NOW_S - 30)) },
  });
  assertEquals(await rateLimitClientIp(request, { clientIpSigningKey: KEY }, NOW_MS), "203.0.113.50");
  const v6 = new Request(HOSTED, {
    headers: { "cf-connecting-ip": "104.28.0.9", ...(await signed("2001:db8::1", NOW_S + 5)) },
  });
  assertEquals(await resolveClientIp(v6, KEY, NOW_MS), "2001:db8::1");
});

Deno.test("signed client IP falls back to ingress when invalid, stale, or unkeyed", async () => {
  const fresh = await signed("203.0.113.50", NOW_S);
  const cases: Array<[Record<string, string>, string | null]> = [
    [{ ...fresh, "x-al-client-ip": "203.0.113.51" }, KEY], // IP tampered
    [{ ...fresh, "x-al-client-ip-ts": String(NOW_S - 1) }, KEY], // timestamp tampered
    [{ ...fresh, "x-al-client-ip-sig": "0".repeat(64) }, KEY], // forged signature
    [{ ...fresh, "x-al-client-ip-sig": fresh["x-al-client-ip-sig"].slice(0, 63) }, KEY], // truncated
    [await signed("203.0.113.50", NOW_S - 61), KEY], // stale
    [await signed("203.0.113.50", NOW_S + 61), KEY], // future
    [await signed("203.0.113.50", NOW_S, "attacker-chosen-signing-key-0123456789"), KEY], // wrong key
    [await signed("not-an-ip", NOW_S), KEY], // malformed address
    [fresh, null], // Edge secret not configured
    [await signed("203.0.113.50", NOW_S, "short"), "short"], // weak key ignored
  ];
  for (const [headers, key] of cases) {
    const request = new Request(HOSTED, { headers: { ...headers, "cf-connecting-ip": "198.51.100.77" } });
    assertEquals(await verifiedSignedClientIp(request.headers, key, NOW_MS), null);
    assertEquals(await rateLimitClientIp(request, { clientIpSigningKey: key }, NOW_MS), "198.51.100.77");
  }
});

Deno.test("an invalid signed header without ingress IP still fails closed", async () => {
  const headers = { ...(await signed("203.0.113.50", NOW_S)), "x-al-client-ip-sig": "f".repeat(64) };
  await assertRejects(
    () => rateLimitClientIp(new Request(HOSTED, { headers }), { clientIpSigningKey: KEY }, NOW_MS),
    ApiError,
  );
});

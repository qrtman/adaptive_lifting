import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rateLimitClientIp } from "./clientIp.ts";
import { ApiError } from "./errors/mod.ts";

Deno.test("local loopback requests share a fixed rate-limit identity", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const request = new Request(`http://${hostname}/api/auth/login`, {
      headers: {
        "cf-connecting-ip": crypto.randomUUID(),
        "x-forwarded-for": crypto.randomUUID(),
        "x-real-ip": crypto.randomUUID(),
      },
    });
    assertEquals(rateLimitClientIp(request), "127.0.0.1");
  }
});

Deno.test("hosted malformed ingress IP fails closed", () => {
  assertThrows(
    () => rateLimitClientIp(new Request("https://project.supabase.co/functions/v1/api/auth/login", {
      headers: {
        "cf-connecting-ip": "203.0.113.1,198.51.100.1",
        "x-forwarded-for": "203.0.113.5",
        "x-real-ip": "203.0.113.6",
      },
    })),
    ApiError,
  );
});

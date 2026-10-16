import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadRealtimeSignerIfEnabled } from "./token.ts";

Deno.test("disabled Realtime does not read or require signer secrets", async () => {
  let reads = 0;
  const signer = await loadRealtimeSignerIfEnabled(false, () => {
    reads++;
    return undefined;
  });
  assertEquals(signer, null);
  assertEquals(reads, 0);
});

Deno.test("enabled Realtime fails closed when signer configuration is missing", async () => {
  await assertRejects(
    () => loadRealtimeSignerIfEnabled(true, () => undefined),
    Error,
    "REALTIME_JWT_PRIVATE_JWK is required",
  );
});

Deno.test("enabled Realtime rejects malformed signer configuration", async () => {
  await assertRejects(
    () => loadRealtimeSignerIfEnabled(true, (name) => name === "REALTIME_JWT_PRIVATE_JWK" ? "{}" : "production"),
    Error,
    "private P-256 JWK",
  );
});

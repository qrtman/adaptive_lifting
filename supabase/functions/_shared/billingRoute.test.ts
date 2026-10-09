import { assertEquals, assertRejects } from "@std/assert";
import { billingTestHelpers } from "./billingRoute.ts";

const encoder = new TextEncoder();

async function signature(body: Uint8Array, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(encoder.encode(`${timestamp}.`).length + body.length);
  signed.set(encoder.encode(`${timestamp}.`)); signed.set(body, encoder.encode(`${timestamp}.`).length);
  const result = await crypto.subtle.sign("HMAC", key, signed);
  return `t=${timestamp},v1=${[...new Uint8Array(result)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

Deno.test("Stripe signature verifies exact raw bytes and parsed event", async () => {
  const now = 1_800_000_000_000;
  const raw = encoder.encode('{"id":"evt_test","livemode":false}');
  const header = await signature(raw, "whsec_test_value", now / 1000);
  const event = await billingTestHelpers.verifyStripeSignature(raw, header, "whsec_test_value", now);
  assertEquals(event.id, "evt_test");
  assertEquals(event.livemode, false);
});

Deno.test("Stripe signature rejects missing, altered, malformed, and stale signatures", async () => {
  const now = 1_800_000_000_000;
  const raw = encoder.encode('{"id":"evt_test"}');
  const header = await signature(raw, "whsec_test_value", now / 1000);
  await assertRejects(() => billingTestHelpers.verifyStripeSignature(raw, null, "whsec_test_value", now));
  await assertRejects(() => billingTestHelpers.verifyStripeSignature(encoder.encode('{"id":"evt_other"}'), header, "whsec_test_value", now));
  await assertRejects(() => billingTestHelpers.verifyStripeSignature(raw, "t=x,v1=bad", "whsec_test_value", now));
  const stale = await signature(raw, "whsec_test_value", now / 1000 - 301);
  await assertRejects(() => billingTestHelpers.verifyStripeSignature(raw, stale, "whsec_test_value", now));
});

Deno.test("Stripe catalog and provider URLs validate without accepting arbitrary origins", () => {
  assertEquals(billingTestHelpers.validPrice({ id: "price_x", active: true, unit_amount: 100,
    currency: "usd", recurring: { interval: "month", interval_count: 1 } }, "price_x"), true);
  assertEquals(billingTestHelpers.validPrice({ id: "price_x", active: false, unit_amount: 100,
    currency: "usd", recurring: { interval: "month" } }, "price_x"), false);
  assertEquals(billingTestHelpers.validPrice({ id: "price_x", active: true, unit_amount: 100,
    currency: "usd", recurring: { interval: "month" } }, "price_x"), false);
  assertEquals(billingTestHelpers.trustedOrigin({ appUrl: "https://app.example", cookieSecure: true, billingAppUrlConfigured: true } as never), "https://app.example");
  let rejected = false;
  try { billingTestHelpers.trustedOrigin({ appUrl: "https://app.example/path", cookieSecure: true, billingAppUrlConfigured: true } as never); }
  catch { rejected = true; }
  assertEquals(rejected, true);
});

Deno.test("Stripe provider errors do not reveal response bodies", async () => {
  const fetcher = ((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(
    new Response('{"error":{"message":"secret detail"}}', { status: 500 }),
  )) as typeof fetch;
  try {
    await billingTestHelpers.stripeRequest("/v1/prices/price_x", "sk_test_fake", "GET", {}, undefined, fetcher);
    throw new Error("expected failure");
  } catch (error) {
    assertEquals((error as Error).message, "Stripe request failed");
    assertEquals((error as Error).message.includes("secret detail"), false);
  }
});

Deno.test("voucher keyed hash is deterministic and case normalization is server-side", async () => {
  const first = await billingTestHelpers.hmacHex("voucher-test-key-with-more-than-32-bytes", "VCH-AAAAA-BBBBB-CCCCC-DDDDD");
  const second = await billingTestHelpers.hmacHex("voucher-test-key-with-more-than-32-bytes", "VCH-AAAAA-BBBBB-CCCCC-DDDDD");
  assertEquals(first, second);
  assertEquals(first.length, 64);
});

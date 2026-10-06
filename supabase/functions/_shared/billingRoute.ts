import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { authRepository } from "./db/mod.ts";
import { authenticate } from "./auth/session.ts";
import type { Principal } from "./types/mod.ts";
import { ApiError, jsonResponse } from "./errors/mod.ts";

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;
const PLANS = ["coach_starter", "coach_pro", "coach_unlimited"] as const;
const PLAN_NAMES: Record<string, string> = {
  coach_starter: "Starter", coach_pro: "Pro", coach_unlimited: "Unlimited",
};

async function rpc<T extends Json>(db: Database, sql: string, args: unknown[] = []): Promise<T> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ payload: T | string }>(sql, args);
    if (!result.rows[0]) throw new Error("Billing database interface returned no result");
    const value = result.rows[0].payload;
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } finally { client.release(); }
}

async function secret(db: Database, name: string, envValue?: string | null): Promise<string> {
  if (envValue?.trim()) return envValue.trim();
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ value: string | null }>(
      "select al_private.al_billing_secret($1::text) as value", [name],
    );
    return result.rows[0]?.value?.trim() ?? "";
  } catch { return ""; } finally { client.release(); }
}

function fail(status: number, code: string, message: string, headers?: HeadersInit): never {
  throw new ApiError(status, { code, message }, headers);
}

function mapOwner(result: Json): void {
  if (!result.denial) return;
  const map: Record<string, [number, string | Json]> = {
    invalid_session: [401, "Could not validate credentials"],
    account_ineligible: [403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." }],
    billing_owner_required: [403, { code: "BILLING_OWNER_REQUIRED", message: "Workspace owner access is required for billing." }],
    voucher_coach_required: [403, { code: "VOUCHER_COACH_ACCOUNT_REQUIRED", message: "A coach account is required to redeem this voucher." }],
  };
  const [status, detail] = map[String(result.denial)] ?? [500, "Internal server error"];
  throw new ApiError(status, detail);
}

function stripeConfigurationError(): never {
  fail(503, "BILLING_NOT_CONFIGURED", "Billing is currently unavailable.");
}

function isPlaceholder(value: string): boolean {
  return !value || /^(replace|dev-only|mock_|example|sample|changeme)/i.test(value.trim());
}

async function stripeConfig(db: Database, config: AppConfig) {
  const [enabledRaw, key, webhook, starter, pro, unlimited] = await Promise.all([
    secret(db, "adaptive_lifting_stripe_billing_enabled", config.stripeBillingEnabledConfigured ? String(Boolean(config.stripeBillingEnabled)) : null),
    secret(db, "adaptive_lifting_stripe_secret_key", config.stripeSecretKey),
    secret(db, "adaptive_lifting_stripe_webhook_secret", config.stripeWebhookSecret),
    secret(db, "adaptive_lifting_stripe_price_coach_starter", config.stripePriceCoachStarter),
    secret(db, "adaptive_lifting_stripe_price_coach_pro", config.stripePriceCoachPro),
    secret(db, "adaptive_lifting_stripe_price_coach_unlimited", config.stripePriceCoachUnlimited),
  ]);
  const liveRaw = await secret(db, "adaptive_lifting_stripe_expect_livemode", config.stripeExpectLivemodeConfigured ? String(Boolean(config.stripeExpectLivemode)) : null);
  const enabled = /^(1|true|yes)$/i.test(enabledRaw);
  const prices = { coach_starter: starter, coach_pro: pro, coach_unlimited: unlimited };
  const values = Object.values(prices);
  const expectLivemode = /^(1|true|yes)$/i.test(liveRaw);
  const environment = (config.appEnv ?? "").toLowerCase();
  const productionLike = ["production", "prod"].includes(environment) ||
    (!environment && Boolean(config.cookieSecure));
  const environmentModeInvalid = environment === "staging" && expectLivemode ||
    productionLike && !expectLivemode;
  const keyMode = key.match(/^(?:sk|rk)_(test|live)_/i)?.[1]?.toLowerCase();
  if (!enabled || isPlaceholder(key) || !keyMode ||
      (expectLivemode ? keyMode !== "live" : keyMode !== "test") || environmentModeInvalid ||
      values.some((value) => isPlaceholder(value) || !/^price_[A-Za-z0-9]+$/.test(value)) ||
      new Set(values).size !== 3 || !config.appUrl || !config.billingAppUrlConfigured ||
      /^(replace|mock_|example|sample)/i.test(webhook || "")) stripeConfigurationError();
  return { key, webhook, prices, expectLivemode };
}

function trustedOrigin(config: AppConfig): string {
  const raw = (config.appUrl ?? "").trim();
  let parsed: URL;
  try { parsed = new URL(raw); } catch { fail(503, "BILLING_NOT_CONFIGURED", "Billing return URL is unavailable."); }
  const productionLike = Boolean(config.cookieSecure);
  if (!parsed!.hostname || !["https:", ...(productionLike ? [] : ["http:"])].includes(parsed!.protocol) ||
      !["", "/"].includes(parsed!.pathname) || parsed!.search || parsed!.hash || parsed!.username || parsed!.password) {
    fail(503, "BILLING_NOT_CONFIGURED", "Billing return URL is unavailable.");
  }
  return parsed!.origin;
}

type StripeFailure = Error & { status?: number; ambiguous?: boolean };
async function stripeRequest(
  path: string, key: string, method: "GET" | "POST", params: Record<string, string> = {},
  idempotencyKey?: string, fetcher: Fetcher = fetch,
): Promise<Json> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  let body: string | undefined;
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(params).toString();
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response: Response;
  try {
    response = await fetcher(`https://api.stripe.com${path}`, {
      method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(12_000),
    });
  } catch {
    const error = new Error("Stripe network failure") as StripeFailure;
    error.ambiguous = method === "POST";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Stripe request failed") as StripeFailure;
    error.status = response.status;
    // A POST response status is definitive only for non-rate-limited client-side rejection.
    error.ambiguous = method === "POST" && (response.status === 429 || response.status >= 500);
    throw error;
  }
  try { return await response.json() as Json; }
  catch { throw new Error("Stripe returned malformed data"); }
}

function validPrice(price: Json, expectedId: string): boolean {
  const recurring = price.recurring as Json | null;
  return price.id === expectedId && price.active === true && !!recurring &&
    typeof recurring.interval === "string" && recurring.interval.length > 0 &&
    Number.isInteger(recurring.interval_count) && Number(recurring.interval_count) > 0 &&
    Number.isInteger(price.unit_amount) && Number(price.unit_amount) > 0 &&
    typeof price.currency === "string" && price.currency.length > 0;
}

function appError(result: Json): void {
  if (!result.error) return;
  const errors: Record<string, [number, string, string]> = {
    subscription_exists: [409, "BILLING_SUBSCRIPTION_EXISTS", "This coaching account already has a Stripe subscription."],
    request_conflict: [409, "BILLING_CHECKOUT_REQUEST_CONFLICT", "This checkout request cannot be reused for a different plan."],
    checkout_in_progress: [409, "BILLING_CHECKOUT_IN_PROGRESS", "A checkout for another plan is already in progress. Complete or wait for that checkout to expire before starting another."],
    provider_state_unsafe: [502, "BILLING_PROVIDER_ERROR", "The previous checkout could not be safely expired."],
    customer_unavailable: [409, "BILLING_CUSTOMER_UNAVAILABLE", "Billing customer could not be linked to this workspace."],
    customer_missing: [404, "BILLING_CUSTOMER_UNAVAILABLE", "No billing customer is linked to this workspace."],
    invalid_request: [422, "BILLING_REQUEST_INVALID", "Invalid billing request."],
  };
  const [status, code, message] = errors[String(result.error)] ?? [500, "BILLING_PROVIDER_ERROR", "Billing provider is temporarily unavailable."];
  fail(status, code, message);
}

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secretValue: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretValue), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function verifyStripeSignature(raw: Uint8Array, header: string | null, secretValue: string, now = Date.now()): Promise<Json> {
  if (!header) throw new ApiError(400, "Missing Stripe signature");
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestampText = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!timestampText || !/^\d+$/.test(timestampText) || !signatures.length || signatures.some((sig) => !/^[a-f0-9]{64}$/i.test(sig))) {
    throw new ApiError(400, "Invalid Stripe webhook signature or payload");
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > 300) {
    throw new ApiError(400, "Invalid Stripe webhook signature or payload");
  }
  const signed = new Uint8Array(utf8(`${timestampText}.`).length + raw.length);
  signed.set(utf8(`${timestampText}.`)); signed.set(raw, utf8(`${timestampText}.`).length);
  const key = await crypto.subtle.importKey("raw", utf8(secretValue), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, signed);
  const expected = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
  if (!signatures.some((sig) => safeEqual(sig.toLowerCase(), expected))) throw new ApiError(400, "Invalid Stripe webhook signature or payload");
  try { return JSON.parse(new TextDecoder().decode(raw)) as Json; }
  catch { throw new ApiError(400, "Invalid Stripe webhook signature or payload"); }
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }

async function billingOwner(db: Database, principal: Principal, config: AppConfig): Promise<Json> {
  const result = await rpc<Json>(db,
    "select al_private.al_billing_owner($1::text,$2::text,$3::boolean) as payload",
    [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification]);
  mapOwner(result);
  return result;
}

async function releaseFailedCheckout(
  db: Database, principal: Principal, config: AppConfig, requestId: string,
): Promise<void> {
  try {
    await rpc(db,
      "select al_private.al_billing_checkout_fail($1::text,$2::text,$3::boolean,$4::text) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, requestId]);
  } catch {
    // Leave CREATING intact if its safe finalization cannot be persisted.
  }
}

function getBody(raw: unknown): Json {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(422, "Invalid request body");
  return raw as Json;
}

async function readJson(request: Request): Promise<Json> {
  try { return getBody(await request.json()); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "Invalid request body");
  }
}

async function handleWebhook(request: Request, db: Database, config: AppConfig, fetcher: Fetcher): Promise<Response> {
  const enabledRaw = await secret(db, "adaptive_lifting_stripe_billing_enabled", config.stripeBillingEnabledConfigured ? String(Boolean(config.stripeBillingEnabled)) : null);
  if (!/^(1|true|yes)$/i.test(enabledRaw)) throw new ApiError(503, "Stripe billing webhook is disabled");
  const webhookSecret = await secret(db, "adaptive_lifting_stripe_webhook_secret", config.stripeWebhookSecret);
  if (!webhookSecret || isPlaceholder(webhookSecret)) throw new ApiError(503, "Stripe webhook verification is not configured");
  const stripe = await stripeConfig(db, config);
  const raw = new Uint8Array(await request.arrayBuffer());
  const event = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), webhookSecret);
  if (typeof event.livemode !== "boolean" || event.livemode !== stripe.expectLivemode) throw new ApiError(400, "Stripe event mode does not match server configuration");
  if (event.account) return jsonResponse({ status: "ignored_connect" });
  const payload = await rpc<Json>(db, "select al_private.al_stripe_webhook_apply($1::jsonb,$2::integer) as payload", [JSON.stringify(event), 3]);
  if (payload.status === "failed") throw new ApiError(500, "Stripe subscription event could not be mapped safely");
  return jsonResponse({ status: payload.status ?? "processed" });
}

async function handleVoucher(request: Request, db: Database, principal: Principal, config: AppConfig): Promise<Response> {
  const body = await readJson(request);
  if (Object.keys(body).some((key) => key !== "code") || typeof body.code !== "string" || body.code.length < 1 || body.code.length > 64) {
    throw new ApiError(422, "Invalid request body");
  }
  const actor = await rpc<Json>(db,
    "select al_private.al_voucher_actor($1::text,$2::text,$3::boolean) as payload",
    [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification]);
  mapOwner(actor);
  const enabledRaw = await secret(db, "adaptive_lifting_voucher_billing_enabled", config.voucherBillingEnabledConfigured ? String(Boolean(config.voucherBillingEnabled)) : null);
  if (!/^(1|true|yes)$/i.test(enabledRaw)) {
    fail(503, "VOUCHER_UNAVAILABLE", "Voucher redemption is currently unavailable.");
  }
  const key = await secret(db, "adaptive_lifting_voucher_code_secret", config.voucherCodeSecret);
  if (!key || isPlaceholder(key) || new TextEncoder().encode(key).length < 32) {
    fail(503, "VOUCHER_UNAVAILABLE", "Voucher redemption is currently unavailable.");
  }
  const ip = request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1) || "unknown";
  let limit: Json;
  try {
    limit = await rpc<Json>(db, "select al_private.al_voucher_rate_limit($1::text,$2::text) as payload", [principal.user.id, ip]);
  } catch { fail(503, "VOUCHER_UNAVAILABLE", "Voucher redemption is currently unavailable."); }
  if (limit!.allowed !== true) fail(429, "VOUCHER_RATE_LIMITED", "Too many voucher attempts. Try again later.", { "Retry-After": "60" });
  const normalized = body.code.trim().toUpperCase();
  if (!/^VCH-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}$/.test(normalized)) {
    fail(400, "VOUCHER_INVALID", "Voucher is invalid or no longer available.");
  }
  const codeHash = await hmacHex(key, normalized);
  let result: Json;
  try {
    result = await rpc<Json>(db,
      "select al_private.al_voucher_redeem($1::text,$2::text,$3::boolean,$4::text) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, codeHash]);
  } catch {
    fail(503, "VOUCHER_UNAVAILABLE", "Voucher redemption is currently unavailable.");
  }
  if (result.denial === "invalid") fail(400, "VOUCHER_INVALID", "Voucher is invalid or no longer available.");
  if (result.denial === "invalid_session") throw new ApiError(401, "Could not validate credentials");
  if (result.denial === "account_ineligible") throw new ApiError(403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." });
  if (result.denial) fail(503, "VOUCHER_UNAVAILABLE", "Voucher redemption is currently unavailable.");
  return jsonResponse({ status: "redeemed", planKey: result.planKey, durationDays: result.durationDays });
}

async function handleStripeRoute(request: Request, db: Database, principal: Principal, config: AppConfig, path: string, fetcher: Fetcher): Promise<Response> {
  const owner = await billingOwner(db, principal, config);
  const stripe = await stripeConfig(db, config);
  if (path === "/api/billing/plans" && request.method === "GET") {
    const plans = [];
    for (const planKey of PLANS) {
      let price: Json;
      try { price = await stripeRequest(`/v1/prices/${encodeURIComponent(stripe.prices[planKey])}`, stripe.key, "GET", {}, undefined, fetcher); }
      catch { fail(502, "BILLING_PROVIDER_ERROR", "Billing plans are temporarily unavailable."); }
      if (!validPrice(price!, stripe.prices[planKey])) fail(503, "BILLING_NOT_CONFIGURED", "Billing plan configuration is invalid.");
      const recurring = price!.recurring as Json;
      plans.push({ planKey, name: PLAN_NAMES[planKey], unitAmount: price!.unit_amount,
        currency: price!.currency, interval: recurring.interval, intervalCount: recurring.interval_count ?? 1,
        maxActiveAthletes: planKey === "coach_starter" ? 5 : planKey === "coach_pro" ? 25 : null });
    }
    return jsonResponse({ plans });
  }
  if (path === "/api/billing/stripe/checkout-session" && request.method === "POST") {
    const origin = trustedOrigin(config);
    const body = await readJson(request);
    if (Object.keys(body).length !== 2 || typeof body.planKey !== "string" ||
        typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
      throw new ApiError(422, "Invalid request body");
    }
    const planKey = body.planKey;
    if (!PLANS.includes(planKey as typeof PLANS[number])) fail(400, "BILLING_PLAN_NOT_PURCHASABLE", "The selected coaching plan is not available for purchase.");
    const claimed = await rpc<Json>(db,
      "select al_private.al_billing_checkout_claim($1::text,$2::text,$3::boolean,$4::text,$5::text) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, planKey, body.requestId]);
    mapOwner(claimed); appError(claimed);
    if (claimed.action === "resume") return jsonResponse({ url: claimed.url, resumed: true });
    if (claimed.action === "expire") {
      try {
        const prior = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(String(claimed.sessionId))}`, stripe.key, "GET", {}, undefined, fetcher);
        if (prior.status === "open") await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(String(claimed.sessionId))}/expire`, stripe.key, "POST", {}, undefined, fetcher);
        else if (prior.status !== "expired") throw new Error("Stripe checkout is not safely expirable");
      } catch { fail(502, "BILLING_PROVIDER_ERROR", "The previous checkout could not be safely expired."); }
      const released = await rpc<Json>(db,
        "select al_private.al_billing_checkout_expired($1::text,$2::text,$3::boolean,$4::text) as payload",
        [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, String(claimed.requestId)]);
      mapOwner(released); appError(released);
      const next = await rpc<Json>(db,
        "select al_private.al_billing_checkout_claim($1::text,$2::text,$3::boolean,$4::text,$5::text) as payload",
        [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, planKey, body.requestId]);
      mapOwner(next); appError(next);
      Object.assign(claimed, next);
    }
    const customerContext = await rpc<Json>(db,
      "select al_private.al_billing_customer_context($1::text,$2::text,$3::boolean) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification]);
    mapOwner(customerContext); appError(customerContext);
    let customerId = customerContext.customerId as string | null;
    if (!customerId) {
      let customer: Json;
      try {
        customer = await stripeRequest("/v1/customers", stripe.key, "POST", {
          email: String(customerContext.email), name: String(customerContext.displayName || customerContext.workspaceName),
          "metadata[workspace_id]": String(owner.workspaceId),
        }, `stripe-customer:${owner.workspaceId}:v1`, fetcher);
      } catch {
        await releaseFailedCheckout(db, principal, config, String(claimed.requestId));
        fail(502, "BILLING_PROVIDER_ERROR", "Billing provider is temporarily unavailable.");
      }
      customerId = String(customer!.id ?? "");
      if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) {
        await releaseFailedCheckout(db, principal, config, String(claimed.requestId));
        fail(502, "BILLING_CUSTOMER_UNAVAILABLE", "Billing customer could not be created.");
      }
      let linked: Json;
      try {
        linked = await rpc<Json>(db,
          "select al_private.al_billing_customer_link($1::text,$2::text,$3::boolean,$4::text) as payload",
          [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, customerId]);
      } catch {
        await releaseFailedCheckout(db, principal, config, String(claimed.requestId));
        fail(502, "BILLING_CUSTOMER_UNAVAILABLE", "Billing customer could not be linked to this workspace.");
      }
      if (linked!.error) {
        await releaseFailedCheckout(db, principal, config, String(claimed.requestId));
      }
      mapOwner(linked!); appError(linked!);
      customerId = String(linked!.customerId ?? customerId);
    }
    const requestId = String(claimed.requestId);
    const reservedPlan = String(claimed.planKey ?? planKey);
    let checkout: Json;
    try {
      checkout = await stripeRequest("/v1/checkout/sessions", stripe.key, "POST", {
        mode: "subscription", customer: customerId,
        "line_items[0][price]": stripe.prices[reservedPlan as keyof typeof stripe.prices],
        "line_items[0][quantity]": "1",
        success_url: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}#/security`,
        cancel_url: `${origin}/?billing=cancelled#/security`,
        "metadata[workspace_id]": String(owner.workspaceId), "metadata[requested_plan_key]": reservedPlan,
      }, `checkout:${owner.workspaceId}:${reservedPlan}:${requestId}`, fetcher);
    } catch (error) {
      const reason = error as StripeFailure;
      if (reason.ambiguous !== true) await rpc(db,
        "select al_private.al_billing_checkout_fail($1::text,$2::text,$3::boolean,$4::text) as payload",
        [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, requestId]);
      fail(502, "BILLING_PROVIDER_ERROR", "Checkout is temporarily unavailable.");
    }
    if (typeof checkout!.id !== "string" || !checkout!.id.startsWith("cs_") ||
        typeof checkout!.url !== "string" || !checkout!.url.startsWith("https://checkout.stripe.com/") ||
        !Number.isInteger(checkout!.expires_at) || Number(checkout!.expires_at) <= 0) {
      fail(502, "BILLING_PROVIDER_ERROR", "Checkout is temporarily unavailable.");
    }
    const finalized = await rpc<Json>(db,
      "select al_private.al_billing_checkout_finalize($1::text,$2::text,$3::boolean,$4::text,$5::text,$6::text,$7::bigint) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification, requestId,
        checkout!.id, checkout!.url, Number(checkout!.expires_at)]);
    mapOwner(finalized); appError(finalized);
    return jsonResponse({ url: checkout!.url, resumed: claimed.action === "recover" });
  }
  if (path === "/api/billing/stripe/portal-session" && request.method === "POST") {
    const origin = trustedOrigin(config);
    const mapping = await rpc<Json>(db,
      "select al_private.al_billing_customer_context($1::text,$2::text,$3::boolean) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification]);
    mapOwner(mapping); appError(mapping);
    if (!mapping.customerId) fail(404, "BILLING_CUSTOMER_UNAVAILABLE", "No billing customer is linked to this workspace.");
    let portal: Json;
    try { portal = await stripeRequest("/v1/billing_portal/sessions", stripe.key, "POST", {
      customer: String(mapping.customerId), return_url: `${origin}/?billing=portal-return#/security`,
    }, undefined, fetcher); } catch { fail(502, "BILLING_PROVIDER_ERROR", "Billing management is temporarily unavailable."); }
    if (typeof portal!.url !== "string" || !portal!.url.startsWith("https://billing.stripe.com/")) fail(502, "BILLING_PROVIDER_ERROR", "Billing management is temporarily unavailable.");
    return jsonResponse({ url: portal!.url });
  }
  throw new ApiError(405, "Method not allowed");
}

export async function handleBillingRoute(
  request: Request, db: Database, config: AppConfig, fetcher: Fetcher = fetch,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/functions\/v1\/api/, "");
  const normalized = path.startsWith("/api/") ? path : `/api${path}`;
  const billingPath = normalized === "/api/billing/plans" ||
    ["/api/billing/stripe/checkout-session", "/api/billing/stripe/portal-session", "/api/billing/stripe/webhook", "/api/billing/vouchers/redeem"].includes(normalized);
  if (!billingPath) return null;
  if (normalized === "/api/billing/stripe/webhook") {
    if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
    return await handleWebhook(request, db, config, fetcher);
  }
  if (normalized === "/api/billing/vouchers/redeem") {
    if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
    const principal = await authenticate(request, authRepository(db), config);
    return await handleVoucher(request, db, principal, config);
  }
  if (!((normalized === "/api/billing/plans" && request.method === "GET") ||
      ((normalized === "/api/billing/stripe/checkout-session" || normalized === "/api/billing/stripe/portal-session") && request.method === "POST"))) {
    throw new ApiError(405, "Method not allowed");
  }
  const principal = await authenticate(request, authRepository(db), config);
  return await handleStripeRoute(request, db, principal, config, normalized, fetcher);
}

export const billingTestHelpers = { verifyStripeSignature, validPrice, stripeRequest, hmacHex, safeEqual, trustedOrigin };

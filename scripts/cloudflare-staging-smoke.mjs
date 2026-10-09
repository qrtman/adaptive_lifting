import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const stagingUrl = new URL(
  process.env.STAGING_URL ??
    "https://adaptive-lifting-staging.gartman-bekaali.workers.dev",
);
assert.equal(stagingUrl.protocol, "https:", "STAGING_URL must use HTTPS");
assert.ok(stagingUrl.hostname.endsWith(".workers.dev"), "STAGING_URL must be the isolated workers.dev host");

const distDir = path.resolve("dist");
const builtFiles = [path.join(distDir, "index.html")];
for (const entry of await readdir(path.join(distDir, "assets"))) {
  builtFiles.push(path.join(distDir, "assets", entry));
}
const forbiddenNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "JWT_SECRET_CURRENT",
  "STRIPE_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "GOOGLE_SHEETS_CLIENT_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
];
for (const file of builtFiles) {
  const content = await readFile(file, "utf8");
  for (const name of forbiddenNames) {
    assert.ok(!content.includes(name), `${name} must not be in ${path.relative(process.cwd(), file)}`);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const loadedAssets = new Map();
  page.on("response", (response) => {
    if (response.url().startsWith(new URL("/assets/", stagingUrl).href)) {
      loadedAssets.set(new URL(response.url()).pathname, response.status());
    }
  });

  const root = await page.goto(stagingUrl.href, { waitUntil: "networkidle" });
  assert.equal(root?.status(), 200, "app root must load");
  assert.match(await page.locator("body").innerText(), /sign in|login/i, "React app must render the sign-in surface");

  const deepLink = await page.goto(new URL("verify-email", stagingUrl).href, { waitUntil: "networkidle" });
  assert.equal(deepLink?.status(), 200, "SPA deep link must return the app shell");
  assert.ok(loadedAssets.size >= 2, "JS and CSS assets must load");
  assert.ok([...loadedAssets.values()].every((status) => status === 200), "all loaded app assets must return 200");

  const serviceWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return { scope: registration.scope, state: registration.active?.state ?? null };
  });
  assert.equal(serviceWorker.scope, stagingUrl.origin + "/", "service worker must control the app root");
  assert.equal(serviceWorker.state, "activated", "service worker must activate");

  const health = await page.evaluate(async () => {
    const response = await fetch("/api/health", { cache: "no-store" });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      projectRef: response.headers.get("sb-project-ref"),
      body: await response.json(),
    };
  });
  assert.equal(health.status, 200, "same-origin API health must succeed");
  assert.equal(health.projectRef, "admyuepbbtstayaydjmo", "health must reach Supabase staging");
  assert.equal(health.body.status, "ok", "health payload must be healthy");
  assert.match(health.cacheControl ?? "", /private,\s*no-store/i, "API health must not be publicly cached");

  const authMe = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    return { status: response.status, cacheControl: response.headers.get("cache-control") };
  });
  assert.equal(authMe.status, 401, "unauthenticated auth/me must deny access");
  assert.match(authMe.cacheControl ?? "", /private,\s*no-store/i, "auth/me must not be publicly cached");

  console.log(JSON.stringify({
    stagingUrl: stagingUrl.origin,
    privateCredentialScan: "PASS",
    staticAssets: [...loadedAssets.entries()],
    spaDeepLink: "PASS",
    serviceWorker,
    apiHealth: health,
    unauthenticatedAuthMe: authMe,
  }, null, 2));
} finally {
  await browser.close();
}

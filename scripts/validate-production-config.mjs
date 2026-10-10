import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const productionConfigPath = join(root, 'wrangler.production.jsonc');
const stagingConfigPath = join(root, 'wrangler.jsonc');
const envExamplePath = join(root, 'supabase', 'production.env.example');
const migrationDir = join(root, 'supabase', 'migrations');
const publicViteKeys = new Set(['VITE_BACKEND_URL', 'VITE_OFFLINE_AUTH_PUBLIC_KEY', 'VITE_GOOGLE_CLIENT_ID']);
const stagingRef = 'admyuepbbtstayaydjmo';
const productionOriginPlaceholder = 'https://REQUIRED_PRODUCTION_PROJECT_REF.supabase.co';
const expectedEnv = {
  APP_ENV: 'production',
  APP_URL: 'https://app.goatedmethod.me',
  COOKIE_SECURE: 'true',
  CORS_ALLOWED_ORIGINS: 'https://app.goatedmethod.me',
  STRIPE_BILLING_ENABLED: 'false',
  STRIPE_EXPECT_LIVEMODE: 'false',
  VOUCHER_BILLING_ENABLED: 'false',
};

function fail(message) {
  console.error(`Production configuration check failed: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path}: ${error.message}`);
  }
}

function parseEnvExample() {
  const values = new Map();
  for (const line of readFileSync(envExamplePath, 'utf8').split(/\r?\n/)) {
    const item = line.trim();
    if (!item || item.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(item);
    if (!match) fail('malformed production environment example');
    if (values.has(match[1])) fail(`duplicate environment key ${match[1]}`);
    values.set(match[1], match[2]);
  }
  for (const [key, expected] of Object.entries(expectedEnv)) {
    if (values.get(key) !== expected) fail(`${key} must equal ${expected}`);
  }
  if (values.get('EMAIL_VERIFICATION_NEW_ACCOUNTS') !== 'true') {
    fail('new password accounts must require email verification');
  }
  return values;
}

function verifyMigrationOrder() {
  const versions = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (versions.length !== 63) fail(`expected 63 SQL migrations, found ${versions.length}`);
  let previous = '';
  for (const name of versions) {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match || match[1] <= previous) fail(`invalid or out-of-order migration filename ${name}`);
    previous = match[1];
  }
  return versions;
}

function verifyRuntimeBoundaries() {
  const apiBase = readFileSync(join(root, 'src', 'services', 'apiBase.ts'), 'utf8');
  if (!/import\.meta\.env\.PROD\s*\?\s*['"]['"]\s*:/.test(apiBase)) {
    fail('production API base must remain same-origin and must not adopt VITE_BACKEND_URL');
  }
  const supabaseConfig = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  if (!/\[functions\.api\][\s\S]*?verify_jwt\s*=\s*false/.test(supabaseConfig)) {
    fail('custom application JWT handler must remain enabled at the API function boundary');
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('VITE_')) continue;
    if (!publicViteKeys.has(name)) fail(`${name} is not approved as a public frontend build variable`);
    if (name === 'VITE_BACKEND_URL' && value) fail('VITE_BACKEND_URL must be empty for a production same-origin build');
    if (value?.includes('admyuepbbtstayaydjmo') || value?.includes('adaptive-lifting-staging.gartman-bekaali.workers.dev')) {
      fail(`${name} references staging`);
    }
  }
  for (const envFile of ['.env', '.env.production']) {
    const path = join(root, envFile);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      if (!publicViteKeys.has(match[1])) fail(`${match[1]} is not approved as a public frontend build variable`);
      if (match[1] === 'VITE_BACKEND_URL' && !/^(['"]{2})?$/.test(match[2])) {
        fail('VITE_BACKEND_URL must be empty for a production same-origin build');
      }
      if (match[2].includes('admyuepbbtstayaydjmo') || match[2].includes('adaptive-lifting-staging.gartman-bekaali.workers.dev')) {
        fail(`${match[1]} references staging`);
      }
    }
  }
}

export function validateProductionConfig({ local = false } = {}) {
  const configPath = local ? join(root, 'wrangler.production.local.jsonc') : productionConfigPath;
  const prod = readJson(configPath);
  const staging = readJson(stagingConfigPath);
  const env = parseEnvExample();
  const versions = verifyMigrationOrder();
  verifyRuntimeBoundaries();
  const prodText = JSON.stringify(prod);

  if (prod.name !== 'adaptive-lifting-production') fail('production Worker name is not isolated');
  if (prod.name === staging.name || staging.name !== 'adaptive-lifting-staging') {
    fail('staging Worker identity changed or is shared');
  }
  if (prod.main !== 'cloudflare/worker.ts') fail('unexpected Worker entrypoint');
  if (prod.workers_dev !== false) fail('production workers.dev must stay disabled');
  if (prod.assets?.directory !== './dist/' || prod.assets?.binding !== 'ASSETS' ||
      prod.assets?.not_found_handling !== 'single-page-application' ||
      !prod.assets?.run_worker_first?.includes('/api/*')) {
    fail('production Static Assets or SPA/API routing is incomplete');
  }
  if (!prod.routes?.some((route) => route.pattern === 'app.goatedmethod.me/*' &&
      route.zone_name === 'goatedmethod.me' && !route.custom_domain)) {
    fail('production app hostname route is not configured for the existing zone');
  }
  const origin = prod.vars?.SUPABASE_PROJECT_ORIGIN;
  if (local) {
    const originMatch = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(origin ?? '');
    if (!originMatch || originMatch[1] === stagingRef) fail('local production config needs a valid non-staging Supabase project origin');
  } else if (origin !== productionOriginPlaceholder) {
    fail('committed production Supabase origin must remain an explicit fail-closed placeholder until project identity is approved');
  }
  if (prodText.includes(stagingRef) || prodText.includes('workers.dev') ||
      /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY|JWT_SECRET|DATABASE_URL|STRIPE_SECRET_KEY/.test(prodText)) {
    fail('production Worker config contains staging, a credential, or an unintended workers.dev route');
  }
  if (env.get('APP_URL') !== env.get('CORS_ALLOWED_ORIGINS')) fail('application URL and exact CORS origin differ');
  return { prod, staging, env, versions };
}

function listFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function buildAndScan() {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'production'], {
    cwd: root,
    env: { ...process.env, API_EDGE_TARGET: '', VITE_BACKEND_URL: '' },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) fail(`could not start Vite: ${result.error.message}`);
  if (result.status !== 0) fail(`Vite production build exited ${result.status}`);

  const forbidden = [
    'admyuepbbtstayaydjmo.supabase.co',
    'adaptive-lifting-staging.gartman-bekaali.workers.dev',
  ];
  for (const file of listFiles(join(root, 'dist'))) {
    const body = readFileSync(file);
    if (body.includes(0)) continue;
    const text = body.toString('utf8');
    if (forbidden.some((value) => text.includes(value))) {
      fail(`production build output references staging: ${file.slice(root.length + 1)}`);
    }
    if (/(?:sb_secret_|service_role|JWT_SECRET_CURRENT=|DATABASE_URL=|STRIPE_SECRET_KEY=)/i.test(text)) {
      fail(`production build output contains a private credential marker: ${file.slice(root.length + 1)}`);
    }
  }
  for (const required of ['index.html', 'sw.js']) {
    if (!existsSync(join(root, 'dist', required))) fail(`production PWA output is missing ${required}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateProductionConfig({ local: process.argv.includes('--local') });
    const projectMode = process.argv.includes('--local') ? 'generated local project origin' : 'fail-closed project placeholder';
    console.log(`Production config PASS: ${result.versions.length} ordered migrations, isolated Worker, exact origin, ${projectMode}.`);
    if (process.argv.includes('--build')) {
      buildAndScan();
      console.log('Production build and staging/private-marker scan PASS.');
    }
  } catch (error) {
    fail(error.message);
  }
}

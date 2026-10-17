import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { chromium, request as playwrightRequest } from '@playwright/test';
import pg from 'pg';

const { Client } = pg;
const projectRef = 'admyuepbbtstayaydjmo';
const stagingUrl = new URL(process.env.STAGING_URL ?? 'https://adaptive-lifting-staging.gartman-bekaali.workers.dev');
const manifestPath = '.staging-e2e-fixture.json';
const reportPath = 'staging-authenticated-e2e-report.json';
const isCleanupOnly = process.argv.includes('--cleanup-only');
const checks = {};
let db;
let browser;
let request;
let manifest;
let scenarioError;
let cleanupError;

function requireStagingTarget() {
  assert.equal(stagingUrl.protocol, 'https:', 'staging Worker must use HTTPS');
  assert.equal(stagingUrl.origin, 'https://adaptive-lifting-staging.gartman-bekaali.workers.dev', 'only the confirmed staging Worker is allowed');
  assert.equal(process.env.STAGING_PROJECT_REF, projectRef, 'STAGING_PROJECT_REF must match the confirmed staging project');
  const raw = process.env.STAGING_E2E_DATABASE_URL;
  assert.ok(raw, 'Missing required GitHub secret STAGING_E2E_DATABASE_URL');
  const databaseUrl = new URL(raw);
  const safeIdentity = decodeURIComponent(databaseUrl.username).includes(projectRef) ||
    databaseUrl.hostname === `db.${projectRef}.supabase.co`;
  assert.ok(safeIdentity, 'Staging database URL identity does not identify the confirmed staging project');
  assert.ok(databaseUrl.hostname.endsWith('.supabase.co'), 'Database host is not a Supabase host');
  return raw;
}

async function connectDb() {
  if (db) return db;
  const connectionString = requireStagingTarget();
  db = new Client({ connectionString, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000, application_name: 'adaptive-lifting-staging-e2e' });
  await db.connect();
  const identity = await db.query('select current_database() as database, current_user as role');
  assert.equal(identity.rows.length, 1);
  return db;
}

function fixtureEmail(role) {
  return `${manifest.namespace}-${role}@example.invalid`;
}

async function cleanOwnedRows() {
  if (!manifest) return;
  assert.match(manifest.namespace ?? '', /^al-staging-e2e-[0-9]+-[0-9]+-[a-f0-9]{8}$/, 'Refusing cleanup for an unrecognized fixture namespace');
  const client = await connectDb();
  const found = await client.query('select id from public.users where email like $1', [`${manifest.namespace}-%@example.invalid`]);
  const ids = [...new Set([...(manifest.userIds ?? []), ...found.rows.map((row) => row.id)])];
  if (!ids.length) return;
  await client.query('begin');
  try {
    await client.query(`
      delete from public.integration_outbox o using public.email_verification_tokens t
      where o.verification_token_id = t.id and t.user_id = any($1::text[])
    `, [ids]);
    await client.query('delete from public.email_verification_tokens where user_id = any($1::text[])', [ids]);
    await client.query('delete from public.coaching_history_snapshots s using public.coaching_relationships r where s.relationship_id = r.id and (r.coach_id = any($1::text[]) or r.athlete_id = any($1::text[]))', [ids]);
    await client.query('delete from public.coaching_relationships where coach_id = any($1::text[]) or athlete_id = any($1::text[])', [ids]);
    await client.query('delete from public.invite_codes where coach_id = any($1::text[])', [ids]);
    await client.query('delete from public.workout_locks l using public.workouts w where l.workout_id = w.id and w.owner_id = any($1::text[])', [ids]);
    await client.query('delete from public.domain_events e using public.workouts w where e.workout_id = w.id and w.owner_id = any($1::text[])', [ids]);
    await client.query('delete from public.exercise_sets s using public.exercises e join public.workouts w on w.id=e.workout_id where s.exercise_id=e.id and w.owner_id=any($1::text[])', [ids]);
    await client.query('delete from public.exercises e using public.workouts w where e.workout_id=w.id and w.owner_id=any($1::text[])', [ids]);
    await client.query('delete from public.accessories a using public.workouts w where a.workout_id=w.id and w.owner_id=any($1::text[])', [ids]);
    await client.query('delete from public.workouts where owner_id = any($1::text[])', [ids]);
    await client.query('delete from public.day_notes where owner_id = any($1::text[])', [ids]);
    await client.query('delete from public.microcycles where owner_id = any($1::text[])', [ids]);
    await client.query('delete from public.mesocycles where owner_id = any($1::text[])', [ids]);
    await client.query('delete from public.audit_events where actor_user_id = any($1::text[])', [ids]);
    await client.query('delete from public.sync_mutations m using public.client_devices d where m.client_device_id=d.id and d.user_id=any($1::text[])', [ids]);
    await client.query('delete from public.client_devices where user_id = any($1::text[])', [ids]);
    await client.query('delete from public.sessions where user_id = any($1::text[])', [ids]);
    await client.query('delete from public.users where id = any($1::text[]) and email like $2', [ids, `${manifest.namespace}-%@example.invalid`]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function independentlyVerifyCleanup() {
  if (!manifest) return { status: 'NOT NEEDED', reason: 'No fixture manifest was created' };
  const client = await connectDb();
  const query = await client.query(`
    select
      (select count(*)::int from public.users where email like $1) as users,
      (select count(*)::int from public.sessions where user_id = any($2::text[])) as app_sessions,
      (select count(*)::int from public.workouts where owner_id = any($2::text[])) as workouts,
      (select count(*)::int from public.exercises e join public.workouts w on w.id=e.workout_id where w.owner_id=any($2::text[])) as exercises,
      (select count(*)::int from public.exercise_sets s join public.exercises e on e.id=s.exercise_id join public.workouts w on w.id=e.workout_id where w.owner_id=any($2::text[])) as sets,
      (select count(*)::int from public.coaching_relationships where coach_id = any($2::text[]) or athlete_id = any($2::text[])) as relationships,
      (select count(*)::int from public.email_verification_tokens where user_id = any($2::text[])) as verification_tokens,
      (select count(*)::int from public.integration_outbox where provider='email-verification' and verification_token_id in (select id from public.email_verification_tokens where user_id=any($2::text[]))) as outbox_jobs,
      (select count(*)::int from public.invite_codes where coach_id = any($2::text[])) as coach_codes,
      (select count(*)::int from public.client_devices where user_id = any($2::text[])) as client_devices,
      (select count(*)::int from public.day_notes where owner_id = any($2::text[])) as day_notes,
      (select count(*)::int from public.integration_connections where user_id = any($2::text[])) as integration_connections,
      (select count(*)::int from public.users where email like $1) as synthetic_users
  `, [`${manifest.namespace}-%@example.invalid`, manifest.userIds ?? []]);
  const counts = query.rows[0];
  const empty = Object.values(counts).every((count) => Number(count) === 0);
  assert.ok(empty, 'Synthetic fixture cleanup did not remove all independently queried records');
  return { status: 'PASS', counts };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { redirect: 'manual', ...options });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function registerFixture(role) {
  const email = fixtureEmail(role);
  const password = `Staging-${randomBytes(20).toString('base64url')}-9!`;
  const result = await request.post('/api/auth/register', {
    headers: { origin: stagingUrl.origin },
    data: { email, password },
  });
  assert.equal(result.status(), 200, `staging registration failed (${result.status()}); response body omitted`);
  const found = await db.query('select id from public.users where email=$1', [email]);
  assert.equal(found.rows.length, 1, 'registered synthetic user was not found in staging');
  const userId = found.rows[0].id;
  manifest.userIds.push(userId);
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await db.query('begin');
  try {
    if (role === 'coach') await db.query("update public.users set role='COACH' where id=$1", [userId]);
    const tokenRows = await db.query('select id from public.email_verification_tokens where user_id=$1 and consumed_at is null and invalidated_at is null order by created_at desc limit 1', [userId]);
    assert.equal(tokenRows.rows.length, 1, 'staging registration did not create one active verification token');
    const tokenId = tokenRows.rows[0].id;
    await db.query('update public.email_verification_tokens set token_hash=$1 where id=$2 and user_id=$3', [hash, tokenId, userId]);
    await db.query("update public.integration_outbox set status='cancelled', encrypted_payload=null, retry_after=null, claim_token=null where verification_token_id=$1", [tokenId]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  return { email, password, userId, token };
}

async function signIn(page, account) {
  await page.goto('/');
  await page.getByPlaceholder('coach@example.com').fill(account.email);
  await page.getByPlaceholder('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByTestId('nav-sessions').waitFor({ state: 'visible', timeout: 15000 });
}

async function appRequest(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: { cacheControl: response.headers.get('cache-control') }, body: await response.json().catch(() => null) };
  }, { method, path, body });
}

async function verifyFixture(page, account) {
  await page.goto(`/verify-email#token=${account.token}`);
  assert.equal((await page.context().cookies()).some((cookie) => cookie.name === 'session_id'), false, 'verification must not sign the user in');
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await page.getByRole('heading', { name: 'Email verified' }).waitFor({ state: 'visible' });
  const verifyAgain = await request.post('/api/auth/verify-email', { headers: { origin: stagingUrl.origin }, data: { token: account.token } });
  assert.equal(verifyAgain.status(), 400, 'single-use verification token must reject replay');
}

async function runScenario() {
  const health = await fetchJson(new URL('/api/health', stagingUrl), { cache: 'no-store' });
  assert.equal(health.response.status, 200, 'staging API health failed');
  assert.equal(health.response.headers.get('sb-project-ref'), projectRef, 'staging Worker reached an unexpected Supabase project');
  checks.stagingTarget = 'PASS';
  assert.equal(process.env.STAGING_PROJECT_REF, projectRef);
  await connectDb();
  checks.stagingDatabaseIdentity = 'PASS';

  request = await playwrightRequest.newContext({ baseURL: stagingUrl.origin, extraHTTPHeaders: { accept: 'application/json' } });
  const suffix = `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${randomUUID().slice(0, 8)}`;
  manifest = { namespace: `al-staging-e2e-${suffix}`, userIds: [] };
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const collision = await db.query('select count(*)::int as count from public.users where email like $1', [`${manifest.namespace}-%@example.invalid`]);
  assert.equal(collision.rows[0].count, 0, 'unique synthetic fixture namespace collision');

  browser = await chromium.launch({ headless: true });
  const athleteContext = await browser.newContext({ baseURL: stagingUrl.origin, viewport: { width: 1440, height: 900 } });
  const athletePage = await athleteContext.newPage();
  const athlete = await registerFixture('athlete');
  const coach = await registerFixture('coach');
  await verifyFixture(athletePage, athlete);
  await verifyFixture(athletePage, coach);
  checks.registrationAndVerification = 'PASS';

  await signIn(athletePage, athlete);
  const cookies = await athleteContext.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === 'session_id');
  assert.ok(sessionCookie?.httpOnly, 'session cookie must be HttpOnly');
  assert.ok(sessionCookie?.secure, 'staging session cookie must be Secure');
  assert.equal(sessionCookie?.sameSite, 'Lax');
  checks.secureCookie = 'PASS';
  let me = await appRequest(athletePage, 'GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, athlete.email);
  assert.match(me.headers.cacheControl ?? '', /private,\s*no-store/i);
  await athletePage.reload();
  await athletePage.getByTestId('nav-sessions').waitFor({ state: 'visible' });
  assert.equal((await appRequest(athletePage, 'GET', '/api/auth/me')).status, 200);
  checks.loginRefreshPersistence = 'PASS';

  const created = await appRequest(athletePage, 'POST', '/api/sessions', {
    date: new Date().toISOString().slice(0, 10), title: 'Autonomous staging session', dayLabel: 'E2E',
  });
  assert.equal(created.status, 200, `authenticated staging session create failed (${created.status})`);
  const sessionId = created.body.id;
  assert.ok(sessionId, 'staging session response omitted id');
  manifest.sessionIds = [sessionId];
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  await athletePage.goto('/#/sessions');
  await athletePage.getByTestId(`sessions-card-${sessionId}`).waitFor({ state: 'visible' });
  await athleteContext.setOffline(true);
  await athletePage.getByTestId(`sessions-actions-${sessionId}`).click();
  await athletePage.getByTestId(`sessions-edit-${sessionId}`).click();
  await athletePage.getByTestId('session-title').fill('Autonomous staging session edited offline');
  await athletePage.getByTestId('edit-session-save').click();
  await athletePage.getByText('Autonomous staging session edited offline').waitFor({ state: 'visible' });
  await athleteContext.setOffline(false);
  const syncDeadline = Date.now() + 45000;
  let syncedTitle = false;
  while (Date.now() < syncDeadline) {
    const synced = await db.query('select title from public.workouts where id=$1 and owner_id=$2', [sessionId, athlete.userId]);
    if (synced.rows[0]?.title === 'Autonomous staging session edited offline') { syncedTitle = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(syncedTitle, 'offline session edit did not synchronize to staging PostgreSQL');
  checks.sessionCreateEditAndOfflineSync = 'PASS';

  const unauthorized = await request.get('/api/auth/me');
  assert.equal(unauthorized.status(), 401, 'unauthenticated protected API must reject');
  const csrf = await athleteContext.request.post('/api/sessions', {
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    data: { date: new Date().toISOString().slice(0, 10), title: 'forbidden' },
  });
  assert.equal(csrf.status(), 403, 'cross-origin cookie mutation must be denied');
  checks.authzAndCsrf = 'PASS';

  const addExercise = await appRequest(athletePage, 'POST', `/api/sessions/${encodeURIComponent(sessionId)}/exercises`, {
    title: 'Squat', variation: 'Competition', tier: 'Comp', liftCategory: 'Squat', movementPattern: 'Knee Dominant',
    plannedWeight: 100, plannedReps: 5, plannedRpe: 7,
  });
  assert.equal(addExercise.status, 200, `authenticated exercise create failed (${addExercise.status})`);
  const exerciseId = addExercise.body.id;
  assert.ok(exerciseId);
  const set = addExercise.body.sets?.[0];
  assert.ok(set?.id, 'new staging exercise did not include a set');
  const changedExercise = await appRequest(athletePage, 'PATCH', `/api/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}`, { title: 'Paused squat' });
  assert.equal(changedExercise.status, 200, 'authenticated exercise edit failed');
  const logged = await appRequest(athletePage, 'POST', '/api/sets/log', {
    workoutId: sessionId, exerciseId, setId: set.id, weight: 100, reps: 5, rpe: 8, expected_revision: 1,
  });
  assert.ok([200, 409].includes(logged.status), `authenticated set logging returned ${logged.status}`);
  assert.equal(logged.status, 200, 'canonical set logging did not persist');
  const persistedMetrics = await db.query(`
    select es.actual, es.reps, es."executedRpe" as rpe, w.tonnage
      from public.exercise_sets es
      join public.exercises e on e.id=es.exercise_id
      join public.workouts w on w.id=e.workout_id
     where es.id=$1 and e.id=$2 and w.id=$3
  `, [set.id, exerciseId, sessionId]);
  assert.equal(persistedMetrics.rows.length, 1);
  assert.equal(Number(persistedMetrics.rows[0].actual), 100);
  assert.equal(Number(persistedMetrics.rows[0].reps), 5);
  assert.equal(Number(persistedMetrics.rows[0].rpe), 8);
  assert.ok(Number(persistedMetrics.rows[0].tonnage) >= 500, 'backend did not compute workout tonnage');
  const deletedExercise = await appRequest(athletePage, 'DELETE', `/api/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}`);
  assert.equal(deletedExercise.status, 200, 'authenticated exercise deletion failed');
  checks.exercisesSetRpeAndTonnage = 'PASS';

  const realtime = await appRequest(athletePage, 'POST', '/api/realtime/token', { workout_id: sessionId });
  checks.privateRealtime = realtime.status === 200 ? 'PASS (workout-scoped token issued; transport subscription not exercised)' : realtime.status === 503 ? 'NOT TESTED (private Realtime disabled)' : 'FAIL';
  assert.ok([200, 503].includes(realtime.status), 'Realtime endpoint failed outside configured/disabled states');

  const telegram = await appRequest(athletePage, 'GET', '/api/integrations/telegram/status');
  const sheets = await appRequest(athletePage, 'GET', '/api/integrations/google-sheets/status');
  assert.ok([200, 503].includes(telegram.status));
  assert.ok([200, 503].includes(sheets.status));
  if (telegram.status === 200) assert.match(String(telegram.body.status).toLowerCase(), /not.?connected|disconnected|none/);
  if (sheets.status === 200) assert.match(JSON.stringify(sheets.body).toLowerCase(), /not.?connected|disconnected|none/);
  const sheetsAuth = await appRequest(athletePage, 'GET', '/api/integrations/google-sheets/auth-url');
  if (sheetsAuth.status === 200) checks.integrationsFailClosed = 'NOT TESTED (staging Google OAuth is enabled; no provider login was started)';
  else {
    assert.ok([403, 503].includes(sheetsAuth.status), 'disabled Sheets authorization must deny or report unavailable');
    checks.integrationsFailClosed = 'PASS';
  }

  await athletePage.goto('/');
  await athletePage.evaluate(() => navigator.serviceWorker.ready);
  await athleteContext.setOffline(true);
  await athletePage.reload();
  await athletePage.getByTestId('nav-sessions').waitFor({ state: 'visible', timeout: 15000 });
  const offline = await athletePage.evaluate(() => ({ online: navigator.onLine, serviceWorker: Boolean(navigator.serviceWorker.controller) }));
  assert.equal(offline.online, false);
  assert.ok(offline.serviceWorker, 'PWA offline page is not controlled by the service worker');
  await athleteContext.setOffline(false);
  checks.pwaOffline = 'PASS';

  await athletePage.getByRole('button', { name: 'Sign out' }).click();
  await athletePage.getByTestId('login-card').waitFor({ state: 'visible' });
  assert.equal((await athleteContext.cookies()).some((cookie) => cookie.name === 'session_id'), false);
  assert.equal((await athleteContext.request.get('/api/auth/me')).status(), 401);
  checks.logoutRevocation = 'PASS';

  const coachContext = await browser.newContext({ baseURL: stagingUrl.origin, viewport: { width: 1440, height: 900 } });
  const coachPage = await coachContext.newPage();
  await signIn(coachPage, coach);
  const beforeLink = await appRequest(coachPage, 'PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, { title: 'unauthorized coach edit' });
  assert.equal(beforeLink.status, 403, 'unlinked coach must not edit athlete plan');
  await coachPage.getByTestId('nav-security').click();
  await coachPage.getByTestId('coach-code-generate').click();
  const code = (await coachPage.getByTestId('coach-code-value').innerText()).trim();
  assert.ok(code.length >= 6);
  await athletePage.goto('/');
  await signIn(athletePage, athlete);
  await athletePage.getByTestId('nav-security').click();
  await athletePage.getByTestId('athlete-link-input').fill(code);
  await athletePage.getByTestId('athlete-link-submit').click();
  await athletePage.getByTestId('athlete-link-success').waitFor({ state: 'visible' });
  await coachPage.reload();
  await coachPage.getByTestId('athlete-scope-selector').waitFor({ state: 'visible' });
  checks.coachLinkAndBoundary = 'PASS';
  await coachContext.close();
  await athleteContext.close();
}

try {
  if (isCleanupOnly) {
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!manifest) {
      console.log('CLEANUP: no fixture manifest; no synthetic accounts were provisioned');
    } else {
      await cleanOwnedRows();
      const result = await independentlyVerifyCleanup();
      await rm(manifestPath, { force: true });
      console.log(`CLEANUP ${result.status}: ${JSON.stringify(result.counts ?? {})}`);
    }
  } else {
    requireStagingTarget();
    await runScenario();
  }
} catch (error) {
  scenarioError = error;
} finally {
  await request?.dispose().catch(() => {});
  await browser?.close().catch(() => {});
  if (!isCleanupOnly && manifest) {
    try {
      await cleanOwnedRows();
      checks.syntheticCleanup = (await independentlyVerifyCleanup()).status;
    } catch (error) {
      cleanupError = error;
      checks.syntheticCleanup = 'FAIL';
    }
  }
  await db?.end().catch(() => {});
}

if (!isCleanupOnly) {
  checks.syntheticCleanup ??= manifest ? 'NOT VERIFIED' : 'NOT NEEDED';
  const status = cleanupError ? 'FAIL'
    : scenarioError && /Missing required GitHub secret STAGING_E2E_DATABASE_URL/.test(scenarioError.message) ? 'BLOCKED'
    : scenarioError ? 'FAIL' : 'PASS';
  const report = {
    target: { worker: stagingUrl.origin, projectRef },
    checks,
    ...(cleanupError && manifest ? { cleanupRemediation: { namespace: manifest.namespace, userIds: manifest.userIds ?? [] } } : {}),
    status,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (scenarioError) {
  console.error(`Authenticated staging E2E failed: ${scenarioError.message}`);
  process.exitCode = 1;
}
if (cleanupError) {
  console.error(`Synthetic staging cleanup failed; manifest retained for safe remediation: ${cleanupError.message}`);
  process.exitCode = 1;
}

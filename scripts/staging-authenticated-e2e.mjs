import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, randomUUID, verify as cryptoVerify } from 'node:crypto';
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
  const username = decodeURIComponent(databaseUrl.username);
  const directStaging = databaseUrl.hostname === `db.${projectRef}.supabase.co`;
  // Supabase's Seoul session pooler uses .supabase.com, not .supabase.co.
  // The pooler username's project suffix identifies which project is targeted.
  const stagingSessionPooler =
    /^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(databaseUrl.hostname) &&
    databaseUrl.port === '5432' && username.endsWith(`.${projectRef}`);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'Staging connection must use PostgreSQL');
  assert.ok(directStaging || stagingSessionPooler, 'Database URL must target the exact staging project directly or through its Seoul session pooler');
  assert.equal(databaseUrl.pathname, '/postgres', 'Staging E2E must target the postgres database');
  assert.ok(databaseUrl.password, 'Staging database URL must contain a password');
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
    const workspaceResult = await client.query('select id from public.workspaces where owner_user_id=any($1::text[])', [ids]);
    const workspaceIds = workspaceResult.rows.map(row => row.id);
    const grantResult = await client.query('select id from public.access_grants where workspace_id=any($1::text[])', [workspaceIds]);
    const grantIds = grantResult.rows.map(row => row.id);
    await client.query("delete from public.audit_events where (resource_type='Workspace' and resource_id=any($1::text[])) or (resource_type='AccessGrant' and resource_id=any($2::text[])) or (resource_type='User' and resource_id=any($3::text[]))", [workspaceIds,grantIds,ids]);
    await client.query('delete from public.integration_outbox where connection_id in (select id from public.integration_connections where user_id=any($1::text[]))', [ids]);
    await client.query('delete from public.integration_connections where user_id=any($1::text[])', [ids]);
    await client.query('delete from public.oauth_states where user_id=any($1::text[])', [ids]);
    await client.query('delete from public.insight_cards where owner_user_id=any($1::text[])', [ids]);
    await client.query('delete from public.sheet_publications where coach_id=any($1::text[])', [ids]);
    await client.query('delete from public.vouchers where assigned_user_id=any($1::text[]) or redeemed_by_user_id=any($1::text[]) or created_by_user_id=any($1::text[])', [ids]);
    await client.query('delete from public.access_grants where workspace_id=any($1::text[])', [workspaceIds]);
    await client.query('delete from public.billing_checkout_reservations where workspace_id=any($1::text[])', [workspaceIds]);
    await client.query('delete from public.subscriptions where workspace_id=any($1::text[])', [workspaceIds]);
    await client.query('delete from public.billing_customers where workspace_id=any($1::text[])', [workspaceIds]);
    await client.query('delete from public.workspace_members where workspace_id=any($1::text[]) or user_id=any($2::text[])', [workspaceIds,ids]);
    await client.query('delete from public.workspaces where id=any($1::text[]) and owner_user_id=any($2::text[])', [workspaceIds,ids]);
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
      (select count(*)::int from public.workspaces where owner_user_id=any($2::text[])) as workspaces,
      (select count(*)::int from public.workspace_members where user_id=any($2::text[])) as workspace_members,
      (select count(*)::int from public.access_grants where workspace_id in (select id from public.workspaces where owner_user_id=any($2::text[]))) as coach_access_grants,
      (select count(*)::int from public.insight_cards where owner_user_id=any($2::text[])) as insight_cards,
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

async function provisionFixture(role) {
  // Staging-only SQL fixture. Registration deliberately returns the same HTTP
  // 200 for new, duplicate and rate-limited requests; it cannot reliably seed E2E.
  // This path runs only with the verified staging DB URL, never in the app API.
  const email = fixtureEmail(role);
  const password = `Staging-${randomBytes(20).toString('base64url')}-9!`;
  const userId = randomUUID();
  const tokenId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const existing = await db.query('select id from public.users where email=$1', [email]);
  assert.equal(existing.rows.length, 0, 'synthetic fixture email already exists');
  // Persist the allocated identity *before* any DB write so the cleanup-only
  // job can find it after a partial failure or runner interruption.
  manifest.userIds.push(userId);
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  await db.query('begin');
  try {
    await db.query(`
      insert into public.users
        (id,email,hashed_password,role,email_verification_required,
         email_verification_legacy_exempt,email_verified_at)
      values ($1,$2,extensions.crypt($3,extensions.gen_salt('bf',12)),$4,true,false,null)
    `, [userId, email, password, role === 'coach' ? 'COACH' : 'ATHLETE']);
    await db.query(`
      insert into public.email_verification_tokens
        (id,user_id,token_hash,created_at,expires_at,is_resend,consumed_at,invalidated_at)
      values ($1,$2,$3,timezone('utc',clock_timestamp()),
              timezone('utc',clock_timestamp()) + interval '24 hours',false,null,null)
    `, [tokenId,userId,hash]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  if (role === 'coach') {
    // Standard staging operator grant, expiring after one day; no auth bypass.
    const granted = await db.query("select al_private.al_operator_grant_coach_access($1::text,'coach_beta',1,false,$2::text) as result",
      [email, `Disposable staging E2E: ${manifest.namespace}`]);
    assert.equal(granted.rows[0]?.result?.userId, userId, 'fixture coach grant targets unexpected account');
    assert.equal(granted.rows[0]?.result?.planKey, 'coach_beta', 'fixture coach entitlement is not active');
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
  const athlete = await provisionFixture('athlete');
  const coach = await provisionFixture('coach');
  await verifyFixture(athletePage, athlete);
  // Verification tokens are captured only during full document load. A second
  // fragment navigation on the same /verify-email page does not re-run index.html.
  const coachVerificationPage = await athleteContext.newPage();
  try {
    await verifyFixture(coachVerificationPage, coach);
  } finally {
    await coachVerificationPage.close();
  }
  checks.registration = 'NOT TESTED (generic public registration is separately rate-limited; synthetic accounts seeded through staging-only PostgreSQL)';
  checks.syntheticProvisioningAndVerification = 'PASS';

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
  // Sanitized diagnostics for deployed backend issuance and browser persistence.
  // Do not report the JWT value or locally cached signed grant.
  const grantState = await athletePage.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    const issued = typeof payload?.offlineGrant === 'string' && payload.offlineGrant.split('.').length === 3;
    const stored = await new Promise(resolve => {
      const open = indexedDB.open('adaptive_lifting_db');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('snapshots')) { db.close(); resolve(null); return; }
        const req = db.transaction('snapshots','readonly').objectStore('snapshots').get('auth:offline-grant');
        req.onsuccess = () => { const value = req.result?.data ?? null; db.close(); resolve(value); };
        req.onerror = () => { db.close(); resolve(null); };
      };
    });
    const claims = token => {
      if (typeof token !== 'string') return null;
      try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
      catch { return null; }
    };
    const saved = claims(stored), fresh = claims(payload?.offlineGrant);
    return { issued, persisted: typeof stored === 'string' && stored.split('.').length === 3,
      matchesIssued: issued && saved?.sub === fresh?.sub && saved?.sid === fresh?.sid &&
        saved?.user?.id === fresh?.user?.id && saved?.sub === payload?.user?.id };
  });
  checks.offlineGrantIssued = grantState.issued ? 'PASS' : 'FAIL (backend did not issue offline grant)';
  checks.offlineGrantPersisted = grantState.persisted ? 'PASS' : 'FAIL (signed grant absent from IndexedDB)';
  checks.offlineGrantMatchesIssued = grantState.matchesIssued ? 'PASS' : 'FAIL (stored grant missing or differs from issued grant)';
  // Read the staging Vault signing PEM only inside the trusted Actions runner;
  // derive the *public* SPKI key in memory. Neither the PEM, JWT, nor public
  // key bytes are printed or written to reports. The exact staging DB target
  // guard has already run above. No production database is accessed.
  const keyRows = await db.query('select al_private.get_offline_auth_private_key() as private_key');
  const privatePem = keyRows.rows[0]?.private_key ?? '';
  if (!privatePem) {
    checks.offlineVaultSignature = 'NOT TESTED (staging Vault private key unavailable)';
    checks.offlineDeployedPublicKey = 'NOT TESTED (staging Vault private key unavailable)';
  } else {
    const publicPem = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });
    const token = await athletePage.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
      const body = await r.json().catch(() => null);
      return typeof body?.offlineGrant === 'string' ? body.offlineGrant : null;
    });
    if (!token) {
      checks.offlineVaultSignature = 'NOT TESTED (backend did not return a signed grant)';
      checks.offlineDeployedPublicKey = 'NOT TESTED (backend did not return a signed grant)';
    } else {
      const segments = token.split('.');
      const validSignature = segments.length === 3 && cryptoVerify(
        'sha256', Buffer.from(`${segments[0]}.${segments[1]}`),
        { key: publicPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(segments[2], 'base64url'));
      checks.offlineVaultSignature = validSignature ? 'PASS' : 'FAIL (issued grant does not verify against staging Vault public key)';
      const publicLines = publicPem.split(/\r?\n/).filter(line => line && !line.startsWith('-----'));
      const publicBase64 = publicLines.join('');
      const deployedContainsKey = await athletePage.evaluate(async ({ lines, joined }) => {
        const scripts = [...document.querySelectorAll('script[src]')].map(el => el.src)
          .filter(src => new URL(src).origin === location.origin);
        const sourceTexts = await Promise.all(scripts.map(async src => {
          try { const r = await fetch(src); return r.ok ? await r.text() : ''; }
          catch { return ''; }
        }));
        return sourceTexts.some(text => text.includes(joined) || lines.every(line => text.includes(line)));
      }, { lines: publicLines, joined: publicBase64 });
      checks.offlineDeployedPublicKey = deployedContainsKey
        ? 'PASS' : 'FAIL (deployed frontend bundle does not contain the public key corresponding to staging Vault)';
    }
  }

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
  // The test creates this workout directly via API; unlike the app's own
  // creation dialog, that does not invoke reloadMicrocycles in React state.
  await athletePage.goto('/#/sessions');
  await athletePage.reload({ waitUntil: 'networkidle' });
  try {
    await athletePage.getByTestId(`sessions-card-${sessionId}`).waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    const cards = await athletePage.locator('[data-testid^="sessions-card-"]').count();
    const plan = await appRequest(athletePage, 'GET', '/api/microcycles');
    throw new Error(`Created staging session absent from refreshed UI (renderedCards=${cards}, planStatus=${plan.status})`);
  }
  await athleteContext.setOffline(true);
  await athletePage.getByTestId(`sessions-actions-${sessionId}`).click();
  await athletePage.getByTestId(`sessions-edit-${sessionId}`).click();
  const editedTitle = 'Autonomous staging session edited online';
  await athletePage.getByTestId('session-title').fill(editedTitle);
  await athletePage.getByTestId('edit-session-save').click();
  // Session title editing is a direct PATCH, not an offline-queued mutation.
  await athletePage.getByTestId('edit-session-error').waitFor({ state: 'visible', timeout: 15000 });
  const unchanged = await db.query('select title from public.workouts where id=$1 and owner_id=$2', [sessionId, athlete.userId]);
  assert.equal(unchanged.rows[0]?.title, 'Autonomous staging session', 'Offline session edit changed server state unexpectedly');
  checks.offlineSessionEditFailClosed = 'PASS';
  checks.offlineSessionEditSync = 'NOT TESTED (current client does not queue session-title PATCH requests)';
  await athleteContext.setOffline(false);
  await athletePage.getByTestId('edit-session-save').click();
  await athletePage.getByTestId('edit-session-dialog').waitFor({ state: 'hidden', timeout: 15000 });
  await athletePage.getByText(editedTitle).waitFor({ state: 'visible', timeout: 15000 });
  const persistedTitle = await db.query('select title from public.workouts where id=$1 and owner_id=$2', [sessionId, athlete.userId]);
  assert.equal(persistedTitle.rows[0]?.title, editedTitle, 'Online session edit did not persist in staging PostgreSQL');
  checks.sessionCreateAndOnlineEdit = 'PASS';

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
  const offline = await athletePage.evaluate(() => ({
    online: navigator.onLine,
    serviceWorker: Boolean(navigator.serviceWorker.controller),
  }));
  assert.equal(offline.online, false);
  assert.ok(offline.serviceWorker, 'PWA offline page is not controlled by the service worker');
  const offlineAuthenticatedUi = await athletePage.getByTestId('nav-sessions').waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true, () => false);
  checks.pwaOfflineShell = 'PASS';
  checks.offlineAuthenticatedRestore = offlineAuthenticatedUi
    ? 'PASS'
    : 'FAIL (authenticated application did not restore after offline PWA reload)';
  await athleteContext.setOffline(false);
  await athletePage.reload();
  await athletePage.getByTestId('nav-sessions').waitFor({ state: 'visible', timeout: 15000 });

  await athletePage.getByRole('button', { name: 'Sign out' }).click();
  await athletePage.getByTestId('login-card').waitFor({ state: 'visible' });
  // The frontend deliberately does not await the logout HTTP request before
  // clearing the UI. Wait for the server response to expire the session cookie.
  const logoutDeadline = Date.now() + 15000;
  let fullyLoggedOut = false;
  while (Date.now() < logoutDeadline) {
    const cookiePresent = (await athleteContext.cookies()).some((cookie) => cookie.name === 'session_id');
    const meResponse = await athleteContext.request.get('/api/auth/me');
    if (!cookiePresent && meResponse.status() === 401) {
      fullyLoggedOut = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  assert.ok(fullyLoggedOut, 'Logout did not clear the cookie and revoke the session within 15 seconds');
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
  const hasFailedChecks = Object.values(checks).some((result) => String(result).startsWith('FAIL'));
  const status = cleanupError ? 'FAIL'
    : scenarioError && /Missing required GitHub secret STAGING_E2E_DATABASE_URL/.test(scenarioError.message) ? 'BLOCKED'
    : scenarioError || hasFailedChecks ? 'FAIL' : 'PASS';
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
} else if (!isCleanupOnly && Object.values(checks).some((result) => String(result).startsWith('FAIL'))) {
  console.error('Authenticated staging E2E completed with failing checks; see sanitized artifact.');
  process.exitCode = 1;
}
if (cleanupError) {
  console.error(`Synthetic staging cleanup failed; manifest retained for safe remediation: ${cleanupError.message}`);
  process.exitCode = 1;
}

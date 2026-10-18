import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import pg from 'pg';

const projectRef = 'admyuepbbtstayaydjmo';

function stagingDatabaseUrl() {
  assert.equal(process.env.STAGING_PROJECT_REF, projectRef, 'STAGING_PROJECT_REF must match the confirmed staging project');
  const raw = process.env.STAGING_E2E_DATABASE_URL;
  assert.ok(raw, 'Missing required GitHub secret STAGING_E2E_DATABASE_URL');
  const url = new URL(raw);
  const username = decodeURIComponent(url.username);
  const exactProject = url.hostname === `db.${projectRef}.supabase.co` ||
    (/^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(url.hostname) &&
      url.port === '5432' && username.endsWith(`.${projectRef}`));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Staging connection must use PostgreSQL');
  assert.ok(exactProject, 'Database URL must target the exact staging project');
  assert.equal(url.pathname, '/postgres', 'Staging connection must target the postgres database');
  assert.ok(url.password, 'Staging database URL must contain a password');
  return raw;
}

let client;
let privatePem = '';
try {
  assert.ok(process.env.GITHUB_OUTPUT, 'Public key derivation is restricted to a GitHub Actions output file');
  client = new pg.Client({
    connectionString: stagingDatabaseUrl(),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    application_name: 'adaptive-lifting-staging-offline-key-derive',
  });
  await client.connect();
  const identity = await client.query('select current_database() as database');
  assert.equal(identity.rows[0]?.database, 'postgres');
  const result = await client.query('select al_private.get_offline_auth_private_key() as private_key');
  privatePem = String(result.rows[0]?.private_key ?? '').trim();
  assert.ok(privatePem.includes('PRIVATE KEY'), 'Staging Vault signing key is unavailable');
  const publicKey = createPublicKey(privatePem);
  assert.equal(publicKey.asymmetricKeyType, 'ec', 'Offline signing key must be elliptic-curve');
  assert.equal(publicKey.asymmetricKeyDetails?.namedCurve, 'prime256v1', 'Offline signing key must use P-256');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyBase64 = Buffer.from(spkiDer).toString('base64');
  const fingerprint = createHash('sha256').update(spkiDer).digest('hex');
  await appendFile(process.env.GITHUB_OUTPUT, `public_key=${publicKeyBase64}\nkey_fingerprint=${fingerprint}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', source: 'staging Vault', curve: 'P-256', publicKeyFingerprint: fingerprint }));
} catch (error) {
  console.error(`Staging offline public key derivation failed: ${error?.message ?? 'unknown error'}`);
  process.exitCode = 1;
} finally {
  privatePem = '';
  await client?.end().catch(() => {});
}

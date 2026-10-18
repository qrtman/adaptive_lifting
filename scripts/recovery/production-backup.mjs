import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  PRODUCTION_SOURCE,
  assertHostedLinux,
  connectPinnedProductionSource,
  productionArchiveCapture,
  writePgDumpCaFile,
} from './production-source.mjs';
import { captureSnapshot } from './snapshot-capture.mjs';
import { encryptArchiveStream } from './encrypt-stream.mjs';
import { newObjectKey, storageTarget, uploadAndVerifyCiphertext } from './ciphertext-store.mjs';

const SCHEMAS = Object.freeze(['public', 'al_private', 'supabase_migrations']);
const TARGET_FIELDS = Object.freeze(['project', 'host', 'port', 'user', 'database', 'majorVersion']);
const ALLOWED_EVENTS = new Set(['schedule', 'workflow_dispatch']);
const MODULE_PATH = resolve(fileURLToPath(import.meta.url));

function sameTarget(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  return Object.keys(candidate).sort().join('\0') === [...TARGET_FIELDS].sort().join('\0') &&
    TARGET_FIELDS.every((field) => candidate[field] === PRODUCTION_SOURCE[field]);
}

function safeBranchName(branch) {
  return typeof branch === 'string' && branch.length > 0 && branch.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes('..') &&
    !branch.includes('//') && !branch.includes('/./') && !branch.includes('/../') &&
    !branch.includes('@{') && !branch.endsWith('/') && !branch.endsWith('.');
}

function allowedCallerGate(gate) {
  return gate !== null && typeof gate === 'object' && !Array.isArray(gate) &&
    Object.keys(gate).sort().join('\0') === ['allowed', 'event', 'ref'].sort().join('\0') &&
    gate.allowed === true && ALLOWED_EVENTS.has(gate.event) &&
    typeof gate.ref === 'string' && gate.ref.startsWith('refs/heads/') &&
    safeBranchName(gate.ref.slice('refs/heads/'.length));
}

export function deriveGitHubDefaultBranchGate({ env, eventPayload }) {
  if (!env || typeof env !== 'object' || !['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) return null;
  if (env.GITHUB_EVENT_NAME === 'schedule') {
    // GitHub documents GITHUB_REF for schedule as the branch/tag from which the
    // workflow runs; scheduled workflows run on the default branch. The schedule
    // webhook payload is not applicable and can be empty.
    const ref = env.GITHUB_REF;
    const gate = { allowed: true, event: 'schedule', ref };
    return allowedCallerGate(gate) ? gate : null;
  }
  const defaultBranch = eventPayload?.repository?.default_branch;
  if (!safeBranchName(defaultBranch)) return null;
  const gate = { allowed: true, event: 'workflow_dispatch', ref: `refs/heads/${defaultBranch}` };
  return env.GITHUB_REF === gate.ref && allowedCallerGate(gate) ? gate : null;
}

function validRecipient(recipient) {
  return typeof recipient === 'string' && /^age1[023456789acdefghjklmnpqrstuvwxyz]{20,100}$/.test(recipient);
}

function privateIdentityPresent(env) {
  return Object.keys(env).some((name) => /(?:^|_)AGE(?:_|$)/i.test(name) &&
    /(?:IDENTITY|SECRET|PRIVATE|KEY)/i.test(name));
}

function artifactHandle(value) {
  return value && typeof value.outputPath === 'string' && value.outputPath.endsWith('.age') &&
    typeof value.cleanup === 'function';
}

function validUploadResult(result, key) {
  return result && result.key === key && Number.isSafeInteger(result.size) && result.size >= 0 &&
    typeof result.sha256 === 'string' && /^[a-f0-9]{64}$/.test(result.sha256) && result.byteVerified === true;
}

/**
 * Capture and store a production snapshot through guarded, injectable adapters.
 * This is a library function: it has no CLI entrypoint and never restores data.
 * The caller supplies its GitHub event/ref evaluation. Scheduled and manually
 * dispatched runs on the default branch are the only permitted invocations.
 * expectedRelations and expectedVersions must come from the reviewed release,
 * independently of the live source being captured.
 */
export async function runProductionBackup({
  env = process.env,
  platform = process.platform,
  eventGate,
  sourceTarget = PRODUCTION_SOURCE,
  expectedRelations,
  expectedVersions,
  r2,
  recipient,
  now = new Date(),
  adapters = {},
} = {}) {
  let connection;
  let caFile;
  const ownedArtifacts = new Set();
  let primaryFailure = false;
  try {
    assertHostedLinux(env, platform);
    if (env.RECOVERY_BACKUP_ENABLED !== 'true' || !allowedCallerGate(eventGate)) {
      throw new Error('Explicit opt-in and allowed event/ref gate are required.');
    }
    if (!sameTarget(sourceTarget)) throw new Error('Production source target must match the pinned target.');
    if (!validRecipient(recipient) || privateIdentityPresent(env)) throw new Error('Recipient-only encryption configuration is required.');
    if (!Array.isArray(expectedRelations) || expectedRelations.length === 0 ||
        !Array.isArray(expectedVersions) || expectedVersions.length === 0) {
      throw new Error('Independent reviewed inventory and release versions are required.');
    }
    if (!r2 || typeof r2 !== 'object') throw new Error('A reviewed R2 destination is required.');
    const target = storageTarget(r2);
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('A valid object timestamp is required.');

    const connectSource = adapters.connectSource ?? connectPinnedProductionSource;
    const prepareCaFile = adapters.prepareCaFile ?? writePgDumpCaFile;
    const capture = adapters.captureSnapshot ?? captureSnapshot;
    const makeArchiveCapture = adapters.createArchiveCapture ?? productionArchiveCapture;
    const encrypt = adapters.encryptArchiveStream ?? encryptArchiveStream;
    const upload = adapters.uploadAndVerifyCiphertext ?? uploadAndVerifyCiphertext;
    const objectKey = adapters.newObjectKey ?? newObjectKey;
    for (const [name, fn] of Object.entries({ connectSource, prepareCaFile, capture, makeArchiveCapture, encrypt, upload, objectKey })) {
      if (typeof fn !== 'function') throw new Error(`Invalid ${name} adapter.`);
    }

    connection = await connectSource({ env, platform, expectedSource: PRODUCTION_SOURCE });
    if (!connection || typeof connection.query !== 'function' || typeof connection.close !== 'function' ||
        connection.identity?.database !== PRODUCTION_SOURCE.database ||
        !new RegExp(`^${PRODUCTION_SOURCE.majorVersion}\\d{4}$`).test(connection.identity?.version ?? '') ||
        connection.identity?.tls !== true) {
      throw new Error('Pinned production source identity validation failed.');
    }
    caFile = await prepareCaFile({ env, platform });
    if (!caFile || typeof caFile.path !== 'string' || typeof caFile.cleanup !== 'function') {
      throw new Error('Protected database CA preparation failed.');
    }

    const uploadEncrypted = async (encrypted, kind) => {
      if (!artifactHandle(encrypted)) throw new Error('Encryption adapter did not return a private age ciphertext artifact.');
      ownedArtifacts.add(encrypted);
      const key = objectKey(target.prefix, now);
      const stored = await upload({ ...r2, key, sourcePath: encrypted.outputPath, env, platform });
      if (!validUploadResult(stored, key)) throw new Error('Encrypted object upload/readback verification failed.');
      await encrypted.cleanup();
      ownedArtifacts.delete(encrypted);
      return Object.freeze({ kind, key, size: stored.size, sha256: stored.sha256, byteVerified: true });
    };

    const archiveCapture = makeArchiveCapture({ env, platform, caFile,
      encrypt: (stream) => encrypt(stream, recipient, { env, platform }) });
    if (typeof archiveCapture !== 'function') throw new Error('Archive capture adapter is invalid.');
    const encryptedArtifacts = [];
    const result = await capture({
      client: connection,
      schemas: [...SCHEMAS],
      expectedRelations,
      expectedVersions,
      env,
      platform,
      captureArchive: async (input) => {
        const encryptedArchive = await archiveCapture(input);
        if (!artifactHandle(encryptedArchive)) throw new Error('Archive encryption did not return a private age ciphertext artifact.');
        ownedArtifacts.add(encryptedArchive);
        encryptedArtifacts.push({ kind: 'archive', encrypted: encryptedArchive });
        return encryptedArchive;
      },
      persistManifest: async (manifest) => {
        const serialized = JSON.stringify(manifest);
        if (typeof serialized !== 'string') throw new Error('Snapshot manifest serialization failed.');
        const encryptedManifest = await encrypt(Readable.from([Buffer.from(serialized, 'utf8')]), recipient, { env, platform });
        if (!artifactHandle(encryptedManifest)) throw new Error('Manifest encryption did not return a private age ciphertext artifact.');
        ownedArtifacts.add(encryptedManifest);
        encryptedArtifacts.push({ kind: 'manifest', encrypted: encryptedManifest });
      },
    });
    if (result?.status !== 'captured-restore-unverified' || encryptedArtifacts.length !== 2 ||
        encryptedArtifacts[0].kind !== 'archive' || encryptedArtifacts[1].kind !== 'manifest') {
      throw new Error('Snapshot capture did not produce both encrypted artifacts.');
    }
    const artifacts = [];
    for (const { kind, encrypted } of encryptedArtifacts) artifacts.push(await uploadEncrypted(encrypted, kind));
    return Object.freeze({ status: 'captured-restore-unverified', source: PRODUCTION_SOURCE.project,
      artifacts: Object.freeze(artifacts) });
  } catch {
    primaryFailure = true;
    throw new Error('Production backup failed; protected diagnostics were suppressed.');
  } finally {
    let cleanupFailed = false;
    for (const artifact of ownedArtifacts) {
      try { await artifact.cleanup(); } catch { cleanupFailed = true; }
    }
    if (caFile) { try { await caFile.cleanup(); } catch { cleanupFailed = true; } }
    if (connection) { try { await connection.close(); } catch { cleanupFailed = true; } }
    if (cleanupFailed && !primaryFailure) throw new Error('Production backup completed or failed with protected cleanup errors.');
  }
}

export async function runProductionBackupCli({ env = process.env, platform = process.platform } = {}) {
  try {
    assertHostedLinux(env, platform);
    if (env.RECOVERY_BACKUP_ENABLED !== 'true') throw new Error('Explicit production backup opt-in is disabled.');
    if (typeof env.GITHUB_EVENT_PATH !== 'string' || !env.GITHUB_EVENT_PATH) {
      throw new Error('GitHub event payload is unavailable.');
    }
    let eventPayload;
    try { eventPayload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')); }
    catch { throw new Error('GitHub event payload could not be validated.'); }
    if (!deriveGitHubDefaultBranchGate({ env, eventPayload })) {
      throw new Error('GitHub event/ref does not identify an allowed default-branch run.');
    }
    if (!validRecipient(env.RECOVERY_AGE_RECIPIENT) || privateIdentityPresent(env)) {
      throw new Error('Recipient-only age encryption configuration is required.');
    }
    const r2 = {
      accountId: env.RECOVERY_R2_ACCOUNT_ID,
      bucket: env.RECOVERY_R2_BUCKET,
      prefix: env.RECOVERY_R2_PREFIX,
    };
    storageTarget(r2);
    if (typeof env.AWS_ACCESS_KEY_ID !== 'string' || !env.AWS_ACCESS_KEY_ID.trim() ||
        typeof env.AWS_SECRET_ACCESS_KEY !== 'string' || !env.AWS_SECRET_ACCESS_KEY.trim()) {
      throw new Error('Protected R2 credentials are unavailable.');
    }

    // The tracked repo contains synthetic fixtures and migration source files,
    // but no independently reviewed, complete production relation inventory
    // plus exact deployed migration release list. Deriving either from the live
    // source would compare the source to itself, so this CLI intentionally stops
    // before connection until a reviewed static inventory is added.
    throw new Error('Blocked: no independently reviewed production release inventory is available; no source connection was attempted.');
  } catch (error) {
    const message = typeof error?.message === 'string' && error.message.startsWith('Blocked:')
      ? error.message
      : 'Production backup CLI preflight failed; protected details were suppressed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  if (process.argv.slice(2).some((arg) => arg !== '--preflight')) {
    process.stderr.write('Production backup CLI arguments are invalid.\n');
    process.exitCode = 1;
  } else {
    await runProductionBackupCli();
  }
}

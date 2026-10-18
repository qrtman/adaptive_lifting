import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
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
export const PRODUCTION_RELEASE_INVENTORY_PATH = join(dirname(MODULE_PATH), 'production-release-inventory.json');
const INVENTORY_FORMAT = 'adaptive-production-release-v1';
const MAX_INVENTORY_RELATIONS = 100_000;
const MAX_INVENTORY_VERSIONS = 10_000;

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

const exactKeys = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');

/** Parse a committed, independently reviewed production release inventory. */
export function parseProductionReleaseInventory(input) {
  let inventory = input;
  if (typeof inventory === 'string' || Buffer.isBuffer(inventory)) {
    try { inventory = JSON.parse(inventory.toString()); }
    catch { throw new Error('Blocked: production release inventory JSON is invalid.'); }
  }
  if (!exactKeys(inventory, ['format', 'source', 'schemas', 'expectedRelations', 'expectedVersions']) ||
      inventory.format !== INVENTORY_FORMAT || !sameTarget(inventory.source) ||
      JSON.stringify(inventory.schemas) !== JSON.stringify(SCHEMAS)) {
    throw new Error('Blocked: production release inventory shape or pinned target is invalid.');
  }
  const { expectedRelations, expectedVersions } = inventory;
  if (!Array.isArray(expectedRelations) || expectedRelations.length === 0 ||
      expectedRelations.length > MAX_INVENTORY_RELATIONS ||
      !Array.isArray(expectedVersions) || expectedVersions.length === 0 ||
      expectedVersions.length > MAX_INVENTORY_VERSIONS) {
    throw new Error('Blocked: production release inventory is empty or exceeds supported bounds.');
  }
  const seenRelations = new Set();
  for (const relation of expectedRelations) {
    if (!exactKeys(relation, ['schema', 'name', 'kind', 'persistence', 'inherited']) ||
        !SCHEMAS.includes(relation.schema) || typeof relation.name !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(relation.name) || relation.kind !== 'r' ||
        relation.persistence !== 'p' || relation.inherited !== false) {
      throw new Error('Blocked: production release relation inventory is malformed or unsupported.');
    }
    const key = `${relation.schema}\0${relation.name}`;
    if (seenRelations.has(key)) throw new Error('Blocked: production release relation inventory contains duplicates.');
    seenRelations.add(key);
  }
  let previousVersion = '';
  for (const version of expectedVersions) {
    if (typeof version !== 'string' || !/^\d{14}$/.test(version) || version <= previousVersion) {
      throw new Error('Blocked: production release migration versions must be unique and sorted.');
    }
    previousVersion = version;
  }
  return Object.freeze({
    format: INVENTORY_FORMAT,
    source: PRODUCTION_SOURCE,
    schemas: SCHEMAS,
    expectedRelations: Object.freeze(expectedRelations.map((relation) => Object.freeze({ ...relation }))),
    expectedVersions: Object.freeze([...expectedVersions]),
  });
}

export function buildProductionBackupCliOptions({ env, platform, eventPayload, inventory }) {
  assertHostedLinux(env, platform);
  if (env.RECOVERY_BACKUP_ENABLED !== 'true') throw new Error('Production backup opt-in is disabled.');
  const eventGate = deriveGitHubDefaultBranchGate({ env, eventPayload });
  if (!eventGate) throw new Error('GitHub event/ref does not identify an allowed default-branch run.');
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
  const reviewed = parseProductionReleaseInventory(inventory);
  return Object.freeze({
    env,
    platform,
    eventGate,
    sourceTarget: PRODUCTION_SOURCE,
    expectedRelations: reviewed.expectedRelations,
    expectedVersions: reviewed.expectedVersions,
    r2: Object.freeze(r2),
    recipient: env.RECOVERY_AGE_RECIPIENT,
  });
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
    // Publish only after both encrypted capture objects have passed byte readback.
    // The receipt is encrypted through the same age-only immutable storage path.
    const receipt = Object.freeze({
      format: 'adaptive-recovery-receipt-v1',
      classification: 'capture-only-restore-unverified',
      capturedAt: now.toISOString(),
      provenance: Object.freeze({
        sourceProject: PRODUCTION_SOURCE.project,
        event: eventGate.event,
        ref: eventGate.ref,
      }),
      artifacts: Object.freeze(artifacts.map(({ kind, key, size, sha256 }) =>
        Object.freeze({ kind, key, size, sha256 }))),
    });
    const encryptedReceipt = await encrypt(
      Readable.from([Buffer.from(JSON.stringify(receipt), 'utf8')]), recipient, { env, platform });
    const verifiedReceipt = await uploadEncrypted(encryptedReceipt, 'receipt');
    artifacts.push(verifiedReceipt);
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

async function readGitHubEventPayload(env) {
  if (env.GITHUB_EVENT_NAME === 'schedule') return {};
  if (typeof env.GITHUB_EVENT_PATH !== 'string' || !env.GITHUB_EVENT_PATH) {
    throw new Error('GitHub event payload is unavailable.');
  }
  try { return JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')); }
  catch { throw new Error('GitHub event payload could not be validated.'); }
}

export async function loadProductionReleaseInventory() {
  let content;
  try { content = await readFile(PRODUCTION_RELEASE_INVENTORY_PATH, 'utf8'); }
  catch { throw new Error('Blocked: committed production release inventory is unavailable; no source connection was attempted.'); }
  try { return parseProductionReleaseInventory(content); }
  catch (error) {
    if (typeof error?.message === 'string' && error.message.startsWith('Blocked:')) throw error;
    throw new Error('Blocked: committed production release inventory is invalid; no source connection was attempted.');
  }
}

export async function runProductionBackupCli({
  env = process.env,
  platform = process.platform,
  preflightOnly = false,
  readEventPayload = readGitHubEventPayload,
  loadInventory = loadProductionReleaseInventory,
  backupRunner = runProductionBackup,
} = {}) {
  try {
    if (typeof loadInventory !== 'function' || typeof readEventPayload !== 'function' || typeof backupRunner !== 'function') {
      throw new Error('CLI adapters are invalid.');
    }
    const eventPayload = await readEventPayload(env);
    const inventory = await loadInventory();
    const options = buildProductionBackupCliOptions({ env, platform, eventPayload, inventory });
    if (preflightOnly) return Object.freeze({ ok: true, status: 'preflight-passed' });
    const result = await backupRunner(options);
    if (result?.status !== 'captured-restore-unverified' || !Array.isArray(result.artifacts) ||
        result.artifacts.length !== 3 ||
        result.artifacts.some((artifact, index) => artifact?.kind !== ['archive', 'manifest', 'receipt'][index] ||
          !validUploadResult(artifact, artifact?.key))) {
      throw new Error('Backup did not complete with verified object readbacks.');
    }
    const artifactKeys = result.artifacts.map(({ key }) => key);
    const expectedPrefix = `${options.r2.prefix}/`;
    if (new Set(artifactKeys).size !== artifactKeys.length || artifactKeys.some((key) =>
      !key.startsWith(expectedPrefix) || !key.endsWith('.age') ||
      /[\s\x00-\x1f\x7f\\]/.test(key) || key.split('/').some((part) => !part || part === '.' || part === '..'))) {
      throw new Error('Backup artifact keys are invalid or not unique.');
    }
    const receipts = result.artifacts.filter((artifact) => artifact?.kind === 'receipt' &&
      validUploadResult(artifact, artifact.key));
    if (receipts.length !== 1) throw new Error('Backup did not publish one verified recovery receipt.');
    return Object.freeze({ ok: true, status: 'captured-restore-unverified', receiptKey: receipts[0].key });
  } catch (error) {
    const message = typeof error?.message === 'string' && error.message.startsWith('Blocked:')
      ? error.message
      : 'Production backup CLI failed; protected details were suppressed.';
    return Object.freeze({ ok: false, error: message });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  if (process.argv.slice(2).some((arg) => arg !== '--preflight')) {
    process.stderr.write('Production backup CLI arguments are invalid.\n');
    process.exitCode = 1;
  } else {
    const result = await runProductionBackupCli({ preflightOnly: process.argv.includes('--preflight') });
    if (result.ok) {
      process.stdout.write(`Production backup status: ${result.status}\n`);
      if (result.receiptKey) process.stdout.write(`Production backup receipt key: ${result.receiptKey}\n`);
    }
    else {
      process.stderr.write(`${result.error}\n`);
      process.exitCode = 1;
    }
  }
}

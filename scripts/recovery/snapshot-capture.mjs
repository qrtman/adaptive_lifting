import { createHash } from 'node:crypto';

// Library only: no connection creation, credentials, CLI, or production workflow.
// The caller must supply an exclusively owned connected node-postgres-compatible
// client, a reviewed complete relation inventory, and approved encryption sinks.
export function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value.length || value.includes('\0')) {
    throw new Error('Invalid database identifier.');
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function snapshotDumpArgs(snapshot, schemas) {
  if (!/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshot)) throw new Error('Invalid exported snapshot.');
  if (!Array.isArray(schemas) || !schemas.length || new Set(schemas).size !== schemas.length ||
      schemas.some((schema) => !/^[a-z_][a-z0-9_]*$/.test(schema))) throw new Error('Invalid dump schema allowlist.');
  return ['--format=custom', '--strict-names', '--no-password', '--file=-',
    `--snapshot=${snapshot}`, ...schemas.map((schema) => `--schema=${schema}`)];
}

export function manifestCursorSql(schema, table) {
  const name = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  return `DECLARE recovery_rows NO SCROLL CURSOR FOR
    SELECT octet_length(payload)::text AS row_bytes, offsets.chunk_start::text AS offset,
      substring(payload FROM offsets.chunk_start FOR 16384) AS chunk
    FROM (SELECT row_to_json(t)::text AS payload, t.ctid AS row_tid FROM ONLY ${name} AS t) AS encoded
    CROSS JOIN LATERAL generate_series(1, greatest(char_length(payload),1),16384) AS offsets(chunk_start)
    ORDER BY payload COLLATE "C", row_tid, offsets.chunk_start`;
}

const INVENTORY_SQL = `SELECT n.nspname AS schema, c.relname AS name,
  c.relkind AS kind, c.relpersistence AS persistence,
  EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid) AS inherited
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','f','m')
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"`;

function relationKeys(rows) {
  return rows.map(({ schema, name }) => JSON.stringify([schema, name])).sort();
}

function sameInventory(actual, expected) {
  return JSON.stringify(relationKeys(actual)) === JSON.stringify(relationKeys(expected));
}

/** Same-snapshot archive + bounded row manifests. All returned manifests are
 * sensitive and MUST be encrypted by persistManifest; never log them.
 * Sequence values, global roles, Vault keys and extension recovery are separate
 * requirements; this primitive alone is NOT a complete production backup.
 */
export async function captureSnapshot({ client, schemas, expectedRelations, expectedVersions,
  captureArchive, persistManifest, env = process.env, platform = process.platform }) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || platform !== 'linux') {
    throw new Error('Snapshot capture requires a GitHub hosted Linux runner.');
  }
  snapshotDumpArgs('00000000-00000000-1', schemas);
  if (!client || typeof client.query !== 'function' || typeof captureArchive !== 'function' ||
      typeof persistManifest !== 'function' || !Array.isArray(expectedRelations) || !expectedRelations.length ||
      !Array.isArray(expectedVersions) || !expectedVersions.length ||
      expectedVersions.some((v) => !/^\d{14}$/.test(v)) || new Set(expectedVersions).size !== expectedVersions.length) {
    throw new Error('Reviewed inventory, migration versions and capture adapters are required.');
  }
  if (expectedRelations.some((r) => !schemas.includes(r.schema) || typeof r.name !== 'string' || !r.name.length) ||
      new Set(relationKeys(expectedRelations)).size !== expectedRelations.length) throw new Error('Invalid reviewed inventory.');
  let begun = false;
  let failure;
  let result;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun = true;
    await client.query("SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15min'; SET LOCAL row_security=off; SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'; SET LOCAL client_encoding='UTF8'; SET LOCAL search_path=pg_catalog");
    const identity = (await client.query(`SELECT current_database() AS database,
      current_setting('transaction_read_only') AS read_only,
      current_setting('server_version_num') AS version`)).rows[0];
    if (identity?.database !== 'postgres' || identity.read_only !== 'on' || !/^17\d{4}$/.test(identity.version)) {
      throw new Error('Database identity, version or read-only guard failed.');
    }
    const relations = (await client.query(INVENTORY_SQL, [schemas])).rows;
    if (!sameInventory(relations, expectedRelations)) throw new Error('Relation inventory differs from the reviewed release.');
    // Fail closed rather than inventing partition/inheritance/foreign-table rules.
    if (relations.some((r) => r.kind !== 'r' || r.persistence !== 'p' || r.inherited)) {
      throw new Error('Unsupported relation storage; a reviewed capture strategy is required.');
    }
    const names = relations.map((r) => `${quoteIdentifier(r.schema)}.${quoteIdentifier(r.name)}`);
    await client.query(`LOCK TABLE ${names.join(', ')} IN ACCESS SHARE MODE`);
    const versions = (await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map((r) => r.version);
    if (JSON.stringify(versions) !== JSON.stringify([...expectedVersions].sort())) throw new Error('Migration ledger differs from the reviewed release.');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot, transaction_timestamp()::text AS captured_at')).rows[0];
    const dumpArgs = snapshotDumpArgs(snapshot.snapshot, schemas);
    const tables = [];
    for (let i = 0; i < relations.length; i += 1) {
      const relation = relations[i];
      const columns = (await client.query(`SELECT a.attname AS name,
        pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS not_null, a.attidentity AS identity, a.attgenerated AS generated
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [names[i]])).rows;
      // Text is hashed without JSON.parse, preserving numeric precision and NULLs.
      // C-collation ordering also handles tables without a primary key and duplicates.
      // Chunk on the server before crossing the wire: one arbitrary-sized JSON
      // column must not defeat the client memory bound. Each chunk is <=64 KiB
      // in UTF-8 (16384 characters). ctid only breaks ties between identical rows;
      // its value is not hashed and is not compared across restores.
      await client.query(manifestCursorSql(relation.schema, relation.name));
      const hash = createHash('sha256');
      let count = 0;
      let remaining = 0;
      while (true) {
        const batch = (await client.query('FETCH FORWARD 16 FROM recovery_rows')).rows;
        if (!batch.length) break;
        for (const { row_bytes: rowBytes, offset, chunk } of batch) {
          if (typeof chunk !== 'string' || !/^\d+$/.test(rowBytes) || !/^\d+$/.test(offset)) throw new Error('Unexpected row encoding.');
          const bytes = Buffer.from(chunk, 'utf8');
          if (bytes.length > 65536) throw new Error('Manifest chunk exceeds its bound.');
          if (offset === '1') {
            if (remaining !== 0 || !Number.isSafeInteger(Number(rowBytes))) throw new Error('Invalid manifest row boundary.');
            remaining = Number(rowBytes);
            hash.update(`${remaining}:`);
            count += 1;
            if (!Number.isSafeInteger(count)) throw new Error('Row count limit exceeded.');
          }
          // Length framing makes embedded line breaks and delimiter text unambiguous.
          remaining -= bytes.length;
          if (remaining < 0) throw new Error('Invalid manifest chunk length.');
          hash.update(bytes);
        }
      }
      if (remaining !== 0) throw new Error('Incomplete manifest row.');
      await client.query('CLOSE recovery_rows');
      tables.push({ ...relation, columns, count, sha256: hash.digest('hex') });
    }
    // Await adapters before ending the snapshot. An adapter must await pg_dump's
    // exit, encryption, and all stream stages, not merely return its stdout handle.
    const archive = await captureArchive({ snapshot: snapshot.snapshot, dumpArgs });
    await persistManifest({ format: 'adaptive-snapshot-v1', capturedAt: snapshot.captured_at,
      serverVersion: identity.version, migrationVersions: versions, tables });
    result = { status: 'captured-restore-unverified', archive, tableCount: tables.length };
  } catch {
    // Native errors can include SQL literals, records or credentials.
    failure = new Error('Snapshot capture failed; sensitive database diagnostics suppressed.');
  }
  if (begun) {
    try { await client.query('ROLLBACK'); }
    catch { failure = new Error(failure ? 'Snapshot capture and transaction cleanup failed.' : 'Snapshot transaction cleanup failed.'); }
  }
  if (failure) throw failure;
  return result;
}

# Empty-database application bootstrap

This directory contains executable database foundation tooling. It does not
deploy an application, import data, create cloud infrastructure, or connect to
production. The confirmed production domain is `app.goatedmethod.me`; no domain
or project origin belongs in this schema artifact.

## Artifact and provenance

`application.sql` establishes **35 tables, 289 columns, 93 constraints, 93
indexes, and one owned sequence** immediately before the first Supabase SQL
migration. It is generated from `backend/migrations/schema_0001.py` and the
empty-install DDL in Alembic `0002` through `0011`. The `0001` legacy adoption,
pattern backfill, and accessory data conversion affect no rows in an empty
database and are not run. The artifact has no data, Alembic stamp, passwords,
JWT keys, provider configuration, staging secrets, or runtime login password.

The generator does not import `backend.database`, load `.env`, instantiate an
application engine, or call `Base.metadata.create_all()`. Tests inspect the
retained SQLAlchemy classes offline to confirm column/type/nullability parity.
The baseline deliberately uses the **historical `sync_mutations(mutation_id)`
primary key**; migration `20261002181756` changes it to the device-scoped key.
Later columns, `telegram_link_tokens`, RPCs and role grants are not preloaded.

The bootstrap requires an empty `public` application schema, fails on any
existing table/view/sequence, and executes transactionally. Existing databases
and data imports need separate procedures. Managed default grants to browser
roles are explicitly revoked without changing the historical RLS state.
Synthetic historical-data mapping and offline-queue compatibility rehearsal is
documented in [`IMPORT_REHEARSAL.md`](IMPORT_REHEARSAL.md); it uses fake data
only. The owner has finalized a fresh production launch: this importer and its
evidence are archived engineering tools, not production launch steps. No
historical accounts, sessions, workout data, billing state, provider secrets,
or queued jobs are to be imported.

## Reproduce locally

Requirements: Docker Engine/Desktop running, Linux containers, Python 3.11+,
and sufficient local disk/RAM for the image. No host `psql` is needed.

From repository root (PowerShell or a Unix shell):

```text
python -m pip install -r supabase/bootstrap/requirements.txt
docker pull supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00
python supabase/bootstrap/generate.py --check
python supabase/bootstrap/test_schema.py
python supabase/bootstrap/replay.py --evidence supabase/bootstrap/verification-strict.json
```

The four historical files previously contained a literal backslash followed
by `n` at EOF, outside SQL. Only those exact two bytes were removed after
matching the hash-pinned diagnostic manifest. The byte-for-byte source changes,
original and corrected hashes, preserved BOMs, and unchanged migration IDs are
recorded in `sql-eof-correction-audit.json`. Each Git blob before correction is
available in Git history. No executable SQL or database migration record changed.

`replay-repair.json`, `verification-strict-before-eof-fix.json`, and
`verification-repaired.json` are retained as historical evidence of the
original defect and diagnostic run. The replay tool has no repair flag or SQL
rewriter. It rejects any migration whose last non-whitespace bytes contain a
literal `\n` token, then sends each checked-in migration file to `psql` as
original bytes. Regenerate the canonical baseline with `python supabase/bootstrap/generate.py`, then repeat the strict checks above.

Each replay invocation creates **two independent empty clusters**, each with database
name `postgres` (required by historical CONNECT grants and pg_cron), applies
prerequisites then the baseline, and replays every migration in lexical order.
The first 62 files are compared with the retained staging catalog snapshot before
the new forward-only workout-revision migration is applied. That later migration
adds server-issued revisions to workouts, exercises, and exercise sets; the
resulting catalog delta is intentional and is not represented as staging parity.
Each migration receives its own transaction with `ON_ERROR_STOP=1`; input bytes
are streamed without newline conversion or content rewriting. Image entrypoint
initializers are bypassed so no inherited application/managed migration state
is present. No Supabase migration-history rows are fabricated or restamped.

The executable managed workflow is in [`deploy-managed.ps1`](deploy-managed.ps1).
It verifies the authenticated account's exact project reference and either a
matching direct database hostname or the specifically approved production
Session Pooler endpoint, rejects the validated staging ref, and runs
`managed-preflight.sql` before any writes. The preflight requires an empty
`public` application schema, no `al_*` application schemas, empty migration
history, and zero Auth users/identities/sessions, Storage objects/buckets, or
Cron jobs when those managed tables exist. Its default mode performs only
those checks. `-Apply` requires a private checkpoint directory outside the
repository and typed confirmation of the project ref before applying anything.

The ordered application procedure is: managed prerequisites, explicit
`application.sql` application, isolated temporary Supabase CLI workdir with
only these 63 migration files, explicit-target migration-list inspection, dry
run, strict dry-run version-set assertion, `db push --skip-vault`, exact ledger
version assertion, managed postflight, and rollback-only synthetic
`test_behavior.sql`. The script deliberately does not use `--include-all`, seed
files, `migration repair`, or automatic reset. It stops on any mismatch and
requires a forward recovery review; rerunning from an already nonempty schema
is refused. For a future preflight-only check:

```powershell
.\supabase\bootstrap\deploy-managed.ps1 -ValidateFilesOnly
```

For the authorized Seoul production Session Pooler, the exact target is
`gadusaizqnshxqcckibq` / `aws-0-ap-northeast-2.pooler.supabase.com:5432` /
`postgres.gadusaizqnshxqcckibq`. Port 6543 is rejected. The script also
supports a matching direct `db.<project-ref>.supabase.co` or `.com` connection
where IPv6 is available. It will not accept arbitrary pooler endpoints.

Enter the database password locally into the current PowerShell process
environment only (never a command argument, transcript, log, or file). Then
run the first command without `-Apply` for read-only identity/emptiness checks.
The command does not echo or accept the password as an argument. Example:

```powershell
.\supabase\bootstrap\deploy-managed.ps1 `
  -ProjectRef gadusaizqnshxqcckibq `
  -DatabaseHost aws-0-ap-northeast-2.pooler.supabase.com `
  -DatabasePort 5432 `
  -DatabaseUsername postgres.gadusaizqnshxqcckibq `
  -ConnectionMode SessionPooler
```

`psql` receives the same exact host, port and username; the Supabase CLI gets
the corresponding password-free connection URI pinned to this project. The
secret is inherited only through the process environment; no password is
included in CLI arguments. The isolated CLI
workdir contains no staging link, and migration list/dry-run/push all receive
the explicit project ref and `--db-url`; `--linked` is not used. `--skip-vault`
prevents deployment-time Vault secret sync. An interactive exact-project
confirmation remains required before a checkpoint or SQL write.

By default, `-Apply` verifies `pg_dump --version` and captures the existing
schema-only checkpoint. The narrowly scoped `-EmptyDatabasePsqlCheckpoint`
alternative is available only for this exact production project through the
approved Session Pooler and only after the complete empty-target preflight.
It uses `psql` to save a catalog-only JSON snapshot, project/database identity,
PostgreSQL version, exact baseline and 63 migration hashes, and a second
prewrite emptiness/catalog recheck. Checkpoint files are placed in a Windows
directory with inheritance disabled and access limited to the current owner,
SYSTEM, and local Administrators; files are marked read-only. A failed write,
missing artifact, changed catalog, nonempty table/schema, or unexpected
migration record stops before SQL changes. The checkpoint is explicitly **not
a restorable backup**. Do not bypass Windows Application Control to run
`pg_dump`.

Both checkpoint modes are evidence only and are not independent backups. Before
public launch, arrange an independent encrypted database backup and complete a
successful restore rehearsal. Backup availability and restoration are not
verified by this bootstrap workflow.

The psql-only option for the approved empty production project is:

```powershell
$CheckpointDirectory = Join-Path $env:TEMP ("adaptive-lifting-production-" + [guid]::NewGuid().ToString('N'))
.\supabase\bootstrap\deploy-managed.ps1 `
  -ProjectRef gadusaizqnshxqcckibq `
  -DatabaseHost aws-0-ap-northeast-2.pooler.supabase.com `
  -DatabasePort 5432 `
  -DatabaseUsername postgres.gadusaizqnshxqcckibq `
  -ConnectionMode SessionPooler `
  -CheckpointDirectory $CheckpointDirectory `
  -EmptyDatabasePsqlCheckpoint -Apply
```

The read-only invocation above must pass immediately before this apply
invocation. Use a new checkpoint directory outside the checkout for each
attempt. The script asks for the exact typed project confirmation, captures
the protected catalog evidence, and repeats the emptiness check before the
first database write.

Only the separately authorized bootstrap procedure uses `-Apply`; it refuses
any application table, user, storage object, or migration record. Do not use
this workflow on staging or an existing application database.

The migration creates `al_edge_catalog_runtime` as a restricted LOGIN role;
it does not create or embed its password. After the schema is ready and before
deploying the API, set a unique role password through an interactive secure
`psql` session (`\password al_edge_catalog_runtime`) and store the matching
TLS database URL only in the production Edge secret manager. Configure the
non-secret settings from `supabase/production.env.example`, plus the required
private secret names listed there; `REALTIME_JWT_PRIVATE_JWK` is required by
the current API entrypoint at process startup. Do not configure
`JWT_SECRET_PREVIOUS` for fresh production. Keep
`supabase/config.toml`'s custom JWT `verify_jwt=false` setting so the existing
custom cookie/session verifier remains the auth boundary. Disable the Data API
in the project settings and verify REST/GraphQL are unavailable; SQL cannot
read back that platform-level setting. No Supabase Auth is introduced.

After partial failure, do not rerun the bootstrap blindly. Preserve the
checkpoint and database, inspect the exact catalog/ledger and logs, then either
apply a reviewed forward fix or obtain separate approval to abandon that still
empty new project. The checkpoint is schema-only and is not a verified restore
rehearsal.

`application.sql` lives in `supabase/bootstrap/`, outside the CLI's local
`supabase/migrations/` directory. Therefore `supabase db push` does **not**
discover or apply the bootstrap. The operator must apply it explicitly before
the first migration push. The CLI compares local migration timestamps with
`supabase_migrations.schema_migrations` and records versions after applying
SQL; it does not compare the SQL file hashes. Thus the four byte-only source
corrections retain their existing 62 version identifiers and do not require
rewriting applied staging history. The local harness does not model this CLI
ledger or platform orchestration; it applies raw SQL to disposable databases
and tests schema outcome. See Supabase's [migration guide](https://supabase.com/docs/guides/deployment/database-migrations)
and [`db push` reference](https://supabase.com/docs/reference/cli/supabase-db-push)
for the managed workflow and ledger behavior.

Containers have no external network, no published ports, no host/database
mounts, and a temporary filesystem. Synthetic constraint tests roll back; the
containers and anonymous image volumes are removed on success or failure.
An interrupted process can leave a labeled container; inspect only this
harness's containers with `docker ps -a --filter
label=adaptive-lifting.bootstrap=true`, then remove the explicitly named
disposable container with `docker rm -f -v <name>`.

## Managed dependencies and limits

`managed-prerequisites.sql` is the ordered prerequisite artifact: `extensions`
schema, real pgcrypto, Vault, pg_cron and pg_net extensions, existing Supabase
roles, and service-owned Realtime objects. It validates extension placement,
database name, and Vault encryption/decryption with a random probe deleted
within the transaction. **Do not install `local-managed-fixture.sql` on a
managed Supabase project.**

The local pinned Supabase Postgres image runs PostgreSQL 17.6, matching the
inspected staging major/minor. It provides real Vault 0.3.1 and pg_cron 1.6.4.
Its pg_net is 0.20.3; inspected staging is 0.20.4. The local Vault library needs
preloading and a getkey script: the harness generates a new private random
root key in temporary memory-backed storage for each run. No key is printed,
checked in, reused, or copied from a managed project. Cron jobs are registered
but automatic execution is disabled; pg_net has no external network.

The Realtime server normally creates `realtime.messages` and `realtime.topic()`.
The harness supplies their required SQL interface as a clearly marked fixture
and tests the real PostgreSQL RLS policy. It does **not** run Realtime WebSocket
delivery, managed partition retention, Auth, PostgREST, Edge Functions, Cron
dispatch, or provider calls. Passing SQL replay is not full managed-service E2E.
No plaintext substitutes for Vault, pg_net, or Cron are used.

## Verification evidence

`staging-catalog.json` was collected through read-only `pg_catalog` inspection
of staging ref `admyuepbbtstayaydjmo`. `catalog.sql` exports application schema
definitions only: no user rows, Vault values, sequence current values, passwords,
or credentials. `alembic_version` and extension-owned tables are excluded;
schema ownership and environment-specific ACL identities are not part of the
structural comparison. Historical bootstrap generation does not use this final
catalog as an input.

Evidence recorded on 2026-10-09:

| Check | Result |
| --- | --- |
| Deterministic generation and retained-model parity | PASS |
| Python schema/regression tests | 11 passed (10 existing plus EOF/hash regression) |
| Baseline structural validation in two independent clusters | PASS; identical catalogs |
| Reject bootstrap on nonempty schema; preserve catalog | PASS |
| Roll back an SQL file ending in an invalid psql command | PASS; no partial schema persists |
| Strict byte-for-byte replay, two invocations; two databases each | PASS; 63/63 in all four databases |
| Baseline repeatability across clean databases | PASS; exact match |
| Final schema repeatability across clean databases | PASS; exact match |
| Final application catalog versus read-only staging snapshot | PASS; exact match |
| SQL behavior tests, failed-file rollback, literal-EOF guard | PASS |
| Original 62-migration staging catalog | 36 tables, 299 columns, 96 constraints, 98 indexes, one sequence |
| Local final catalog after migration 63 | 36 tables, 302 columns, 99 constraints, 98 indexes, one sequence |
| PK/FK/unique/check/default/sequence behavioral checks | PASS |
| Device-scoped idempotency and browser-role denial | PASS |
| Realtime SQL policy, valid topic vs mismatched identity | PASS; fixture only |
| Full managed-service runtime equivalence | NOT TESTED |

Machine-readable 63-migration evidence is in `verification-revisions.json`;
`deploy-managed.ps1` pins every migration and the bootstrap hash against it and
also verifies the first 62 files against the preserved `verification-strict.json`
staging-parity checkpoint. Historical failure evidence is retained in `verification-strict-before-eof-fix.json`,
`verification-repaired.json`, and `replay-repair.json`. Evidence records the
image digest, raw and normalized migration hashes, migration order, schema
hashes/counts, comparison result and cleanup. The correction-level old/new raw
and normalized hashes are in `sql-eof-correction-audit.json`.
Future migration application must use the new empty-target guard; production
project provisioning and cutover are not authorized here.

## Production recovery preparation

Choose the production Supabase plan and retention requirement before provisioning.
Supabase documents daily managed database backups on paid plans and PITR as a
paid add-on; confirm exact project availability, retention, download/restore
behavior, and cost in the selected account before relying on it. Keep an
independent encrypted logical export on a separate owner-controlled storage
location. A restore drill must target an isolated project with matching
PostgreSQL/extensions, verify the migration ledger and catalog, then reconcile
row counts and domain invariants. Keep Cron disabled or its jobs unscheduled
until webhook/outbox destinations and Vault are verified; restored network jobs
can produce external effects. Separately preserve the Vault root key and
required application encryption/signing keys when choosing a logical restore
path. Supabase's logical dump and project-restore procedures have different
coverage; a schema-only pre-bootstrap checkpoint is not a substitute for a
tested production backup/restore. No plan, PITR add-on, backup or restore was
provisioned or exercised by this task.

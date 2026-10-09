# Synthetic legacy data import rehearsal

This procedure establishes whether legacy application records can be copied into
a clean database created by `application.sql` and all current Supabase migrations.
It uses fake data only. It does not connect to Supabase, Cloudflare, production,
staging, or external providers.

## Reproduce

Requirements are the same as the bootstrap harness: Docker with Linux
containers, Python 3.11+, and `supabase/bootstrap/requirements.txt` installed.
From the repository root run:

```text
python supabase/bootstrap/import_rehearsal.py
```

The command creates a temporary SQLite database and upgrades it using the
retained Alembic history through `0011_email_verification`. It creates two
independent disposable PostgreSQL targets, applies the canonical bootstrap and
replays all 63 checked-in Supabase SQL migrations in order, then imports the
synthetic rows into each target. Container networking is disabled. The targets
are removed after the run. Machine-readable counts, table digests, field maps,
reconciliation results, and queue checks are written to
`import-rehearsal-evidence.json`.

## Mapping and preservation

The rehearsal maps all 35 legacy source tables and columns by identical name
and copies the exact source identifiers and foreign-key values. The generated
evidence lists each source and target column, SQL type, and `identity`
transformation. The synthetic source has 53 rows. Counts and canonical table
digests match after import; foreign-key checks find no orphans. Explicit-ID
sequence advancement, primary-key enforcement, voucher/grant consistency, and
active workspace grant/subscription consistency are checked. An invalid row
pair is attempted inside one transaction; it fails and leaves no partially
inserted user.

The legacy `accessories` source row is expanded by the retained legacy
`migrate_accessories_to_exercises` helper before Alembic revision 0011. This is
the historical application transformation, not a new import-time rewrite.
Revision 0011 also performs its original email-verification backfill. These
semantics must be reviewed against a real legacy backup before importing it.

The current target has the additional `telegram_link_tokens` table. It is not
present in the old source and remains empty. Target-only columns are left at
their database defaults or NULL: `integration_outbox.claim_token`,
`oauth_states.session_id`, and `webhook_events.attempt_count`,
`claim_token`, and `lease_expires_at`. No source fields are silently omitted:
the script fails if a source table or column has no target mapping.

## Verified behavior and current limit

The new forward-only migration `20261010120000_workout_offline_conflict_revisions.sql`
adds server-issued row revisions and transactional compare-before-write checks.
The first 62 migrations still match the retained staging catalog snapshot;
the revision columns and positive-value constraints are the intentional
post-checkpoint delta. Staging has not received this migration.

The rehearsal proves that an old schema-v1 `ExerciseSet` mutation with no
revision baseline receives `BASELINE_REQUIRED`, creates no sync receipt, and
leaves its original edit and mutation ID available for review. With a valid
baseline, an offline stale note is rejected while the newer server note remains
unchanged. Replaying an accepted mutation ID is idempotent. Two concurrent
writers with the same baseline yield one winner, while distinct fields at the
same baseline can merge. A child set edit advances the parent exercise revision,
so stale full-set replacement cannot erase it. Future client timestamps remain
rejected by the existing clock-skew rule; an old client timestamp does not
defeat revision comparison. Tombstones, expired/revoked sessions, and ended
coach links remain rejected. These tests run against two independently
replayed and imported disposable targets.

On a conflict, the browser stores the unresolved mutation in IndexedDB as
`CONFLICTED`, omits it from automatic retries and cleanup, displays server and
local values, and offers explicit Keep Server or JSON export. Keep Server
requires confirmation, updates any matching cached workout snapshot in the same
IndexedDB transaction as the resolution status, and retains the original edit
for 28 days from resolution. Force Mine is not offered; users must explicitly
review/export before making a fresh mutation against a newly observed revision.
No real historical offline queue was replayed.

Queued outbox rows are copied as data only; the rehearsal runs no provider
worker and causes no external side effect. A real import must quarantine or
reconcile queued jobs and webhook events before enabling workers, using
provider idempotency evidence. Integration credentials are only copied as
synthetic opaque values here. Real credential decryption requires the original
legacy encryption key and a controlled owner decision.

## Decisions and limits before any real import

- Confirm whether legacy sessions/JWTs can be honored by the target deployment
  with the same signing key, claims, cookie format, and revocation checks. If
  not, deliberately expire sessions and require reauthentication; never bypass
  current session validation.
- Confirm the 0011 legacy email-verification exemption policy for real users.
- Reconcile the legacy `users.subscription_status` hint against authoritative
  workspaces, grants, vouchers, subscriptions, and billing-provider records;
  the rehearsal does not infer entitlements from that hint.
- Confirm credential-key availability and disposition of pending OAuth states,
  outbox jobs, and webhook records. Active provider state may require provider
  reconciliation rather than blind copying.
- Decide the user-support and import policy for unresolved schema-v1 queue
  conflicts. The client preserves and surfaces those edits, but reconciliation
  with a real backup and its account owners remains a separate decision.
- The source fixture exercises schema and representative rows, not a real
  backup, production identity provider, Supabase Auth, Realtime delivery, Edge
  Function runtime, or provider behavior. No conclusion here authorizes import
  of real records or a production cutover.

The bootstrap SQL is intentionally outside `supabase/migrations/`. A future
new empty project requires explicit application of the bootstrap before the
63-version migration sequence; `supabase db push` does not apply it. Follow
`README.md` for bootstrap and managed-service prerequisites. Never bootstrap an
existing database.

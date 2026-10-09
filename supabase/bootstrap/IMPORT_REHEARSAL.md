# Synthetic legacy data import rehearsal

This procedure establishes whether legacy application records can be copied into
a clean database created by `application.sql` and all 62 Supabase migrations.
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
replays all 62 checked-in Supabase SQL migrations in order, then imports the
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

The synthetic queued v1 `ExerciseSet` mutation is accepted by the current
workout sync RPC; replaying its mutation ID creates no duplicate mutation.
Tombstoned sets are rejected, expired/revoked sessions are denied, an active
coach relationship is allowed, and ending that relationship revokes access.
The test also proves a limitation: an older `updated_at` mutation is currently
accepted and overwrites a newer note. Therefore import-level row preservation
is repeatable, but replaying every historical offline queue is **not yet safe**
when concurrent newer edits may exist. Do not replay such queues into a live
account until a conflict policy is implemented and verified. Preserve queued
mutations for explicit recovery; do not discard them.

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
- Decide how stale queued writes should surface as conflicts. The current RPC
  does not compare source timestamps for stale-write rejection.
- The source fixture exercises schema and representative rows, not a real
  backup, production identity provider, Supabase Auth, Realtime delivery, Edge
  Function runtime, or provider behavior. No conclusion here authorizes import
  of real records or a production cutover.

The bootstrap SQL is intentionally outside `supabase/migrations/`. A future
new empty project requires explicit application of the bootstrap before the
62-version migration sequence; `supabase db push` does not apply it. Follow
`README.md` for bootstrap and managed-service prerequisites. Never bootstrap an
existing database.

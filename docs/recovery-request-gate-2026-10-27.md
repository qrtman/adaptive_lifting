# Recovery request admission and exclusive ownership

Task: remove the missing application maintenance implementation without changing
production schemas, roles, grants, sequences or committed Cron settings.

Source of truth: architecture sections 9, 11.5 and 15.3â€“15.6; design section 0
(no product UI changes). The existing Supabase-only backend, custom auth, RBAC,
audit, idempotency and no-demo-data contracts remain authoritative.

## Implemented scope

- The API, verification-email worker and Sheets worker borrow one native SQL
  session for their complete invocation, including provider calls between RPCs.
  A two-integer shared advisory lock admits each invocation. An exclusive lock
  rejects new invocations with HTTP 503, Retry-After and no-store metadata.
  Existing allowed-origin CORS, preflight, origin checks and handler auth remain.
- SQL helpers release borrowed views without returning the native session early.
  This avoids reconnecting or deadlocking the existing pool of size one.
  Calls after completion, consumer release or native session replacement fail.
  Already-submitted SQL drains before unlocking. No transparent reconnect is
  permitted in the pinned Deno driver.
- Checkout, SQL, acquisition, unlock and close have bounded deadlines. A late
  checkout is closed. Unknown acquisition/unlock results require confirmed close
  before pool return; an uncertain close is quarantined. Provider callbacks are
  awaited to completion; a response timer must not manufacture a drain signal.
- The exclusive helper verifies the native backend and exact exclusive lock,
  checks ownership before/after capture and during its heartbeat, aborts on
  ownership loss, and closes its owned client on failure or an ignored capture
  deadline. An invalid capture cannot return a successful receipt. Capture sinks
  must independently honor the abort signal before publishing anything.
- The isolated PostgreSQL fixture exercises shared/exclusive contention, the
  interval between RPCs, rejection of new admission, the exclusive helper itself,
  and resumption after owner backend loss. Its injected fixture identity is not
  a production TLS test. All previous table-lock/sequence/NOLOGIN negative
  controls remain present.

## Verification

Local targeted checks: 10 Deno request-gate checks and 23 Node maintenance checks
PASS. All three Edge entrypoints typecheck. The broader shared Edge suite was
65/65 before the additional slow-provider regression test; final/hosted results
are recorded below when available.

The standalone hosted workflow has no production environment, production
credentials, R2 access or artifact upload. It runs pinned Node/Deno tooling,
the shared Edge suite, the isolated PostgreSQL drill and independent owned
container absence verification. It does not enable a production job.

## Remaining production boundary

This patch supplies application admission code, not complete source quiescence.
Before capture, deploy and verify all guarded function versions, retire old
unguarded invocations, exclude direct administrative writers, and close the
unused Data API write path. Read-only ACL inspection found service_role writes
on public.telegram_link_tokens. Disabling the Data API is a platform setting
that preserves schema/grants; changing automatic grants is not a substitute.
See Supabase's [official Data API guidance](https://supabase.com/docs/guides/api/securing-your-api#disable-the-data-api).

Database session loss can release a shared lock while an already-sent provider
request continues. Absence of shared locks alone therefore cannot prove provider
drain. The first rehearsal needs an explicit provider-disabled invocation-drain
policy and ambiguous outbox reconciliation. Never label this patch a global
provider fence. Cron dispatch queues are not paused by this protocol.

The existing production CLI is deliberately not wired to this helper until its
complete writer, provider and release prerequisites are independently verified.
Vault/application dependency integration, sequence capture/reconciliation and
two isolated full restores remain separate unfinished work. No production
capture, schema mutation, key retrieval, R2 write, scheduling, retention or
traffic change has been performed by this patch.

## Review accounting

Lead implementation; independent verifier maintenance_feasibility, tier 5,
requested gpt-6.1-sol/high, no escalation. Reviewer reproduced unbounded
request acquire/close and exclusive capture hangs. Bounded cleanup/cancellation
tests now pass. Review also caught premature provider release from a request
timer; the timer was removed and a regression test added. Actual model usage
and billed cost are unavailable. The owner's relaxed Lead-low preference is
not a recovery blocker; no personal configuration was changed.

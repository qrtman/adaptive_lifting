# Recovery request admission and exclusive ownership

Task: remove the missing application maintenance implementation without changing
production schemas, roles, grants, sequences or committed Cron settings.

Source of truth: architecture sections 9, 11.5 and 15.3–15.6; design section 0
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

Continuation verified 2026-10-28 (Asia/Seoul), commit
`016a239af26e9760976efc9df19b366705264fe3`:

- [Hosted protocol run 40541430859](https://github.com/qrtman/adaptive_lifting/actions/runs/40541430859)
  PASS: 27 Node checks, 66 shared Edge tests, all three entrypoint typechecks,
  and 17 PostgreSQL protocol/negative-control assertions. This includes the
  real bundled Deno driver and request gate: stable session across SQL helpers
  and a provider gap, rejection before the callback under exclusive ownership,
  rejected writes and disabled native reconnect after backend termination,
  absence of those attempted writes, and fresh request admission.
- [Repository CI 40541440938](https://github.com/qrtman/adaptive_lifting/actions/runs/40541440938)
  PASS. Independent owned-container absence and executable cleanup PASS.
- The fixture remains unprivileged, network-denied, without ports or host
  mounts, with a read-only root filesystem and synthetic data only. Its
  transport is a Unix socket; production TLS and hosted pooler admission are
  NOT TESTED. `captureAllowed` remains false.

Native startup diagnosis required failed hosted attempts, all with independent
cleanup PASS. Archive-copy, missing runtime dependency, canonicalization and
selection failures did not count as gate proof. Runs 40539657033 and
40540323815 exposed a missing Bash loader mapping; 40540774498 and 40541082797
exposed two glibc patch revisions and Nix bootstrap xgcc outputs. The final
selector compares glibc revisions numerically and uses final GCC libraries.
It chooses a compatibility candidate from immutable installed image paths;
it does not attest Bash's active runtime. Actual successful native execution
above is the acceptance evidence. No permission or isolation relaxation was
needed. Regression assertions cover numeric revisions and bootstrap exclusion.

Previously run local baseline: 374/374 recovery tests (including 23 maintenance checks), 66/66
shared Edge tests (including 10 request-gate checks), and 432/432 application
tests PASS (one existing application test skipped). All three Edge entrypoints
typecheck; npm run lint PASS after extending the compile-only driver bridge to
represent the verified connection configuration and session lifecycle.

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
policy and ambiguous outbox reconciliation. Hold exclusive ownership while
draining old invocations for the maximum hosted worker lifetime plus a margin
(use the 400-second bound plus margin, not the 150-second request idle timeout).
Then verify zero processing or uncertain provider/outbox/checkout work through
protected counts and preserve disabled launch gates. Reconcile ambiguous jobs
before the first rehearsal. Supabase documents these separate limits in its
[Edge Functions limits](https://supabase.com/docs/guides/functions/limits).
Never label this patch a global
provider fence. Cron dispatch queues are not paused by this protocol.

The existing production CLI is deliberately not wired to this helper until its
complete writer, provider and release prerequisites are independently verified.
Vault/application dependency integration, sequence capture/reconciliation and
two isolated full restores remain separate unfinished work. No production
capture, schema mutation, key retrieval, R2 write, scheduling, retention or
traffic change has been performed by this patch.

## Review accounting

Final independent verification reproduced 27/27 maintenance Node checks and
confirmed exact hosted checkout/result and both cleanup steps for run
40541430859. Repository CI ran against the tested merge with main: lint/build,
433 application tests (one skipped) and 243 recovery Node tests PASS. The
verifier found no blocker or major in the final glibc-revision/bootstrap-runtime
selection or native gate evidence. These checks do not establish production
readiness. The routing validator still reports the personal Lead-default
mismatch; no settings or model escalation were used to address this task.

Lead implementation; independent verifier maintenance_feasibility, tier 5,
requested gpt-6.1-sol/high, no escalation. Reviewer reproduced unbounded
request acquire/close and exclusive capture hangs. Bounded cleanup/cancellation
tests now pass. Review also caught premature provider release from a request
timer; the timer was removed and a regression test added. Actual model usage
and billed cost are unavailable. The owner's relaxed Lead-low preference is
not a recovery blocker; no personal configuration was changed.


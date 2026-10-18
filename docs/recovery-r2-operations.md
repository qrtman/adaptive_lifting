# Prepared daily recovery operations: GitHub Actions + Cloudflare R2 Standard

**Owner decision required; not activated.** This guide and the companion workflow
prepare an option for review. No R2 bucket, lifecycle rule, credential, repository
variable, secret, or environment protection has been configured. Workflow schedule
definitions are on the test branch and are not active. Production recovery remains
**BLOCKED / NOT TESTED** until an authorized production capture is retrieved and
restored successfully in isolation.

## Prepared workflow behavior

[`recovery-daily-backup.yml`](../.github/workflows/recovery-daily-backup.yml) defines
a daily schedule at 18:17 UTC (03:17 Korea time). GitHub scheduled runs use the
default branch. The backup and monitor workflows are being prepared on a test branch,
so neither schedule will run until both workflow files have been merged to the
repository's default branch.
The production job also checks that the ref is the repository's default branch and
that repository variable `RECOVERY_BACKUP_ENABLED` is exactly `true`. Scheduled
production runs additionally require repository variable
`RECOVERY_BACKUP_SCHEDULE_ENABLED` to be exactly `true`; workflow dispatch on the
default branch requires only `RECOVERY_BACKUP_ENABLED`. This permits an explicitly
authorized first manual capture while unattended scheduling and the missed-run
monitor remain skipped. The CLI checks
the GitHub event payload/ref context again (for manual dispatch it compares against
the payload's default branch; scheduled events rely on GitHub's default-branch
schedule guarantee because their webhook payload is not applicable). The job is bound to the
`production-recovery` environment. Configure default-branch-only deployment
restrictions and keep secrets in that environment. Do not require per-run human
reviewers for this unattended daily job: required reviewers would pause each run.
Instead, require an owner-reviewed protected workflow commit and a separate explicit
owner activation decision before setting `RECOVERY_BACKUP_ENABLED` to `true`. Keep
`RECOVERY_BACKUP_SCHEDULE_ENABLED` false until a captured point has passed isolated
restore/reconciliation and the owner has accepted that evidence.

`workflow_dispatch` on another branch runs only the secret-free validation job. It
checks out the dispatched commit with checkout credentials disabled and runs local
recovery unit checks; it cannot enter the protected production job. No pull request
or push trigger is configured. The workflow grants only `contents: read` to
`GITHUB_TOKEN`, does not upload artifacts, does not print secrets, and does not
delete R2 objects. The production job maps database and R2 credentials only into the
backup command step after the branch and repository-variable guards have passed.
Archive and encrypted-manifest uploads use separate immutable object keys. If one
upload or readback succeeds and the next fails, the earlier ciphertext can remain as
an uncommitted orphan; the command fails and has no deletion permission. Treat such
objects as incomplete evidence, never as a recovery point. A later implementation
needs a durable receipt that identifies both objects and sanitized evidence before
any object can count toward retention.

GitHub's normal Actions failure notifications can report a run that starts and fails,
subject to the owner's notification settings; they do not reliably alert when GitHub
skips or delays a scheduled run, or when the workflow is disabled. The separate prepared
[`recovery-backup-missed-run-monitor.yml`](../.github/workflows/recovery-backup-missed-run-monitor.yml)
uses only `GITHUB_TOKEN` with `actions: read` to query the backup workflow's run
history. At 21:17 UTC it checks that the latest scheduled run on the default branch
is no older than 26 hours, completed successfully, and has a successful
`Protected production backup` job. It runs only when both backup variables are true,
so it skips while scheduling is disabled. This catches a validation-only success with a
skipped production job. A missing or stale run or unsuccessful production job fails
the monitor so normal Actions failure notifications can fire. GitHub's schedule event
uses the default branch; the monitor also checks the branch named by that event
against repository metadata.
The monitor itself can be delayed or dropped, and it cannot alert if disabled; owner
notification settings still matter. A prior object must never be treated as evidence
that today's attempt succeeded. See GitHub's [scheduled event behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow).

## Owner setup before activation

1. Obtain explicit approval for GitHub to temporarily process plaintext during
   capture. Confirm an owner and alternate operator, alert destination, independent
   recovery key custody, expected data scope, measured archive size, runner
   cost/allowance, and RPO/RTO targets.
2. Select a dedicated private R2 Standard bucket and a new exclusive prefix, for
   example `production/adaptive-lifting/verified-points`. Do not infer that an
   existing bucket is empty or inspect/delete its unrelated objects. Disable public
   `r2.dev` access and do not attach a public custom domain. A prefix in a credential
   or workflow input does not itself enforce an access boundary; use a dedicated
   bucket or independently verify technically enforced least-privilege scope.
3. Create a Cloudflare R2 API token with **Object Read & Write** permission scoped
   to only that bucket. The S3-compatible credentials are its Access Key ID and
   Secret Access Key. This permission can read, write, and list objects in the
   selected bucket; the workflow code itself does not list or delete objects. Do not
   use an account-wide token. Confirm the exact bucket scope before issuance.
4. Generate the age keypair through an owner-approved secure procedure. Put the
   public recipient in `RECOVERY_AGE_RECIPIENT`. Keep the private identity offline
   in the owner's password manager with a primary and alternate custodian and
   independently tested recovery access. Never give the production backup job the
   private identity.
5. Store only the production database password and TLS CA bundle as protected
   environment secrets `RECOVERY_DB_PASSWORD` and `RECOVERY_DB_CA_PEM`; store the
   bucket-scoped R2 Access Key ID and Secret Access Key as
   `RECOVERY_R2_ACCESS_KEY_ID` and `RECOVERY_R2_SECRET_ACCESS_KEY`. Set non-secret
   variables `RECOVERY_R2_ACCOUNT_ID`, `RECOVERY_R2_BUCKET`, and
   `RECOVERY_R2_PREFIX` after reviewing their exact values and scope. This change
   does not configure any workflow secret or variable.
6. Configure the GitHub `production-recovery` environment with default-branch-only
   deployment restrictions and environment secrets. Do not add required reviewers
   to the unattended job. Confirm repository default-branch protection and
   notification settings. Require an owner-reviewed protected workflow commit.
   Keep both `RECOVERY_BACKUP_ENABLED` and `RECOVERY_BACKUP_SCHEDULE_ENABLED` false
   until the setup and review gates below are satisfied.
7. Before any production capture, review the CLI, dependencies, exact database
   identity, encryption, R2 upload/readback, cleanup, and sanitized evidence. The
   current `scripts/recovery/production-backup.mjs` CLI reads only the fixed sibling
   file `scripts/recovery/production-release-inventory.json`, validates its exact
   pinned source/schema/relation/version fields, derives the GitHub event gate
   internally, and then calls the backup orchestrator. That inventory file is
   currently absent, so the CLI exits before connecting and production capture
   cannot run, even if credentials are later supplied. Create and independently
   review the exact deployed production inventory and migration version list before
   adding that file in a protected commit. Caller-supplied booleans are not proof of
   workflow context. Test the CLI path with synthetic inventory and injected
   adapters before any authorized live invocation. A successful R2 byte readback
   establishes that uploaded ciphertext bytes match; it does not establish
   authenticated decryption, restore success, or a verified recovery point.
   After the fixed inventory is independently reviewed and checked in, the owner may
   separately authorize a first manual capture: set `RECOVERY_BACKUP_ENABLED` true
   while keeping `RECOVERY_BACKUP_SCHEDULE_ENABLED` false, then dispatch only from
   the default branch. This does not activate the daily schedule or monitor. Retrieve
   the point and complete isolated restore/reconciliation and owner acceptance before
   calling it recoverable. Only then, after a separate owner decision, set
   `RECOVERY_BACKUP_SCHEDULE_ENABLED` true to allow daily scheduled runs and the
   missed-run monitor. No live run or activation is authorized by this document.

The prepared runner verifies age 1.3.1 against its release archive SHA-256, installs
the PostgreSQL 17 client from the signed PostgreSQL Apt repository after checking its
repository key fingerprint, and checks the runner's S3-compatible AWS CLI client
version before the production command. PostgreSQL client patch updates remain
controlled by the signed major-version repository; the runtime rejects anything
outside PostgreSQL 17. The runner image is maintained by GitHub and may change; the
exact AWS CLI check fails closed if its installed version changes, pending a reviewed
pin update.

## Cost estimate and budget proposal

Cloudflare currently lists Standard R2 storage at $0.015 per GB-month, with 10
GB-month free and monthly free allowances of 1 million Class A and 10 million
Class B operations. At the backup module's 5-GiB single-object limit, two objects
(archive and encrypted manifest) daily for 14 days would be 140 GiB stored. This is
about 150.3 decimal GB-month; subtracting the free 10 GB-month leaves about 140.3
billable GB-month, or **$2.10/month** at the listed rate. With the rough convention
that GB and GiB are equivalent, the estimate is about $1.95/month. Actual objects
should be smaller; objects over the single-PUT cap fail closed, so no multipart
upload is implied. Two writes and two readbacks daily are about 60 Class A and 60
Class B requests per 30-day month, well below the listed free allowances. This
estimate assumes objects expire promptly at the 14-day boundary. Cloudflare says
expiration generally occurs within 24 hours after the specified time, while existing
objects can take longer depending on object count; storage may therefore exceed the
14-day steady-state estimate. For a rough one-day lag, 150 GiB stored is about 161.1
decimal GB-month, or about $2.27 after the 10 GB-month free allowance. Longer lag,
other bucket contents, or pricing changes can raise the bill, so $5 is not a hard
spending cap. The estimate excludes tax and GitHub Actions minutes, which depend on the repository
plan and actual runtime. Propose a **$5/month R2 spend ceiling** for owner review;
it is a budget target, not a configured hard cap. Recheck live prices, usage and
alerting before activation. No billing alert or resource is configured here.
Sources: [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 API token permissions](https://developers.cloudflare.com/r2/api/tokens/),
[R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

The R2 transfer module uses the AWS CLI only as an S3-compatible client to Cloudflare
R2. It does not provision or refer to AWS infrastructure. The previously reviewed
Cloudflare R2 S3 compatibility documentation records atomic conditional
`PutObject` with `If-None-Match: *` support. Cloudflare R2 does not support S3
lifecycle configuration or S3 Object Locking; do not send S3 lifecycle or Object Lock
requests through the S3-compatible API.

## Native R2 retention proposal (manual, after approval)

The backup job must never delete or expire objects. Only after owner approval, an
operator may configure an R2 native lifecycle rule in the Cloudflare dashboard or
through Cloudflare's native API. Scope the rule to the exact dedicated bucket and
exclusive production prefix, and configure expiration after 14 days from object
creation. Review the rule's prefix match and preview/readback before saving. Do not
apply it to the bucket root, other prefixes, staging data, or historical backups.

An age-based 14-day expiration is a storage-cost policy, not a guarantee of 14
successfully verified restore points. If one or more daily runs fail or are missed,
old objects still expire by age and the number of complete verified points may fall
below 14. The native lifecycle rule cannot inspect backup status, pin a latest point,
or count successfully restored points. It may expire the newest known point once
that object reaches its configured age. The operator must alert on a missing/failed
attempt, check the actual remaining inventory and pause or remove the lifecycle rule
before it threatens required retention. Even with daily review, an age rule cannot
guarantee 14 recovered points across missed runs; if that guarantee is required,
leave lifecycle unconfigured and request a separate retention design. Do not add
deletion logic to the backup workflow.

## Current readiness

- Workflow is prepared but gated; production execution has not been enabled.
- `RECOVERY_BACKUP_ENABLED` controls authorized default-branch manual capture and
  is required for all production runs. `RECOVERY_BACKUP_SCHEDULE_ENABLED` is a
  separate opt-in required by the daily schedule and missed-run monitor; leave it
  false until a manually captured point is restored/reconciled and accepted.
- The workflow lives on a test branch and its schedule will not execute until merged
  to the repository's default branch.
- The CLI can call the tested orchestrator only when an independently reviewed
  production relation/version inventory is checked in at its fixed path. That file
  is absent, so it currently fails closed before a source connection. A successful
  ciphertext readback would still not mean that a restore was verified.
- GitHub environment protections, secrets, variables, and alerts are not configured
  by this change.
- No R2 provisioning, credential changes, lifecycle rule, object reads/writes, or
  charges occurred.
- Successful unit checks or synthetic drills do not establish production backup or
  restore success. Update the authoritative production status only with dated,
  target-specific evidence after authorized work.

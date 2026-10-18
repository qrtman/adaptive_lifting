# Documentation index and maintenance policy

## Authoritative current documents

- [Production status](PRODUCTION_STATUS.md): dated production state, completed
  evidence, remaining gates, and constraints. Update this after production
  changes.
- [System architecture](../architecture.md): stable selected architecture,
  application boundaries, domain rules, math, security, and offline behavior.
- [Product design](../design.md): canonical UI and interaction contracts.
- [Production cutover](../supabase/PRODUCTION_CUTOVER.md): one coherent release
  sequence and its safety gates. It points to the status page instead of
  maintaining a second copy of changing status.
- [Supabase runtime](../supabase/README.md): backend boundaries, migration
  history, and local verification commands.
- [Cloudflare deployment](cloudflare-workers.md): Worker configuration and
  deployment procedure.
- [Email verification](email-verification.md) and
  [production email readiness](production-email-readiness.md): behavior and
  provider-specific release gate.
- [Supabase Realtime implementation](../supabase/REALTIME_SPIKE.md) and
  [production Realtime E2E](../supabase/bootstrap/PRODUCTION_REALTIME_E2E.md):
  implementation evidence and live test procedure.
- [Production recovery](production-recovery.md): backup requirements, recovery
  evidence, and unresolved method selection.
- [Billing and voucher operations](launch-runbook.md): operator-only billing
  and voucher safeguards; not a production release checklist.

`README.md` is the short project entry point. `knowledge.md` is compressed
agent context and must stay aligned with these sources. `AGENTS.md` describes
work process and repository constraints; it does not override architecture or
production evidence.

## Documentation maintenance policy

1. Put stable system decisions in `architecture.md`; put visual and interaction
   rules in `design.md`. Do not use a dated audit as the source of current
   architecture.
2. Put changing production state in `PRODUCTION_STATUS.md`. After a deployment,
   record the date, exact project/environment, commit or deployed version,
   checks performed, results, and limits. Secret values never belong in docs.
3. Put actionable release procedures in the relevant runbook. Link to the
   status page rather than copying its mutable checklist into multiple files.
4. Mark replaced decisions **SUPERSEDED**, and experiments **HISTORICAL** or
   **NOT SELECTED** at the top of the document. State the replacement decision
   and link to its authority. Preserve evidence that remains useful for audit,
   recovery, security, or implementation history.
5. A proposal does not become a requirement by being detailed, tested with
   synthetic data, or present in source control. Only an explicit accepted
   decision changes the selected architecture or launch path.
6. Before changing documentation, check inbound links and operational
   references. Remove a document only when it has no unique evidence, procedure,
   or reference value; otherwise label and index it.

## Historical and superseded records

These documents remain available as dated evidence. They are not a second
current plan:

- [Production readiness audit](../supabase/PRODUCTION_READINESS_AUDIT.md):
  superseded by the fresh production decision and current status page.
- [Staging validation](../supabase/STAGING_VALIDATION.md): staging-only
  evidence; it does not prove current production behavior.
- [Serverless migration feasibility](serverless-migration-feasibility.md):
  pre-decision hosting exploration; its Python/Modal/Pages candidates were not
  selected.
- [Bootstrap and import rehearsal](../supabase/bootstrap/README.md) and
  [synthetic import rehearsal](../supabase/bootstrap/IMPORT_REHEARSAL.md):
  engineering evidence, not permission to import historical data or rerun
  production setup.
- [Production recovery](production-recovery.md) contains synthetic test
  results and unselected backup proposals. R2, hosted workflows, local
  PostgreSQL, and VeraCrypt are not approved production recovery methods.
- [Email implementation report](email-verification-report.md): historical
  implementation snapshot, not current production status.
- [Email staging validation](email-verification-staging-validation.md):
  staging-specific test evidence.
- [Realtime prototype](../supabase/REALTIME_SPIKE.md): implementation and
  staging evidence; production remains gated as stated in
  [PRODUCTION_STATUS.md](PRODUCTION_STATUS.md).
- [Stripe webhook notes](stripe-webhooks.md): integration behavior; billing
  remains disabled until its separate activation gate passes.

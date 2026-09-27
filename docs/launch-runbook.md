# Billing launch runbook

This runbook covers Stripe subscriptions and manually verified prepaid vouchers. A browser return from Checkout never grants access. Signed Stripe subscription webhooks update `Subscription`; voucher redemption creates `AccessGrant`; the entitlement resolver reads both.

## Release gate

Record the release commit, operator, time, staging URL, Stripe account and mode, voucher-secret fingerprint, latest verified backup/restore, and each smoke-test result in the private operations log. **Do not enable live charges until every Stripe test-mode scenario below has been exercised against a reachable staging deployment.** Keep test and live Stripe objects, keys, Prices, and webhook secrets separate.

1. Confirm the repository and deployment image match the release commit. Run `pytest`, `npm test`, `npm run lint` (TypeScript), `npm run build`, and `git diff --check`.
2. Obtain a PostgreSQL backup and verify a disposable restore before migrations. Record recovery point and retention location. Back up secrets separately through the secret manager.
3. Set the variables below through the deployment secret manager. Check restrictive `.env.production` permissions if Compose uses that file; never commit it. Run `python -m backend.manage_user billing-status coach@example.com` and compare the voucher fingerprint with the private operations record.
4. Run `docker compose run --rm migrate` (the Compose `api` service waits for successful migration). Check `alembic -c alembic.ini current` equals the checked-in head. The API also fails startup if the revision differs; it never auto-migrates.
5. Deploy API, worker, and Caddy. Confirm HTTPS, secure cookies, Caddy forwarded-IP overwrite, `/api/health`, login, and `billing-status`. Keep the API private to the Compose network.
6. Configure the signed Stripe webhook at `https://<APP_DOMAIN>/api/billing/stripe/webhook` for `customer.subscription.created`, `.updated`, and `.deleted`. Confirm the configured Price IDs and Portal catalog use the same account and mode. Production Compose defaults to `APP_ENV=production` and `.env.production`. For a separate staging host use `DEPLOY_APP_ENV=staging`, `DEPLOY_ENV_FILE=.env.staging`, and `docker compose --env-file .env.staging ...`; that file must contain test-mode values and `STRIPE_EXPECT_LIVEMODE=false`. Production requires `STRIPE_EXPECT_LIVEMODE=true`.
7. Complete the test-mode and voucher smoke tests below. Record Stripe event IDs, local subscription status, entitlement values, and `billing-status` output. Never record Checkout URLs, voucher codes, or secrets in logs/tickets.

### Required configuration

| Variable | Rule |
| --- | --- |
| `DATABASE_URL` | Persistent PostgreSQL; credential may rotate in coordination with deployment. |
| `JWT_SECRET_CURRENT`, optional `JWT_SECRET_PREVIOUS` | Stable while issued sessions need verification; rotate with the previous-key window. |
| `INTEGRATION_ENCRYPTION_KEY` | Stable while encrypted integration credentials exist; rotation requires re-encryption. |
| `VOUCHER_BILLING_ENABLED`, `VOUCHER_CODE_SECRET` | Explicitly enable vouchers. The independent key must be random, at least 32 UTF-8 bytes, and stable while any issued voucher is outstanding. |
| `STRIPE_BILLING_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Enable only with matching account/mode; coordinate provider key and webhook-secret rotations. |
| `STRIPE_PRICE_COACH_STARTER`, `STRIPE_PRICE_COACH_PRO`, `STRIPE_PRICE_COACH_UNLIMITED` | Three distinct recurring Price IDs from that account and mode. |
| `STRIPE_EXPECT_LIVEMODE` | `false` for staging, `true` for production. Webhook mode is checked independently of key prefixes. |
| `APP_URL`, `APP_DOMAIN`, `CORS_ALLOWED_ORIGINS`, `COOKIE_SECURE` | Exact HTTPS origin/domain and secure cookies. Checkout/Portal redirects use the configured origin only. |

`VOUCHER_CODE_SECRET` is **durable production data**. Losing it makes outstanding unredeemed vouchers unverifiable. Store it in the secret manager and secure disaster-recovery records; copy it into a restore environment only through the same controlled process. Record only the 12-hex-character SHA-256 fingerprint from `billing-status` in the operations log. A changed fingerprint after deployment is a stop condition. Do not put the raw key in Git, database backups, documentation, CI output, or shell history. Do not rotate it while issued vouchers remain outstanding; multi-key verification would require a separate design.

## Shared voucher attempt limit

PostgreSQL table `voucher_redemption_limits` is the shared enforcement point across API instances. The endpoint counts authenticated redemption attempts by hashed client IP and hashed account ID, with **5 attempts per UTC minute and 20 per UTC hour** for each fixed window. Counters use atomic conditional writes and a unique subject key. A blocked attempt returns HTTP 429 / `VOUCHER_RATE_LIMITED`; a limiter database failure fails redemption closed with 503. The prior process-local auth throttle remains for unrelated auth paths. Monitor table growth; each distinct subject leaves one counter row until a separate reviewed retention cleanup is scheduled.

Caddy overwrites `X-Forwarded-For` with its observed remote address before Uvicorn processes it. Do not expose Uvicorn directly to the internet or place an untrusted proxy between Caddy and clients. For a new upstream proxy/CDN, configure trusted client-IP handling and repeat the two-instance rate test; otherwise Caddy may see only the proxy IP. Run the PostgreSQL test `PHASE4D_POSTGRES_URL=<disposable URL> pytest backend/test_postgres_billing_readiness.py -q`, which opens independent connections and proves five of ten concurrent attempts are accepted. Check a real deployment with six invalid attempts from one authenticated coach/IP and verify the sixth gets 429; then use another API instance and confirm the same cap. Do not use production vouchers for this test.

## Stripe test-mode rehearsal

Use a **reachable HTTPS staging deployment**, real test-mode Prices and webhook signing secret, and fresh coach accounts. Complete hosted Checkout using a [Stripe test payment method](https://docs.stripe.com/testing). Do not create local `Subscription` rows or edit entitlements. Stripe's [test clocks](https://docs.stripe.com/billing/testing/test-clocks) can help when the account and customer setup supports them; record any scenario that cannot be advanced with the current app flow.

| Scenario | Actions and evidence |
| --- | --- |
| Starter | Register/promote fresh coach, open Starter Checkout, pay in test mode. Verify trusted customer mapping, processed `customer.subscription.*` event, one local ACTIVE Subscription, `/api/account/access` Starter and `maxActiveAthletes=5`, linked-athlete programming, and billing panel. |
| Pro | Repeat on a separate coach. Verify `maxActiveAthletes=25`, analytics and integrations enabled, and actual endpoint access rather than just displayed plan text. |
| Cancel at period end | Open Customer Portal from active Pro; cancel at period end. Verify webhook, `cancel_at_period_end`, access still active before period end, UI cancellation date, and one subscription. |
| Payment failure/grace | Use Stripe's documented test-mode failed-payment scenario for the configured subscription. Verify provider status maps to `PAST_DUE`, warning appears, configured grace remains active, and access ceases after a supported time advance. Existing manual grants must continue to work. Record an untested grace-expiry step if test clocks cannot be attached to the app-created customer. |
| Plan changes | In Portal, switch Starter to Pro then Pro to Starter, if Portal catalog permits. Verify each webhook Price maps to local plan and actual capabilities, including provider timing for downgrade. |
| Checkout reservation | Open Checkout, refresh and retry the same plan; confirm one Stripe session and resumed URL. Try another plan and confirm a block. Expire the provider Session, then confirm a new attempt is allowed. |
| Retry and mapping failure | In Stripe test Dashboard, resend a processed event ID; verify one effective mutation/audit transition. Exercise an unknown customer or Price in a controlled fixture, inspect `FAILED` inbox/logs, fix mapping/config, and resend; confirm eventual `PROCESSED`. |

Stripe's [event delivery and retries](https://docs.stripe.com/webhooks/process-undelivered-events) are the recovery path for transient webhook failures. The `webhook_events` unique event ID and transactional processing make repeats idempotent. For mapping failures, resolve the trusted `BillingCustomer` or Price mapping first, then resend the exact event. Never infer a workspace from email or Checkout metadata.

## Voucher rehearsal

After verifying the manual payment outside the app, use a fresh coach and a test-only reference:

```sh
python -m backend.manage_user create-voucher coach@example.com --plan coach_pro --days 90 --payment-reference TEST-REHEARSAL-001
python -m backend.manage_user show-voucher --code 'VCH-...'
python -m backend.manage_user billing-status coach@example.com
```

The plaintext appears once in operator output. Confirm it is absent from `vouchers`, `audit_events`, and application logs. Redeem through the real coach UI, then verify one `offline_payment` grant, Pro entitlement, 25-athlete limit, programming, analytics, and integrations. Create and redeem two 30-day Pro vouchers: the second grant starts at the first expiry. Redeem a Starter voucher: it starts immediately, while Pro remains effective when active. Revoke only an **unredeemed** test voucher with `python -m backend.manage_user revoke-voucher 'VCH-...'`; a redeemed grant is handled separately.

On separate test coaches, verify active Stripe Starter + voucher Pro yields Pro, active Stripe Pro + voucher Starter yields Pro, and a still-valid voucher supplies fallback after Stripe access ends. Stripe state must never change during voucher redemption. Rate-limit tests use invalid random codes and expect the safe 429 message.

## Backup and restore

Use the managed PostgreSQL backup schedule and encrypted storage. A manual custom-format backup can be made with `pg_dump -Fc -f <protected-backup-path>` after host, database, user, and password are supplied through protected `PG*` environment variables from the secret manager. Restrict the file; verify its size and exit status. A database backup includes users, workspaces, grants, subscriptions, billing customers, checkout reservations, vouchers, webhook inbox, audits, rosters, and athlete-owned plans. It **does not** include `VOUCHER_CODE_SECRET` or Stripe/JWT/integration secrets.

Restore into a fresh disposable PostgreSQL database with `createdb` and `pg_restore -d <disposable-db> <protected-backup-path>`. Check `alembic -c alembic.ini current`, API startup, coach login, workspace/access, roster, athlete-owned plan, subscription, grant, customer, checkout, webhook history, and audits. Redeem an outstanding **test** voucher with the original key, and confirm the same code fails verification with a different key in a disposable copy. Never run the wrong-key test against production. The repeatable Docker verification is:

```sh
PHASE4D_POSTGRES_URL=<disposable-local-postgres-url> LAUNCH_PG_CONTAINER=launch-readiness-pg16 \
  python -m scripts.verify_pg_backup_restore
```

That script accepts only a localhost `launch_*` source database and a `launch-*` container. It creates disposable sample billing/training data, performs `pg_dump`/`pg_restore`, checks startup/login and Alembic head, verifies the secret dependency, and removes its restored database. Record the result and backup timestamp. A successful dump without a restored login and voucher verification is **not** a passed backup rehearsal.

## Reconciliation, alerts, and recovery

`python -m backend.manage_user billing-status coach@example.com` is read-only: it shows effective plan, grants, vouchers, customer mapping, subscription, checkout, athlete usage, failed Stripe webhook count, stale `CREATING` count, and voucher-secret fingerprint. Compare Stripe Dashboard customer/subscription/Price/status to local state; do not overwrite local state from a browser return. Safe logs carry workspace/event/voucher IDs and plans, never secrets, full Checkout URLs, or voucher plaintext.

Alert on repeated `Stripe webhook processing failed`, `Stripe webhook mapping failed`, unknown Price/customer, rising `FAILED` webhook count, stale `CREATING` older than 23 hours, changed or absent voucher fingerprint, migration failure, failed backup, or failed restore rehearsal. Send alerts from the deployed log/backup platform; this repository does not install a monitoring service. Review rate-limit 429 spikes for abuse or a proxy-IP mistake.

For a stale `CREATING` Checkout, obtain workspace and reservation identifiers with `billing-status`. Inspect Stripe's customer and Checkout Sessions using trusted IDs, then inspect subscriptions and webhook delivery. If a Session exists, confirm its provider status; if a subscription exists, reconcile through the signed webhook. If provider evidence proves no usable Session or subscription remains, resolve the reservation with an audited operator procedure before a new Checkout. **Never blindly clear a stale reservation or open a second Session after the conservative Stripe idempotency window.** Preserve the original request ID and event history for support.

If the voucher secret is missing or fingerprint changes, stop voucher issuance/redemption, restore the original key from the secret manager, restart, and verify the fingerprint before testing an outstanding code. If the key is irrecoverable, outstanding codes cannot be verified; handle affected customers through a controlled new issuance process after payment records are reviewed. Do not silently generate a replacement key.

## Rollback and post-deploy smoke test

Application rollback and database downgrade are separate operations. Once billing data exists, preserve `Subscription`, `WebhookEvent`, `Voucher`, `AccessGrant`, and `AuditEvent` data; prefer a forward code fix. Do not run a destructive Alembic downgrade on a live database. If code must roll back, first check old code/schema compatibility on a restored copy and keep billing disabled if compatibility is uncertain.

After deployment: register/login, coach access, athlete link, program edit, test-mode Stripe Checkout and webhook entitlement, Customer Portal, voucher redemption, analytics, Google Sheets entitlement behavior, logout/login, and `billing-status`. Record each result, owner, and follow-up ticket for any failed step. Live-mode configuration remains blocked until this smoke test and the Stripe scenarios above pass on staging.

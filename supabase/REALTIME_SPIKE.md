# Realtime application-session prototype

## Architecture

Adaptive Lifting remains the authentication source of truth:

```text
Adaptive Lifting app JWT and DB session
  -> existing Edge app-auth and eligibility checks
  -> verify workout ownership
  -> issue a separate 60-second ES256 Realtime JWT
  -> private Broadcast channel for that workout
```

The Realtime token uses the staging project's Current imported ES256 key,
`kid=ce24a866-49d1-4f0e-bde5-9c5e05a70210`, and the restricted
`al_realtime_subscriber` role. It contains the application user as `sub`,
`app_user_id`, `workout_id`, `rt_topic`, `purpose`, `iat`, `exp`, and
`jti`. It is not an Adaptive Lifting API credential. Supabase Auth is not used
and SSE remains in place.

`POST /api/realtime/token` reuses shared app-session validation and checks
`workouts.owner_id` through `al_edge_catalog_runtime` before minting. The
private JWK is configured only as Edge Function secret
`REALTIME_JWT_PRIVATE_JWK`; no secret value is stored in this repository.

Migration
[`20261002152646_realtime_private_broadcast_subscriber.sql`](migrations/20261002152646_realtime_private_broadcast_subscriber.sql)
creates a NOLOGIN, NOINHERIT, non-escalating role with no application-table
access and a receive-only `realtime.messages` policy scoped to Broadcast and
the exact token workout. Supabase already had RLS enabled on
`realtime.messages`; the migration does not change it. The app DB runtime
receives only `workouts(id,owner_id,deleted_at)` for ownership checks.

The role has no direct sequence grants, no CREATE, no ownership, and no
application-table access. Effective ACL inspection found PUBLIC rights on
Supabase's shared `net.http_request_queue_id_seq` and cron job/run sequences;
the role has no USAGE on `net` or `cron`, so it cannot address those
objects. Those project-wide extension ACLs were not changed.

## Staging validation

The staging project uses imported ES256 signing key
`ce24a866-49d1-4f0e-bde5-9c5e05a70210`. **Allow public access to channels is
now OFF in staging.** Live retests confirmed:

- A valid Adaptive Lifting session received a 60-second Realtime token and
  joined its exact private workout topic.
- A no-token client using `private: false` was rejected. Realtime logs recorded
  `PrivateOnly: This project only allows private channels`.
- A no-token private join and a token presented to the wrong workout topic were
  denied; the latter returned `CHANNEL_ERROR`.
- A second eligible synthetic user could not request the first user's workout
  token (HTTP 403).
- A normal Adaptive Lifting app JWT could not directly join Realtime
  (`JwtSignatureError`).
- A Realtime token was rejected by `/api/analytics/catalog` (401); the public
  Data API refused `workouts` access (403).
- The private owner channel joined successfully. A temporary INSERT grant and
  exact-topic INSERT policy were used only to send one client Broadcast with
  self-receive enabled. The subscribed private channel received it. The grant
  and temporary policy were then removed; the durable subscriber remains
  receive-only.
- A separate SQL `realtime.send` probe inserted a private message row but did
  not reach the connected listener during this retest. That path is not counted
  as a passing server-originated Broadcast. The prototype's required
  authorized private subscription and Broadcast receive were validated through
  the WebSocket client path.
- In the earlier controlled expiry/revocation run, an expired token could not
  start a new subscription, and a revoked app session could not obtain a new
  Realtime token (401). An already-issued token reconnected and received
  Broadcast until expiry. PostgreSQL recorded app-session revocation at
  `2026-10-02 15:54:27.475952 UTC`; token expiry was about 49.5 seconds later.
  The reconnected channel closed at expiry, with no later Broadcast observed.
  This is the measured window from that test, not a general guarantee.
- `setAuth()` refresh was exercised in the earlier run; a subsequent Broadcast
  was received.

The final API Edge deployment is version 14. Its health route returned HTTP
200 with `{"status":"ok"}`; the temporary fixture-token route returns 404.
All synthetic `stg-realtime-*` users, sessions, workouts, and messages were
deleted and verified absent. The temporary INSERT policy was removed and
`al_realtime_subscriber` has no INSERT privilege. Only the intended role,
receive policy, token issuer, tests, and documentation remain.

No frontend or production routes changed; no production resources or paid
features were touched; the existing SSE path is unchanged.

Official references: [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
[Broadcast](https://supabase.com/docs/guides/realtime/broadcast),
[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys),
[`setAuth()`](https://supabase.com/docs/reference/javascript/setauth).

# Production Realtime end-to-end verification

Status: **NOT VERIFIED**. This procedure is separate from database migrations
and rollback-only SQL checks. Do not run it until the production API and
Realtime configuration have been deployed and separately authorized.

The earlier production SQL probe failed when it inserted directly into
`realtime.messages`: no managed partition existed for the row timestamp.
That table is partitioned by `inserted_at`; an unused project's empty
partition list does not mean the application migration or policy is missing.
Do not create partitions manually. `managed-realtime-inspect.sql` reads the
table, policy, role, grants, and partition metadata without changing them.

## Preconditions

- Production API serves `POST /api/realtime/token` and has the matching
  `REALTIME_JWT_PRIVATE_JWK` configured as an Edge Function secret.
- The production project's signing-key verification configuration accepts the
  corresponding ES256 key, and public channel access is disabled.
- A legitimate owner test account can sign in through the Adaptive Lifting
  application and owns an ordinary test workout. A second legitimate,
  unrelated account is available for isolation checks. Create and remove test
  data through supported application flows; do not insert fixture identities
  or grant extra database privileges.
- The project Realtime URL is available to the test client. Keep the app
  session cookie and the short-lived Realtime token in memory only.

## Test cases

1. Sign in as the workout owner in the production application. From that
   authenticated same-origin session, call `POST /api/realtime/token` with
   `{"workout_id":"<owned-workout-id>"}`. Require HTTP 200, `Cache-Control:
   no-store`, topic exactly `workout:<owned-workout-id>`, and an expiry about 60
   seconds after issuance. Do not print or save the returned token.
2. Configure a Supabase Realtime client with the production Realtime URL. Call
   `setAuth()` with that response's token, then join exactly the returned topic
   as a private Broadcast channel. Require `SUBSCRIBED`. Record status and
   timestamps only. The subscriber role is receive-only; do not add a database
   INSERT grant or policy to manufacture a message.
3. While signed in as the unrelated account, request a token for the owner's
   workout. Require HTTP 403. This checks the API ownership gate.
4. With the owner's valid token, attempt a private subscription to a different
   workout topic. Require Realtime to reject the join (`CHANNEL_ERROR` or an
   equivalent explicit authorization failure). Do not treat a timeout or
   transport outage as an authorization denial.
5. Attempt a private subscription without a Realtime token and a direct join
   using the ordinary Adaptive Lifting app session token. Require both to be
   rejected. Never set a public-channel option.
6. If supported by the deployed client, verify that a newly requested token is
   denied after the app session is revoked and that an expired Realtime token
   cannot start a new subscription. Keep token expiry distinct from immediate
   app-session revocation: an already issued 60-second capability remains
   valid until its own expiry.

## Evidence and cleanup

Record the project reference, API build/version, test account identifiers in
redacted form, workout identifier in redacted form, UTC timestamps, HTTP
status codes, channel status codes, and whether a cross-user join was denied.
Never record cookies, Authorization values, the JWK, or a Realtime token.

Remove only test workouts created through the application, using supported
application actions, then confirm no test accounts or workouts remain. Do not
change managed partition ownership, create partitions manually, add temporary
policies/grants, or alter RLS. The end-to-end status remains **NOT VERIFIED**
until the authenticated owner subscription succeeds and all forbidden and
cross-user cases are observed against the deployed production services.

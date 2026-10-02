# Realtime with application sessions: research spike

**Conclusion:** Supabase Auth is not technically required for private
Broadcast/Presence channels. Supabase accepts JWTs minted with an imported
project signing key; supported third-party providers are another option. This
application's current HS256 JWT is **not** a Realtime credential: it uses
independent current/previous application keys, an application role (`ATHLETE` or
`COACH`), and no Supabase-compatible `role` claim. The Edge Function's
`verify_jwt = false` setting does not change Realtime's JWT verification.

**Supported design to prototype next:** After validating the existing HttpOnly
cookie, current/previous JWT key, live `sessions` row, account eligibility, and
current plan link, issue a separate short-lived Realtime JWT signed by a key the
Supabase project trusts. Give it a restricted Postgres role, user/session
identity, and only the intended channel scope. Set the token with the Realtime
client's `setAuth` or `accessToken` callback, then join a `private: true`
channel. Authorize send/receive through `realtime.messages` RLS using claims and
topic. Disable public channel access for the prototype. Keep application-table
access closed to browser roles.

**Security limits:** A normal application JWT cannot simply be sent to Realtime
or treated as a Supabase Auth session. `authenticated` alone is not
authorization. Realtime caches a channel's RLS decision until token refresh or
expiry, so session revocation and coach unlink may remain effective on an
existing connection until the short token expires. A separate token is therefore
required for this model, with a short TTL, refresh through the authoritative
application session, and measured revocation delay. Avoid granting
`anon`/`authenticated` broad access to `users`, `sessions`, or workout tables to
implement channel policy.

**Next prototype:** In an isolated local or staging Supabase project, mint a 1-2
minute token from a validated application session with an imported signing key;
add a topic-specific `realtime.messages` read policy; test allowed athlete,
linked coach, unrelated user, revoked session, unlink, token expiry, and
refresh. Do not move SSE or application authentication in this milestone.

Sources:
[Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization),
[JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys),
[Third-party auth](https://supabase.com/docs/guides/auth/third-party/overview),
[Realtime setAuth](https://supabase.com/docs/reference/javascript/setauth).

-- Per-account password login limiting.
--
-- The existing per-address bucket (20 attempts / 60 s) is kept. This adds a
-- second bucket keyed by a SHA-256 of the normalized email, counting only
-- failed attempts: 10 failures inside a fixed 15-minute window deny further
-- attempts with the same generic rate_limited denial the address bucket uses.
-- Unknown emails are counted and run a dummy bcrypt compare, so neither the
-- response nor its timing reveals whether an account exists. Each credential
-- failure writes a LOGIN_FAILED audit event carrying only the email hash.
-- The raw email is never stored by this table or the audit event.

create table if not exists public.auth_login_failures (
  subject_hash text primary key check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamp without time zone not null,
  failure_count integer not null check (failure_count >= 0),
  updated_at timestamp without time zone not null
);
create index if not exists ix_auth_login_failures_updated
  on public.auth_login_failures(updated_at);

alter table public.auth_login_failures enable row level security;
revoke all on public.auth_login_failures
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;

create or replace function al_private.al_auth_login(
  p_email text,
  p_password text,
  p_subject_hash text,
  p_session_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user public.users%rowtype;
  v_user_found boolean := false;
  v_count integer;
  v_email text;
  v_email_hash text;
  v_failures integer;
  v_window timestamp without time zone;
  v_password_ok boolean := false;
  v_stored text;
begin
  if p_email is null or p_password is null or p_session_id is null or p_session_id = ''
     or pg_catalog.length(p_session_id) > 255 or p_subject_hash is null
     or p_subject_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  -- Per-address bucket (unchanged): every attempt counts.
  insert into public.auth_security_subjects(subject_hash, updated_at)
    values (p_subject_hash, v_now) on conflict (subject_hash) do nothing;
  perform 1 from public.auth_security_subjects where subject_hash = p_subject_hash for update;
  delete from public.auth_security_events
   where subject_hash = p_subject_hash and created_at <= v_now - interval '60 seconds';
  select pg_catalog.count(*)::integer into v_count
    from public.auth_security_events where subject_hash = p_subject_hash;
  if v_count >= 20 then
    return pg_catalog.jsonb_build_object('denial', 'rate_limited');
  end if;
  insert into public.auth_security_events(id, subject_hash, created_at)
    values (extensions.gen_random_uuid()::text, p_subject_hash, v_now);
  update public.auth_security_subjects set updated_at = v_now where subject_hash = p_subject_hash;

  -- Per-account bucket: keyed by the normalized email hash whether or not an
  -- account exists. The row lock serializes concurrent guesses per account.
  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_email_hash := pg_catalog.encode(extensions.digest('auth:login:email:' || v_email, 'sha256'), 'hex');
  -- Bounded opportunistic cleanup of long-expired windows (unknown emails too).
  delete from public.auth_login_failures where subject_hash in (
    select f.subject_hash from public.auth_login_failures f
     where f.updated_at < v_now - interval '1 day' and f.subject_hash <> v_email_hash
     limit 50 for update skip locked);
  insert into public.auth_login_failures(subject_hash, window_started_at, failure_count, updated_at)
    values (v_email_hash, v_now, 0, v_now) on conflict (subject_hash) do nothing;
  select failure_count, window_started_at into v_failures, v_window
    from public.auth_login_failures where subject_hash = v_email_hash for update;
  if v_window <= v_now - interval '15 minutes' then
    v_failures := 0;
    v_window := v_now;
    update public.auth_login_failures
       set failure_count = 0, window_started_at = v_now, updated_at = v_now
     where subject_hash = v_email_hash;
  end if;
  if v_failures >= 10 then
    return pg_catalog.jsonb_build_object('denial', 'rate_limited');
  end if;

  select * into v_user from public.users
   where pg_catalog.lower(email) = v_email
   order by id limit 1;
  v_user_found := found;

  if pg_catalog.octet_length(p_password) <= 72 then
    if v_user_found and v_user.deleted_at is null and v_user.hashed_password is not null then
      -- pgcrypto implements bcrypt's $2a$ prefix. Python bcrypt emits $2b$;
      -- normalizing only the prefix preserves the salt/cost/hash bytes.
      v_stored := pg_catalog.replace(v_user.hashed_password, '$2b$', '$2a$');
      v_password_ok := extensions.crypt(p_password, v_stored) is not distinct from v_stored;
    else
      -- Dummy compare at the registration cost so an unknown, deleted, or
      -- passwordless account takes as long as a wrong password.
      perform extensions.crypt(p_password, extensions.gen_salt('bf', 12));
    end if;
  end if;

  if not v_password_ok then
    update public.auth_login_failures
       set failure_count = failure_count + 1, updated_at = v_now
     where subject_hash = v_email_hash;
    -- The caller is unauthenticated, so actor_user_id stays null: a guesser
    -- must not be able to flood the account owner's own audit view.
    insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
      values (extensions.gen_random_uuid()::text, null,
        'LOGIN_FAILED', 'AuthLogin', v_email_hash, v_now,
        pg_catalog.json_build_object('email_hash', v_email_hash,
          'user_id', case when v_user_found then v_user.id else null end,
          'address_hash', p_subject_hash, 'reason', 'invalid_credentials')::text);
    return pg_catalog.jsonb_build_object('denial', 'invalid_credentials');
  end if;

  -- Correct password: clear the account's failure window.
  delete from public.auth_login_failures where subject_hash = v_email_hash;

  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy_email_verification, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then
    return pg_catalog.jsonb_build_object('denial', 'account_ineligible');
  end if;

  insert into public.sessions(id, user_id, jwt_id, expires_at, revoked_at)
    values (p_session_id, v_user.id, p_session_id, v_now + interval '7 days', null);
  return pg_catalog.jsonb_build_object(
    'denial', null, 'id', v_user.id, 'email', v_user.email,
    'role', v_user.role, 'displayName', v_user.display_name,
    'expiresEpoch', extract(epoch from (v_now + interval '7 days'))::bigint
  );
end;
$function$;

revoke all on function al_private.al_auth_login(text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function al_private.al_auth_login(text,text,text,text,boolean) to al_edge_catalog_runtime;

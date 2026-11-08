-- Password reset (forgot) and authenticated password change for custom
-- application accounts. Supabase Auth is intentionally not used.
--
-- Reset tokens follow the email-verification pattern: 32 random bytes,
-- SHA-256 hash only at rest, single use, 30-minute expiry. The raw token only
-- exists inside Fernet-encrypted integration_outbox payloads (Vault key
-- adaptive_lifting_email_payload_encryption_key) until the email worker
-- delivers it. Jobs use provider 'password-reset' and are claimed only by the
-- functions below; the verification and Google Sheets claimers filter on their
-- own providers and never see them.
--
-- A successful reset or change replaces the bcrypt hash, revokes every
-- application session of the account (which also invalidates every offline
-- grant at its next online revalidation, because grants are bound to a
-- session id), invalidates pending reset links, and writes an audit event.

create table if not exists public.password_reset_tokens (
  id varchar primary key,
  user_id varchar not null references public.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamp without time zone not null,
  expires_at timestamp without time zone not null,
  consumed_at timestamp without time zone,
  invalidated_at timestamp without time zone,
  constraint ck_password_reset_token_expiry check (expires_at > created_at)
);
create index if not exists ix_password_reset_tokens_user_created
  on public.password_reset_tokens(user_id, created_at desc);
create unique index if not exists uq_password_reset_token_active_user
  on public.password_reset_tokens(user_id)
  where consumed_at is null and invalidated_at is null;

alter table public.password_reset_tokens enable row level security;
revoke all on public.password_reset_tokens
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;

alter table public.integration_outbox
  add column if not exists password_reset_token_id varchar
  references public.password_reset_tokens(id) on delete set null;
create index if not exists ix_integration_outbox_password_reset_token_id
  on public.integration_outbox(password_reset_token_id);
create index if not exists ix_password_reset_outbox_due
  on public.integration_outbox(status, retry_after, id)
  where provider = 'password-reset';

-- Shared private helpers ----------------------------------------------------

create or replace function al_private.al_password_policy_ok(p_password text)
returns boolean language sql immutable security definer set search_path = ''
as $function$
  select p_password is not null
    and pg_catalog.char_length(p_password) >= 8
    and pg_catalog.octet_length(p_password) <= 72;
$function$;

create or replace function al_private.al_password_reset_cancel_pending(
  p_user_id text, p_now timestamp without time zone
) returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_ids text[];
begin
  select coalesce(pg_catalog.array_agg(t.id), array[]::text[]) into v_ids
  from public.password_reset_tokens t
  where t.user_id = p_user_id and t.consumed_at is null and t.invalidated_at is null;
  if pg_catalog.cardinality(v_ids) = 0 then return; end if;
  update public.password_reset_tokens set invalidated_at = p_now
    where id = any(v_ids) and consumed_at is null and invalidated_at is null;
  update public.integration_outbox set encrypted_payload = null, status = 'cancelled',
      retry_after = null, claim_token = null, result = 'Password reset no longer eligible'
    where provider = 'password-reset' and password_reset_token_id = any(v_ids)
      and status <> 'success';
end;
$function$;

-- Replaces the hash, revokes all sessions and pending reset links, audits.
-- Callers must already hold the password-reset-user advisory lock and the
-- users row lock.
create or replace function al_private.al_password_apply(
  p_user_id text, p_new_password text, p_event_type text, p_now timestamp without time zone
) returns integer language plpgsql volatile security definer set search_path = ''
as $function$
declare v_revoked integer;
begin
  update public.users
     set hashed_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
         updated_at = p_now
   where id = p_user_id and deleted_at is null;
  update public.sessions set revoked_at = p_now
   where user_id = p_user_id and revoked_at is null;
  get diagnostics v_revoked = row_count;
  perform al_private.al_password_reset_cancel_pending(p_user_id, p_now);
  insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
  values (extensions.gen_random_uuid()::text, p_user_id, p_event_type, 'User', p_user_id, p_now,
    pg_catalog.json_build_object('sessions_revoked', v_revoked, 'offline_grants', 'invalidated_on_revalidation')::text);
  return v_revoked;
end;
$function$;

-- Forgot password -------------------------------------------------------------

-- Every outcome except invalid_request/email_config_unavailable returns
-- {"denial": null}; the Edge route replies 202 with one generic message for
-- unknown, ineligible, throttled and queued requests alike.
create or replace function al_private.al_password_forgot(
  p_email text, p_ip_subject_hash text, p_email_subject_hash text,
  p_token_id text, p_outbox_id text, p_token_hash text, p_ciphertext text,
  p_enforce_legacy boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user_id text;
  v_user public.users%rowtype;
  v_latest timestamp without time zone;
  v_recent integer;
begin
  if p_email is null or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     or pg_catalog.length(p_email) > 254 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;
  if p_token_id is null or p_token_id = '' or p_outbox_id is null or p_outbox_id = ''
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_ciphertext is null or p_ciphertext = '' then
    return pg_catalog.jsonb_build_object('denial', 'email_config_unavailable');
  end if;
  -- Per IP (same budget as verification resend) and per email address.
  if not al_private.al_email_rate_allow(p_ip_subject_hash, 20, 60) then
    return pg_catalog.jsonb_build_object('denial', null);
  end if;
  if not al_private.al_email_rate_allow(p_email_subject_hash, 5, 3600) then
    return pg_catalog.jsonb_build_object('denial', null);
  end if;

  select u.id into v_user_id from public.users u
    where pg_catalog.lower(u.email) = p_email and u.deleted_at is null
    order by u.id limit 1;
  if v_user_id is null then return pg_catalog.jsonb_build_object('denial', null); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('password-reset-user:' || v_user_id, 0));
  select * into v_user from public.users u where u.id = v_user_id for update;
  if not found or v_user.deleted_at is not null or pg_catalog.lower(v_user.email) <> p_email then
    return pg_catalog.jsonb_build_object('denial', null);
  end if;
  -- Accounts still pending email verification recover through verification.
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then
    return pg_catalog.jsonb_build_object('denial', null);
  end if;
  -- One issuance per 60 seconds and at most five per rolling 24 hours.
  select t.created_at into v_latest from public.password_reset_tokens t
    where t.user_id = v_user_id order by t.created_at desc, t.id desc limit 1;
  if v_latest > v_now - interval '60 seconds' then
    return pg_catalog.jsonb_build_object('denial', null);
  end if;
  select pg_catalog.count(*)::integer into v_recent from public.password_reset_tokens t
    where t.user_id = v_user_id and t.created_at > v_now - interval '24 hours';
  if v_recent >= 5 then return pg_catalog.jsonb_build_object('denial', null); end if;

  perform al_private.al_password_reset_cancel_pending(v_user_id, v_now);
  insert into public.password_reset_tokens(id, user_id, token_hash, created_at, expires_at, consumed_at, invalidated_at)
    values (p_token_id, v_user_id, p_token_hash, v_now, v_now + interval '30 minutes', null, null);
  insert into public.integration_outbox(id, provider, connection_id, payload_json, status, retry_after,
    attempt_count, result, encrypted_payload, verification_token_id, claim_token, password_reset_token_id)
    values (p_outbox_id, 'password-reset', null, '{}', 'queued', null, 0, null, p_ciphertext, null, null, p_token_id);
  insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, v_user_id, 'PASSWORD_RESET_REQUESTED', 'User', v_user_id, v_now, '{}');
  return pg_catalog.jsonb_build_object('denial', null);
exception when unique_violation then
  return pg_catalog.jsonb_build_object('denial', null);
end;
$function$;

-- Reset with emailed token ---------------------------------------------------

create or replace function al_private.al_password_reset(
  p_token_hash text, p_token_format_valid boolean, p_subject_hash text, p_new_password text
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user_id text;
  v_user public.users%rowtype;
  v_token public.password_reset_tokens%rowtype;
  v_changed integer;
  v_revoked integer;
begin
  if not al_private.al_email_rate_allow(p_subject_hash, 20, 60) then
    return pg_catalog.jsonb_build_object('denial', 'rate_limited');
  end if;
  if not coalesce(p_token_format_valid, false) or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_token');
  end if;
  if not al_private.al_password_policy_ok(p_new_password) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_password');
  end if;
  select t.user_id into v_user_id from public.password_reset_tokens t where t.token_hash = p_token_hash;
  if v_user_id is null then return pg_catalog.jsonb_build_object('denial', 'invalid_token'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('password-reset-user:' || v_user_id, 0));
  select * into v_user from public.users u where u.id = v_user_id for update;
  if not found or v_user.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_token');
  end if;
  select * into v_token from public.password_reset_tokens t
    where t.token_hash = p_token_hash and t.user_id = v_user_id for update;
  if not found or v_token.consumed_at is not null or v_token.invalidated_at is not null
     or v_token.expires_at <= v_now then
    return pg_catalog.jsonb_build_object('denial', 'invalid_token');
  end if;
  update public.password_reset_tokens set consumed_at = v_now where id = v_token.id
    and consumed_at is null and invalidated_at is null and expires_at > v_now;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return pg_catalog.jsonb_build_object('denial', 'invalid_token'); end if;
  update public.integration_outbox set encrypted_payload = null, status = 'cancelled', retry_after = null,
      claim_token = null, result = 'Password reset link used'
    where provider = 'password-reset' and password_reset_token_id = v_token.id and status <> 'success';
  v_revoked := al_private.al_password_apply(v_user_id, p_new_password, 'PASSWORD_RESET', v_now);
  return pg_catalog.jsonb_build_object('denial', null, 'sessionsRevoked', v_revoked);
end;
$function$;

-- Authenticated change -------------------------------------------------------

create or replace function al_private.al_password_change(
  p_actor_user_id text, p_session_id text, p_current_password text, p_new_password text,
  p_user_subject_hash text, p_ip_subject_hash text, p_enforce_legacy boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user public.users%rowtype;
  v_stored text;
  v_revoked integer;
begin
  if p_actor_user_id is null or p_session_id is null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('password-reset-user:' || p_actor_user_id, 0));
  select u.* into v_user from public.users u join public.sessions s on s.user_id = u.id
   where u.id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > v_now
   for update of u;
  if not found or v_user.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then return pg_catalog.jsonb_build_object('denial', 'account_ineligible'); end if;
  -- Current-password guessing: 10 per account per 15 minutes, 20 per IP per minute.
  if not al_private.al_email_rate_allow(p_ip_subject_hash, 20, 60)
     or not al_private.al_email_rate_allow(p_user_subject_hash, 10, 900) then
    return pg_catalog.jsonb_build_object('denial', 'rate_limited');
  end if;
  if not al_private.al_password_policy_ok(p_new_password) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_password');
  end if;
  v_stored := pg_catalog.replace(coalesce(v_user.hashed_password, ''), '$2b$', '$2a$');
  if p_current_password is null or v_stored = ''
     or pg_catalog.octet_length(p_current_password) > 72
     or extensions.crypt(p_current_password, v_stored) is distinct from v_stored then
    return pg_catalog.jsonb_build_object('denial', 'invalid_current_password');
  end if;
  if p_new_password = p_current_password then
    return pg_catalog.jsonb_build_object('denial', 'password_unchanged');
  end if;
  v_revoked := al_private.al_password_apply(p_actor_user_id, p_new_password, 'PASSWORD_CHANGED', v_now);
  return pg_catalog.jsonb_build_object('denial', null, 'sessionsRevoked', v_revoked);
end;
$function$;

-- Delivery worker (same Edge worker and cron as verification) -----------------

create or replace function al_private.al_password_reset_worker_claim(p_claim_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_job public.integration_outbox%rowtype;
begin
  if p_claim_token is null or p_claim_token !~ '^[0-9a-f-]{36}$' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_claim');
  end if;
  update public.integration_outbox o set status='cancelled', encrypted_payload=null, retry_after=null,
      claim_token=null, result='Password reset no longer eligible'
    where o.provider='password-reset' and o.status in ('queued','failed','processing')
      and (o.password_reset_token_id is null or exists(
        select 1 from public.password_reset_tokens t join public.users u on u.id=t.user_id
         where t.id=o.password_reset_token_id
           and (t.expires_at <= v_now or t.consumed_at is not null or t.invalidated_at is not null
             or u.deleted_at is not null)));
  update public.integration_outbox o set status='failed', retry_after=null, encrypted_payload=null, claim_token=null,
      result='Worker lease expired after the maximum attempts'
    where o.provider='password-reset' and o.status='processing' and o.attempt_count>=3
      and o.retry_after<=v_now;
  update public.integration_outbox o set encrypted_payload=null
    where o.provider='password-reset' and o.status='failed' and o.attempt_count>=3
      and o.encrypted_payload is not null;

  select * into v_job from public.integration_outbox o
    where o.provider='password-reset' and o.attempt_count<3 and (
      o.status='queued' or (o.status='failed' and (o.retry_after is null or o.retry_after<=v_now))
      or (o.status='processing' and o.retry_after<=v_now))
    order by o.id limit 1 for update skip locked;
  if not found then return pg_catalog.jsonb_build_object('job', null); end if;
  update public.integration_outbox set status='processing', retry_after=v_now+interval '15 minutes',
      attempt_count=v_job.attempt_count+1, claim_token=p_claim_token, result='Delivery in progress'
    where id=v_job.id;
  return pg_catalog.jsonb_build_object('jobId', v_job.id, 'claimToken', p_claim_token);
end;
$function$;

create or replace function al_private.al_password_reset_worker_begin(p_job_id text, p_claim_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_token_id text;
  v_user_id text;
  v_user public.users%rowtype;
  v_job public.integration_outbox%rowtype;
  v_token public.password_reset_tokens%rowtype;
begin
  select o.password_reset_token_id into v_token_id from public.integration_outbox o
    where o.id=p_job_id and o.provider='password-reset' and o.status='processing' and o.claim_token=p_claim_token;
  if v_token_id is null then return pg_catalog.jsonb_build_object('send', false); end if;
  select t.user_id into v_user_id from public.password_reset_tokens t where t.id=v_token_id;
  if v_user_id is null then return pg_catalog.jsonb_build_object('send', false); end if;
  if not pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended('password-reset-user:' || v_user_id, 0)) then
    return pg_catalog.jsonb_build_object('busy', true);
  end if;
  select * into v_job from public.integration_outbox o
    where o.id=p_job_id and o.provider='password-reset' and o.status='processing' and o.claim_token=p_claim_token for update;
  if not found then
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('password-reset-user:' || v_user_id, 0));
    return pg_catalog.jsonb_build_object('send', false);
  end if;
  select * into v_token from public.password_reset_tokens t where t.id=v_job.password_reset_token_id;
  select * into v_user from public.users u where u.id=v_user_id for update;
  if not found or v_user.deleted_at is not null or v_user.email is null or v_token.id is null
     or v_token.consumed_at is not null or v_token.invalidated_at is not null
     or v_token.expires_at <= pg_catalog.timezone('utc', pg_catalog.clock_timestamp())
     or v_job.encrypted_payload is null then
    update public.integration_outbox set status='cancelled', encrypted_payload=null, retry_after=null, claim_token=null,
      result='Password reset no longer eligible' where id=p_job_id and claim_token=p_claim_token;
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('password-reset-user:' || v_user_id, 0));
    return pg_catalog.jsonb_build_object('send', false);
  end if;
  return pg_catalog.jsonb_build_object('send', true, 'userId', v_user_id, 'email', v_user.email,
    'encryptedPayload', v_job.encrypted_payload, 'jobId', p_job_id, 'claimToken', p_claim_token);
end;
$function$;

create or replace function al_private.al_password_reset_worker_finish(
  p_job_id text, p_claim_token text, p_user_id text, p_outcome text
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_attempt integer;
  v_updated integer := 0;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if p_outcome not in ('success','temporary','permanent') then
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('password-reset-user:' || coalesce(p_user_id,''), 0));
    return pg_catalog.jsonb_build_object('updated', false);
  end if;
  select o.attempt_count into v_attempt from public.integration_outbox o
    where o.id=p_job_id and o.provider='password-reset' and o.status='processing'
      and o.claim_token=p_claim_token for update;
  if found then
    if p_outcome='success' then
      update public.integration_outbox set status='success', retry_after=null, encrypted_payload=null,
        claim_token=null, result='Password reset email accepted' where id=p_job_id and claim_token=p_claim_token;
    elsif p_outcome='temporary' and v_attempt<3 then
      update public.integration_outbox set status='failed', retry_after=v_now+pg_catalog.make_interval(mins => 5*v_attempt),
        claim_token=null, result='Email provider temporarily unavailable' where id=p_job_id and claim_token=p_claim_token;
    else
      update public.integration_outbox set status='failed', attempt_count=3, retry_after=null, encrypted_payload=null,
        claim_token=null, result='Email provider rejected delivery' where id=p_job_id and claim_token=p_claim_token;
    end if;
    get diagnostics v_updated = row_count;
  end if;
  perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('password-reset-user:' || coalesce(p_user_id,''), 0));
  return pg_catalog.jsonb_build_object('updated', v_updated=1);
end;
$function$;

create or replace function al_private.al_password_reset_worker_unlock(p_user_id text)
returns boolean language sql volatile security definer set search_path = ''
as $function$
  select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('password-reset-user:' || coalesce(p_user_id,''), 0));
$function$;

-- Privileges -------------------------------------------------------------------

revoke all on function al_private.al_password_policy_ok(text) from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_password_reset_cancel_pending(text, timestamp without time zone) from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_password_apply(text, text, text, timestamp without time zone) from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_password_forgot(text, text, text, text, text, text, text, boolean) from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_password_reset(text, boolean, text, text) from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_password_change(text, text, text, text, text, text, boolean) from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_password_reset_worker_claim(text) from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_password_reset_worker_begin(text, text) from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_password_reset_worker_finish(text, text, text, text) from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_password_reset_worker_unlock(text) from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.al_password_forgot(text, text, text, text, text, text, text, boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_password_reset(text, boolean, text, text) to al_edge_catalog_runtime;
grant execute on function al_private.al_password_change(text, text, text, text, text, text, boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_password_reset_worker_claim(text) to al_edge_catalog_runtime;
grant execute on function al_private.al_password_reset_worker_begin(text, text) to al_edge_catalog_runtime;
grant execute on function al_private.al_password_reset_worker_finish(text, text, text, text) to al_edge_catalog_runtime;
grant execute on function al_private.al_password_reset_worker_unlock(text) to al_edge_catalog_runtime;

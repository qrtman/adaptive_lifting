-- Custom application onboarding, verification delivery, and Google identity.
-- Supabase Auth is intentionally not used. Secrets are provisioned separately.

alter table public.integration_outbox
  add column if not exists claim_token text;

create index if not exists ix_email_verification_outbox_due
  on public.integration_outbox(status, retry_after, id)
  where provider = 'email-verification';

create or replace function al_private.al_email_rate_allow(
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_count integer;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  insert into public.auth_security_subjects(subject_hash, updated_at)
    values (p_subject_hash, v_now)
    on conflict (subject_hash) do update set updated_at = excluded.updated_at;
  perform 1 from public.auth_security_subjects where subject_hash = p_subject_hash for update;
  delete from public.auth_security_events
   where subject_hash = p_subject_hash
     and created_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds);
  select pg_catalog.count(*)::integer into v_count
    from public.auth_security_events where subject_hash = p_subject_hash;
  if v_count >= p_limit then return false; end if;
  insert into public.auth_security_events(id, subject_hash, created_at)
    values (extensions.gen_random_uuid()::text, p_subject_hash, v_now);
  update public.auth_security_subjects set updated_at = v_now where subject_hash = p_subject_hash;
  return true;
end;
$function$;

create or replace function al_private.al_email_payload_encryption_key()
returns text language plpgsql stable security definer set search_path = ''
as $function$
declare v_count bigint; v_secret text;
begin
  select pg_catalog.count(*), pg_catalog.max(s.decrypted_secret)
    into v_count, v_secret
  from vault.decrypted_secrets s
  where s.name = 'adaptive_lifting_email_payload_encryption_key';
  if v_count <> 1 or v_secret is null or pg_catalog.btrim(v_secret) = '' then
    raise exception 'email payload encryption key unavailable' using errcode = '55000';
  end if;
  return v_secret;
end;
$function$;

create or replace function al_private.al_email_worker_internal_secret()
returns text language plpgsql stable security definer set search_path = ''
as $function$
declare v_count bigint; v_secret text;
begin
  select pg_catalog.count(*), pg_catalog.max(s.decrypted_secret)
    into v_count, v_secret
  from vault.decrypted_secrets s
  where s.name = 'adaptive_lifting_email_worker_internal_secret';
  if v_count <> 1 or v_secret is null or pg_catalog.btrim(v_secret) = '' then
    raise exception 'email worker authorization unavailable' using errcode = '55000';
  end if;
  return v_secret;
end;
$function$;

create or replace function al_private.al_email_delivery_config()
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_key_count bigint;
  v_from_count bigint;
  v_url_count bigint;
  v_key text;
  v_from text;
  v_url text;
begin
  select pg_catalog.count(*), pg_catalog.max(s.decrypted_secret)
    into v_key_count, v_key from vault.decrypted_secrets s
    where s.name = 'adaptive_lifting_resend_api_key';
  select pg_catalog.count(*), pg_catalog.max(s.decrypted_secret)
    into v_from_count, v_from from vault.decrypted_secrets s
    where s.name = 'adaptive_lifting_email_from';
  select pg_catalog.count(*), pg_catalog.max(s.decrypted_secret)
    into v_url_count, v_url from vault.decrypted_secrets s
    where s.name = 'adaptive_lifting_email_app_url';
  if v_key_count <> 1 or v_from_count <> 1 or v_url_count <> 1
     or pg_catalog.btrim(coalesce(v_key,'')) = ''
     or pg_catalog.btrim(coalesce(v_from,'')) = ''
     or pg_catalog.btrim(coalesce(v_url,'')) = '' then
    raise exception 'email delivery configuration unavailable' using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object('apiKey',v_key,'emailFrom',v_from,'appUrl',v_url);
end;
$function$;

create or replace function al_private.al_email_cancel_pending(p_user_id text, p_now timestamp without time zone)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_ids text[];
begin
  select coalesce(pg_catalog.array_agg(t.id), array[]::text[]) into v_ids
  from public.email_verification_tokens t
  where t.user_id = p_user_id and t.consumed_at is null and t.invalidated_at is null;
  if pg_catalog.cardinality(v_ids) = 0 then return; end if;
  update public.email_verification_tokens set invalidated_at = p_now
    where id = any(v_ids) and consumed_at is null and invalidated_at is null;
  update public.integration_outbox set encrypted_payload = null, status = 'cancelled',
      retry_after = null, claim_token = null
    where provider = 'email-verification' and verification_token_id = any(v_ids)
      and status <> 'success';
end;
$function$;

create or replace function al_private.al_onboarding_register(
  p_email text, p_password text, p_subject_hash text,
  p_user_id text, p_token_id text, p_outbox_id text,
  p_token_hash text, p_ciphertext text, p_verification_required boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_password_hash text;
begin
  if p_email is null or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     or pg_catalog.length(p_email) > 254 or p_password is null
     or pg_catalog.length(p_password) < 8 or pg_catalog.octet_length(p_password) > 72
     or p_user_id is null or p_user_id = '' then
    return pg_catalog.jsonb_build_object('denial','invalid_request');
  end if;
  if not al_private.al_email_rate_allow(p_subject_hash,10,3600) then
    return pg_catalog.jsonb_build_object('denial','rate_limited');
  end if;

  -- Hash both new and duplicate registration requests before the existence check.
  v_password_hash := extensions.crypt(p_password, extensions.gen_salt('bf',12));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email:' || p_email,0));
  if exists(select 1 from public.users u where pg_catalog.lower(u.email) = p_email) then
    return pg_catalog.jsonb_build_object('denial',null,'created',false);
  end if;
  if coalesce(p_verification_required,true) and (
      p_token_id is null or p_outbox_id is null
      or p_token_hash !~ '^[0-9a-f]{64}$'
      or p_ciphertext is null or p_ciphertext = '') then
    return pg_catalog.jsonb_build_object('denial','email_config_unavailable');
  end if;

  begin
    insert into public.users(id,email,hashed_password,role,email_verification_required,
      email_verification_legacy_exempt,email_verified_at)
    values (p_user_id,p_email,v_password_hash,'ATHLETE',coalesce(p_verification_required,true),false,null);
    if coalesce(p_verification_required,true) then
      insert into public.email_verification_tokens(id,user_id,token_hash,created_at,expires_at,is_resend,consumed_at,invalidated_at)
      values (p_token_id,p_user_id,p_token_hash,v_now,v_now + interval '24 hours',false,null,null);
      insert into public.integration_outbox(id,provider,connection_id,payload_json,status,retry_after,
        attempt_count,result,encrypted_payload,verification_token_id,claim_token)
      values (p_outbox_id,'email-verification',null,'{}','queued',null,0,null,p_ciphertext,p_token_id,null);
    end if;
  exception when unique_violation then
    return pg_catalog.jsonb_build_object('denial',null,'created',false);
  end;
  return pg_catalog.jsonb_build_object('denial',null,'created',true);
end;
$function$;

create or replace function al_private.al_onboarding_resend(
  p_email text, p_subject_hash text, p_token_id text, p_outbox_id text,
  p_token_hash text, p_ciphertext text, p_enforce_legacy boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user_id text;
  v_user public.users%rowtype;
  v_latest timestamp without time zone;
  v_resends integer;
begin
  if not al_private.al_email_rate_allow(p_subject_hash,20,60) then
    return pg_catalog.jsonb_build_object('denial','rate_limited');
  end if;
  select u.id into v_user_id from public.users u
    where pg_catalog.lower(u.email) = p_email order by u.id limit 1;
  if v_user_id is null then return pg_catalog.jsonb_build_object('denial',null); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
  select * into v_user from public.users u where u.id = v_user_id for update;
  if not found or v_user.email <> p_email or v_user.deleted_at is not null
     or v_user.email_verified_at is not null or v_user.google_sub is not null
     or (case when v_user.email_verification_legacy_exempt
         then coalesce(p_enforce_legacy,false)
         else coalesce(v_user.email_verification_required,true) end) is false then
    return pg_catalog.jsonb_build_object('denial',null);
  end if;
  select t.created_at into v_latest from public.email_verification_tokens t
    where t.user_id = v_user_id order by t.created_at desc,t.id desc limit 1;
  if v_latest > v_now - interval '60 seconds' then
    return pg_catalog.jsonb_build_object('denial',null);
  end if;
  select pg_catalog.count(*)::integer into v_resends from public.email_verification_tokens t
    where t.user_id = v_user_id and t.is_resend and t.created_at > v_now - interval '24 hours';
  if v_resends >= 5 then return pg_catalog.jsonb_build_object('denial',null); end if;
  if p_token_id is null or p_outbox_id is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_ciphertext is null or p_ciphertext = '' then
    return pg_catalog.jsonb_build_object('denial','email_config_unavailable');
  end if;
  perform al_private.al_email_cancel_pending(v_user_id,v_now);
  insert into public.email_verification_tokens(id,user_id,token_hash,created_at,expires_at,is_resend,consumed_at,invalidated_at)
    values (p_token_id,v_user_id,p_token_hash,v_now,v_now + interval '24 hours',true,null,null);
  insert into public.integration_outbox(id,provider,connection_id,payload_json,status,retry_after,
    attempt_count,result,encrypted_payload,verification_token_id,claim_token)
    values (p_outbox_id,'email-verification',null,'{}','queued',null,0,null,p_ciphertext,p_token_id,null);
  return pg_catalog.jsonb_build_object('denial',null);
end;
$function$;

create or replace function al_private.al_onboarding_verify(
  p_token_hash text, p_token_format_valid boolean, p_subject_hash text
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user_id text;
  v_user public.users%rowtype;
  v_token public.email_verification_tokens%rowtype;
  v_changed integer;
begin
  if not al_private.al_email_rate_allow(p_subject_hash,20,60) then
    return pg_catalog.jsonb_build_object('denial','invalid_token');
  end if;
  if not coalesce(p_token_format_valid,false) or p_token_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('denial','invalid_token');
  end if;
  select t.user_id into v_user_id from public.email_verification_tokens t where t.token_hash = p_token_hash;
  if v_user_id is null then return pg_catalog.jsonb_build_object('denial','invalid_token'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
  select * into v_user from public.users u where u.id = v_user_id for update;
  if not found or v_user.deleted_at is not null or v_user.google_sub is not null then
    return pg_catalog.jsonb_build_object('denial','invalid_token');
  end if;
  select * into v_token from public.email_verification_tokens t
    where t.token_hash = p_token_hash and t.user_id = v_user_id for update;
  if not found or v_token.consumed_at is not null or v_token.invalidated_at is not null
     or v_token.expires_at <= v_now then
    return pg_catalog.jsonb_build_object('denial','invalid_token');
  end if;
  update public.email_verification_tokens set consumed_at = v_now where id = v_token.id
    and consumed_at is null and invalidated_at is null and expires_at > v_now;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return pg_catalog.jsonb_build_object('denial','invalid_token'); end if;
  update public.users set email_verified_at = v_now where id = v_user_id and deleted_at is null and google_sub is null;
  update public.integration_outbox set encrypted_payload = null,status = 'cancelled',retry_after = null,claim_token = null
    where provider = 'email-verification' and verification_token_id = v_token.id and status <> 'success';
  return pg_catalog.jsonb_build_object('denial',null,'message','Email verified. You can now sign in.');
end;
$function$;

create or replace function al_private.al_onboarding_google(
  p_subject text,p_email text,p_ip_subject_hash text,p_user_id text,p_session_id text,
  p_authenticated_user_id text,p_authenticated_session_id text,p_enforce_legacy boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_user_id text;
  v_user public.users%rowtype;
  v_count integer;
  v_new_user_id text;
  v_expires timestamp without time zone;
begin
  if p_subject is null or pg_catalog.btrim(p_subject) = '' or p_email is null
     or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email)) or p_user_id is null
     or p_session_id is null or p_session_id = '' then
    return pg_catalog.jsonb_build_object('denial','invalid_google_identity');
  end if;
  if not al_private.al_email_rate_allow(p_ip_subject_hash,20,60) then
    return pg_catalog.jsonb_build_object('denial','rate_limited');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('google-sub:' || p_subject,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email:' || p_email,0));

  select u.id into v_user_id from public.users u where u.google_sub = p_subject order by u.id limit 1;
  if v_user_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
    select * into v_user from public.users u where u.id = v_user_id for update;
    if not found or v_user.deleted_at is not null then
      return pg_catalog.jsonb_build_object('denial','account_unavailable');
    end if;
  else
    select pg_catalog.count(*)::integer into v_count from public.users u where pg_catalog.lower(u.email) = p_email;
    if v_count > 1 then return pg_catalog.jsonb_build_object('denial','ambiguous_email'); end if;
    select u.id into v_user_id from public.users u where pg_catalog.lower(u.email) = p_email order by u.id limit 1;
    if v_user_id is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
      select * into v_user from public.users u where u.id = v_user_id for update;
      if not found or v_user.deleted_at is not null then
        return pg_catalog.jsonb_build_object('denial','account_unavailable');
      end if;
      if v_user.google_sub is not null and v_user.google_sub <> p_subject then
        return pg_catalog.jsonb_build_object('denial','google_identity_conflict');
      end if;
      if v_user.google_sub is null and v_user.email_verified_at is null
         and not v_user.email_verification_legacy_exempt
         and coalesce(v_user.email_verification_required,true) then
        perform al_private.al_email_cancel_pending(v_user.id,v_now);
        update public.users set email = 'retired-' || v_user.id || '@invalid.local', deleted_at = v_now, updated_at = v_now
          where id = v_user.id;
        v_new_user_id := p_user_id;
        insert into public.users(id,email,hashed_password,role,google_sub,email_verified_at,email_verification_required,email_verification_legacy_exempt)
        values (v_new_user_id,p_email,
          extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf',12)),
          'ATHLETE',p_subject,v_now,false,false);
        v_user_id := v_new_user_id;
        select * into v_user from public.users u where u.id = v_user_id;
      else
        if v_user.google_sub is null then
          if p_authenticated_user_id is null or p_authenticated_session_id is null then
            return pg_catalog.jsonb_build_object('denial','password_session_required');
          end if;
          if p_authenticated_user_id <> v_user.id then
            return pg_catalog.jsonb_build_object('denial','matching_password_session_required');
          end if;
          if not exists(select 1 from public.sessions s where s.id = p_authenticated_session_id
              and s.jwt_id = p_authenticated_session_id and s.user_id = v_user.id
              and s.revoked_at is null and s.expires_at > v_now) then
            return pg_catalog.jsonb_build_object('denial','password_session_required');
          end if;
          update public.users set google_sub = p_subject,email_verified_at = coalesce(email_verified_at,v_now)
            where id = v_user.id;
          v_user.google_sub := p_subject;
          v_user.email_verified_at := coalesce(v_user.email_verified_at,v_now);
        end if;
      end if;
    else
      v_user_id := p_user_id;
      insert into public.users(id,email,hashed_password,role,google_sub,email_verified_at,email_verification_required,email_verification_legacy_exempt)
      values (v_user_id,p_email,
        extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf',12)),
        'ATHLETE',p_subject,v_now,false,false);
      select * into v_user from public.users u where u.id = v_user_id;
    end if;
  end if;

  v_expires := v_now + interval '7 days';
  insert into public.sessions(id,user_id,jwt_id,expires_at,revoked_at)
    values (p_session_id,v_user.id,p_session_id,v_expires,null);
  return pg_catalog.jsonb_build_object('denial',null,'id',v_user.id,'email',v_user.email,
    'role',v_user.role,'displayName',v_user.display_name,'expiresEpoch',extract(epoch from v_expires)::bigint);
exception when unique_violation then
  return pg_catalog.jsonb_build_object('denial','google_identity_conflict');
end;
$function$;

create or replace function al_private.al_email_worker_claim(p_claim_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_job public.integration_outbox%rowtype;
begin
  if p_claim_token is null or p_claim_token !~ '^[0-9a-f-]{36}$' then
    return pg_catalog.jsonb_build_object('denial','invalid_claim');
  end if;
  update public.integration_outbox o set status='cancelled',encrypted_payload=null,retry_after=null,claim_token=null,
      result='Verification no longer eligible'
    from public.email_verification_tokens t, public.users u
    where o.provider='email-verification' and o.verification_token_id=t.id and t.user_id=u.id
      and o.status in ('queued','failed','processing')
      and (t.expires_at <= v_now or t.consumed_at is not null or t.invalidated_at is not null
        or u.deleted_at is not null or u.google_sub is not null or u.email_verified_at is not null);
  update public.integration_outbox o set status='failed',retry_after=null,encrypted_payload=null,claim_token=null,
      result='Worker lease expired after the maximum attempts'
    where o.provider='email-verification' and o.status='processing' and o.attempt_count>=3
      and o.retry_after<=v_now;
  update public.integration_outbox o set encrypted_payload=null
    where o.provider='email-verification' and o.status='failed' and o.attempt_count>=3;

  select * into v_job from public.integration_outbox o
    where o.provider='email-verification' and o.attempt_count<3 and (
      o.status='queued' or (o.status='failed' and (o.retry_after is null or o.retry_after<=v_now))
      or (o.status='processing' and o.retry_after<=v_now))
    order by o.id limit 1 for update skip locked;
  if not found then return pg_catalog.jsonb_build_object('job',null); end if;
  update public.integration_outbox set status='processing',retry_after=v_now+interval '15 minutes',
      attempt_count=v_job.attempt_count+1,claim_token=p_claim_token,result='Delivery in progress'
    where id=v_job.id;
  return pg_catalog.jsonb_build_object('jobId',v_job.id,'claimToken',p_claim_token);
end;
$function$;

create or replace function al_private.al_email_worker_begin(p_job_id text,p_claim_token text,p_enforce_legacy boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_token_id text;
  v_user_id text;
  v_user public.users%rowtype;
  v_job public.integration_outbox%rowtype;
  v_token public.email_verification_tokens%rowtype;
  v_locked boolean;
begin
  select o.verification_token_id into v_token_id from public.integration_outbox o
    where o.id=p_job_id and o.provider='email-verification' and o.status='processing' and o.claim_token=p_claim_token;
  if v_token_id is null then return pg_catalog.jsonb_build_object('send',false); end if;
  select t.user_id into v_user_id from public.email_verification_tokens t where t.id=v_token_id;
  if v_user_id is null then return pg_catalog.jsonb_build_object('send',false); end if;
  v_locked := pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
  if not v_locked then return pg_catalog.jsonb_build_object('busy',true); end if;
  select * into v_job from public.integration_outbox o
    where o.id=p_job_id and o.provider='email-verification' and o.status='processing' and o.claim_token=p_claim_token for update;
  if not found then
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
    return pg_catalog.jsonb_build_object('send',false);
  end if;
  select * into v_token from public.email_verification_tokens t where t.id=v_job.verification_token_id;
  select * into v_user from public.users u where u.id=v_user_id for update;
  if not found or v_user.deleted_at is not null or v_user.email_verified_at is not null
     or v_user.google_sub is not null or v_token.id is null
     or v_token.consumed_at is not null or v_token.invalidated_at is not null
     or v_token.expires_at <= pg_catalog.timezone('utc',pg_catalog.clock_timestamp())
     or v_job.encrypted_payload is null or v_user.email is null
     or (case when v_user.email_verification_legacy_exempt
       then coalesce(p_enforce_legacy,false) else coalesce(v_user.email_verification_required,true) end) is false then
    update public.integration_outbox set status='cancelled',encrypted_payload=null,retry_after=null,claim_token=null,
      result='Verification no longer eligible' where id=p_job_id and claim_token=p_claim_token;
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || v_user_id,0));
    return pg_catalog.jsonb_build_object('send',false);
  end if;
  return pg_catalog.jsonb_build_object('send',true,'userId',v_user_id,'email',v_user.email,
    'encryptedPayload',v_job.encrypted_payload,'jobId',p_job_id,'claimToken',p_claim_token);
end;
$function$;

create or replace function al_private.al_email_worker_finish(
  p_job_id text,p_claim_token text,p_user_id text,p_outcome text
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_attempt integer;
  v_updated integer := 0;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if p_outcome not in ('success','temporary','permanent') then
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || coalesce(p_user_id,''),0));
    return pg_catalog.jsonb_build_object('updated',false);
  end if;
  select o.attempt_count into v_attempt from public.integration_outbox o
    where o.id=p_job_id and o.provider='email-verification' and o.status='processing'
      and o.claim_token=p_claim_token for update;
  if found then
    if p_outcome='success' then
      update public.integration_outbox set status='success',retry_after=null,encrypted_payload=null,
        claim_token=null,result='Verification email accepted' where id=p_job_id and claim_token=p_claim_token;
    elsif p_outcome='temporary' and v_attempt<3 then
      update public.integration_outbox set status='failed',retry_after=v_now+pg_catalog.make_interval(mins => 5*v_attempt),
        result='Email provider temporarily unavailable' where id=p_job_id and claim_token=p_claim_token;
    else
      update public.integration_outbox set status='failed',attempt_count=3,retry_after=null,encrypted_payload=null,
        claim_token=null,result='Email provider rejected delivery' where id=p_job_id and claim_token=p_claim_token;
    end if;
    get diagnostics v_updated = row_count;
  end if;
  perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || coalesce(p_user_id,''),0));
  return pg_catalog.jsonb_build_object('updated',v_updated=1);
end;
$function$;

create or replace function al_private.al_email_worker_unlock(p_user_id text)
returns boolean language sql volatile security definer set search_path = ''
as $function$
  select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || coalesce(p_user_id,''),0));
$function$;

create or replace function al_private.al_email_worker_cron_tick()
returns bigint language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_url_count bigint; v_key_count bigint; v_secret_count bigint;
  v_url text; v_key text; v_secret text;
  v_request_id bigint;
begin
  select pg_catalog.count(*),pg_catalog.max(s.decrypted_secret) into v_url_count,v_url
    from vault.decrypted_secrets s where s.name='adaptive_lifting_email_worker_edge_url';
  select pg_catalog.count(*),pg_catalog.max(s.decrypted_secret) into v_key_count,v_key
    from vault.decrypted_secrets s where s.name='adaptive_lifting_email_worker_publishable_key';
  select pg_catalog.count(*),pg_catalog.max(s.decrypted_secret) into v_secret_count,v_secret
    from vault.decrypted_secrets s where s.name='adaptive_lifting_email_worker_internal_secret';
  if v_url_count<>1 or v_key_count<>1 or v_secret_count<>1
    or pg_catalog.btrim(coalesce(v_url,''))='' or pg_catalog.btrim(coalesce(v_key,''))=''
    or pg_catalog.btrim(coalesce(v_secret,''))='' then
    raise exception 'email worker dispatch configuration unavailable' using errcode='55000';
  end if;
  select net.http_post(url:=v_url,
    headers:=pg_catalog.jsonb_build_object('content-type','application/json','apikey',v_key,'authorization','Bearer '||v_secret),
    body:='{}'::jsonb) into v_request_id;
  return v_request_id;
end;
$function$;

revoke all on function al_private.al_email_rate_allow(text,integer,integer) from public,anon,authenticated,al_edge_catalog_runtime;
revoke all on function al_private.al_email_cancel_pending(text,timestamp without time zone) from public,anon,authenticated,al_edge_catalog_runtime;
revoke all on function al_private.al_email_payload_encryption_key() from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_email_worker_internal_secret() from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_email_delivery_config() from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_onboarding_register(text,text,text,text,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function al_private.al_onboarding_resend(text,text,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function al_private.al_onboarding_verify(text,boolean,text) from public,anon,authenticated;
revoke all on function al_private.al_onboarding_google(text,text,text,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function al_private.al_email_worker_claim(text) from public,anon,authenticated;
revoke all on function al_private.al_email_worker_begin(text,text,boolean) from public,anon,authenticated;
revoke all on function al_private.al_email_worker_finish(text,text,text,text) from public,anon,authenticated;
revoke all on function al_private.al_email_worker_unlock(text) from public,anon,authenticated;
revoke all on function al_private.al_email_worker_cron_tick() from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
grant execute on function al_private.al_email_payload_encryption_key() to al_edge_catalog_runtime;
grant execute on function al_private.al_email_worker_internal_secret() to al_edge_catalog_runtime;
grant execute on function al_private.al_email_delivery_config() to al_edge_catalog_runtime;
grant execute on function al_private.al_onboarding_register(text,text,text,text,text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_onboarding_resend(text,text,text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_onboarding_verify(text,boolean,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_onboarding_google(text,text,text,text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_email_worker_claim(text) to al_edge_catalog_runtime;
grant execute on function al_private.al_email_worker_begin(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_email_worker_finish(text,text,text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_email_worker_unlock(text) to al_edge_catalog_runtime;

-- Only the owner-run pg_cron job can invoke the private dispatcher. Its SQL
-- command contains only this function name; secrets are read from Vault here.
revoke all on function al_private.al_email_worker_cron_tick() from al_edge_catalog_runtime,al_edge_catalog_reader;
select cron.schedule('email-verification-edge-worker','* * * * *',
  'select al_private.al_email_worker_cron_tick();');

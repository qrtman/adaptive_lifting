-- Supabase-native Telegram and Google Sheets integration interfaces.
-- Provider credentials are intentionally installed into Vault outside migrations.

create table if not exists public.telegram_link_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id varchar not null references public.users(id) on delete cascade,
  created_at timestamp without time zone not null,
  expires_at timestamp without time zone not null,
  consumed_at timestamp without time zone
);
create index if not exists ix_telegram_link_tokens_user_pending
  on public.telegram_link_tokens(user_id, expires_at) where consumed_at is null;
create unique index if not exists uq_integration_connection_user_provider
  on public.integration_connections(user_id, provider);
create unique index if not exists uq_active_telegram_external_account
  on public.integration_connections(provider, external_account_id)
  where provider='telegram' and status='active' and external_account_id is not null and deleted_at is null;
alter table public.webhook_events add column if not exists claim_token text;
alter table public.webhook_events add column if not exists lease_expires_at timestamp without time zone;
alter table public.webhook_events add column if not exists attempt_count integer not null default 0;
alter table public.oauth_states add column if not exists session_id varchar;

alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_link_tokens from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on public.integration_connections, public.integration_credentials, public.integration_outbox,
  public.webhook_events, public.oauth_states from al_edge_catalog_runtime;

create or replace function al_private.al_integration_secret(p_name text)
returns text language plpgsql stable security definer set search_path=''
as $function$
declare v_value text; v_count integer;
begin
  if p_name not in (
    'adaptive_lifting_telegram_bot_token',
    'adaptive_lifting_telegram_webhook_secret',
    'adaptive_lifting_google_oauth_client_id',
    'adaptive_lifting_google_oauth_client_secret',
    'adaptive_lifting_integration_encryption_key',
    'adaptive_lifting_google_sheets_worker_internal_secret'
  ) then return null; end if;
  select count(*)::integer, min(ds.decrypted_secret) into v_count,v_value
    from vault.decrypted_secrets ds where ds.name=p_name;
  if v_count <> 1 or v_value is null or pg_catalog.btrim(v_value)='' then return null; end if;
  return v_value;
end;
$function$;

create or replace function al_private.al_integration_actor(
  p_actor text,p_session text,p_enforce_legacy boolean
) returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_actor and s.id=p_session and s.jwt_id=p_session and s.revoked_at is null
     and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
  if v_user.deleted_at is not null or (v_user.email_verified_at is null and v_user.google_sub is null and
      (case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy,false)
       else coalesce(v_user.email_verification_required,true) end)) then
    return pg_catalog.jsonb_build_object('denial','account_ineligible');
  end if;
  return pg_catalog.jsonb_build_object('denial',null,'id',v_user.id,'email',v_user.email,
    'role',v_user.role,'displayName',v_user.display_name);
end;
$function$;

create or replace function al_private.al_telegram_link_token_create(
  p_actor text,p_session text,p_hash text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce_legacy);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram-link:'||p_actor,0));
  update public.telegram_link_tokens set consumed_at=v_now where user_id=p_actor and consumed_at is null;
  insert into public.telegram_link_tokens(token_hash,user_id,created_at,expires_at)
  values(p_hash,p_actor,v_now,v_now+interval '10 minutes');
  return pg_catalog.jsonb_build_object('denial',null);
end;
$function$;

create or replace function al_private.al_telegram_session(
  p_external_id text,p_link_hash text,p_session_id text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_conn public.integration_connections%rowtype; v_user public.users%rowtype; v_target_user_id text;
  v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp()); v_expires timestamp without time zone;
begin
  if p_external_id is null or p_external_id !~ '^[1-9][0-9]{0,19}$' then return pg_catalog.jsonb_build_object('denial','invalid_telegram_user'); end if;
  if p_link_hash is not null then
    select t.user_id into v_target_user_id from public.telegram_link_tokens t
      where t.token_hash=p_link_hash and t.consumed_at is null and t.expires_at>v_now for update;
    if not found then return pg_catalog.jsonb_build_object('denial','invalid_link_token'); end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram-identity:'||p_external_id,0));
    select * into v_user from public.users where id=v_target_user_id for update;
    if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','user_missing'); end if;
    if (v_user.email_verified_at is null and v_user.google_sub is null and
        (case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy,false)
         else coalesce(v_user.email_verification_required,true) end)) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
    if exists(select 1 from public.integration_connections c where c.provider='telegram'
        and c.external_account_id=p_external_id and c.status='active' and c.user_id<>v_user.id) then
      return pg_catalog.jsonb_build_object('denial','telegram_identity_in_use');
    end if;
    update public.telegram_link_tokens set consumed_at=v_now where token_hash=p_link_hash and consumed_at is null;
    if not found then return pg_catalog.jsonb_build_object('denial','invalid_link_token'); end if;
    insert into public.integration_connections(id,user_id,provider,external_account_id,status,scopes,created_at,updated_at,revoked_at,deleted_at)
    values(pg_catalog.gen_random_uuid()::text,v_user.id,'telegram',p_external_id,'active','miniapp,bot',v_now,v_now,null,null)
    on conflict (user_id,provider) do update set external_account_id=excluded.external_account_id,
      status='active',scopes='miniapp,bot',revoked_at=null,deleted_at=null,updated_at=v_now;
  else
    select c.* into v_conn from public.integration_connections c where c.provider='telegram'
      and c.external_account_id=p_external_id and c.status='active' and c.deleted_at is null for update;
    if not found then return pg_catalog.jsonb_build_object('denial','telegram_not_linked'); end if;
    select * into v_user from public.users where id=v_conn.user_id for update;
    if not found then return pg_catalog.jsonb_build_object('denial','user_missing'); end if;
    if v_user.deleted_at is not null or (v_user.email_verified_at is null and v_user.google_sub is null and
        (case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy,false)
         else coalesce(v_user.email_verification_required,true) end)) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  end if;
  if p_session_id is null or p_session_id='' then return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  v_expires:=v_now+interval '7 days';
  insert into public.sessions(id,jwt_id,user_id,expires_at,revoked_at)
  values(p_session_id,p_session_id,v_user.id,v_expires,null);
  return pg_catalog.jsonb_build_object('denial',null,'id',v_user.id,'email',v_user.email,
    'role',v_user.role,'displayName',v_user.display_name,'expiresAt',v_expires);
exception when unique_violation then
  return pg_catalog.jsonb_build_object('denial','telegram_identity_in_use');
end;
$function$;

create or replace function al_private.al_telegram_connection(
  p_actor text,p_session text,p_disconnect boolean,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_conn public.integration_connections%rowtype;
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce_legacy);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_disconnect then
    update public.integration_connections set status='revoked',revoked_at=pg_catalog.timezone('utc',pg_catalog.clock_timestamp()),updated_at=pg_catalog.timezone('utc',pg_catalog.clock_timestamp())
     where user_id=p_actor and provider='telegram' and deleted_at is null;
    return pg_catalog.jsonb_build_object('denial',null,'status','disconnected');
  end if;
  select * into v_conn from public.integration_connections where user_id=p_actor and provider='telegram' and status='active' and deleted_at is null limit 1;
  if not found then return pg_catalog.jsonb_build_object('denial',null,'status','disconnected'); end if;
  return pg_catalog.jsonb_build_object('denial',null,'status','connected','external_account_id',v_conn.external_account_id);
end;
$function$;

create or replace function al_private.al_sheets_actor(
  p_actor text,p_session text,p_enforce_legacy boolean,p_grace integer
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_access jsonb;
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce_legacy);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if v_ctx->>'role'<>'COACH' then return pg_catalog.jsonb_build_object('denial','coach_only'); end if;
  v_access:=al_private.al_account_access_state(p_actor,p_session,p_enforce_legacy,p_grace);
  if v_access->>'denial' is not null then return v_access; end if;
  if coalesce((v_access->'entitlements'->>'canUseIntegrations')::boolean,false) is not true then
    return pg_catalog.jsonb_build_object('denial','integrations_required');
  end if;
  return v_ctx;
end;
$function$;

create or replace function al_private.al_sheets_state_create(
  p_actor text,p_session text,p_hash text,p_enforce_legacy boolean,p_grace integer
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  v_ctx:=al_private.al_sheets_actor(p_actor,p_session,p_enforce_legacy,p_grace);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  delete from public.oauth_states where provider='google-sheets' and expires_at<=v_now;
  insert into public.oauth_states(state_hash,user_id,provider,created_at,expires_at,return_to,session_id)
  values(p_hash,p_actor,'google-sheets',v_now,v_now+interval '10 minutes',null,p_session);
  return pg_catalog.jsonb_build_object('denial',null);
end;
$function$;

create or replace function al_private.al_sheets_state_consume(
  p_hash text,p_enforce_legacy boolean,p_grace integer
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_state public.oauth_states%rowtype; v_ctx jsonb;
begin
  select * into v_state from public.oauth_states where state_hash=p_hash for update;
  if not found or v_state.provider<>'google-sheets' or v_state.expires_at<=pg_catalog.timezone('utc',pg_catalog.now()) then
    delete from public.oauth_states where state_hash=p_hash;
    return pg_catalog.jsonb_build_object('denial','invalid_state');
  end if;
  v_ctx:=al_private.al_sheets_actor(v_state.user_id,v_state.session_id,p_enforce_legacy,p_grace);
  if v_ctx->>'denial' is not null then
    delete from public.oauth_states where state_hash=p_hash;
    return pg_catalog.jsonb_build_object('denial',case when v_ctx->>'denial'='invalid_session' then 'invalid_state' else v_ctx->>'denial' end);
  end if;
  delete from public.oauth_states where state_hash=p_hash;
  return pg_catalog.jsonb_build_object('denial',null,'userId',v_state.user_id,'sessionId',v_state.session_id);
end;
$function$;

create or replace function al_private.al_sheets_credentials_save(
  p_user_id text,p_session_id text,p_access_cipher text,p_access_exp timestamptz,p_refresh_cipher text,
  p_enforce boolean,p_grace integer
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_conn public.integration_connections%rowtype; v_ctx jsonb; v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  v_ctx:=al_private.al_sheets_actor(p_user_id,p_session_id,p_enforce,p_grace);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  perform 1 from public.users where id=p_user_id and deleted_at is null and role='COACH' for update;
  if not found then return pg_catalog.jsonb_build_object('denial','account_unavailable'); end if;
  select * into v_conn from public.integration_connections where user_id=p_user_id and provider='google-sheets' for update;
  if not found then
    insert into public.integration_connections(id,user_id,provider,status,scopes,created_at,updated_at,deleted_at)
      values(pg_catalog.gen_random_uuid()::text,p_user_id,'google-sheets','active','spreadsheets',v_now,v_now,null) returning * into v_conn;
  else
    update public.integration_connections set status='active',scopes='spreadsheets',revoked_at=null,deleted_at=null,updated_at=v_now where id=v_conn.id returning * into v_conn;
  end if;
  insert into public.integration_credentials(connection_id,credential_type,encrypted_payload,expires_at,rotated_at)
    values(v_conn.id,'access_token',p_access_cipher,p_access_exp,v_now)
    on conflict(connection_id,credential_type) do update set encrypted_payload=excluded.encrypted_payload,expires_at=excluded.expires_at,rotated_at=excluded.rotated_at;
  if p_refresh_cipher is not null then
    insert into public.integration_credentials(connection_id,credential_type,encrypted_payload,expires_at,rotated_at)
      values(v_conn.id,'refresh_token',p_refresh_cipher,null,v_now)
      on conflict(connection_id,credential_type) do update set encrypted_payload=excluded.encrypted_payload,rotated_at=excluded.rotated_at;
  end if;
  return pg_catalog.jsonb_build_object('denial',null,'connectionId',v_conn.id);
end;
$function$;

create or replace function al_private.al_sheets_status(
  p_actor text,p_session text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_conn public.integration_connections%rowtype; v_jobs jsonb;
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce_legacy);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  select * into v_conn from public.integration_connections where user_id=p_actor and provider='google-sheets' and status='active' and deleted_at is null limit 1;
  if not found then return pg_catalog.jsonb_build_object('denial',null,'status','disconnected'); end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',j.id,'sheet_name',coalesce(j.payload_json::jsonb->>'sheet_name','Untitled Publish'),
    'status',j.status,'attempts',coalesce(j.attempt_count,0),'error',case when j.status='failed' then j.result else null end
  ) order by j.id desc),'[]'::jsonb) into v_jobs
  from (select * from public.integration_outbox where provider='google-sheets' and connection_id=v_conn.id order by id desc limit 5) j;
  return pg_catalog.jsonb_build_object('denial',null,'status','connected','connection_id',v_conn.id,'jobs',v_jobs);
end;
$function$;

create or replace function al_private.al_sheets_disconnect(
  p_actor text,p_session text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_ids text[];
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce_legacy);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  select array_agg(id) into v_ids from public.integration_connections where user_id=p_actor and provider='google-sheets';
  if v_ids is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sheets-connection:'||v_id,0))
      from pg_catalog.unnest(v_ids) as ids(v_id);
    update public.integration_connections set status='revoked',revoked_at=pg_catalog.timezone('utc',pg_catalog.clock_timestamp()),updated_at=pg_catalog.timezone('utc',pg_catalog.clock_timestamp()) where id=any(v_ids);
    delete from public.integration_credentials where connection_id=any(v_ids);
    update public.integration_outbox set status='cancelled',result='Integration disconnected',retry_after=null,claim_token=null
      where connection_id=any(v_ids) and provider='google-sheets' and status in ('queued','failed','processing');
  end if;
  return pg_catalog.jsonb_build_object('denial',null,'status','disconnected');
end;
$function$;

create or replace function al_private.al_sheets_publish(
  p_actor text,p_session text,p_athlete text,p_meso text,p_payload text,p_job_id text,
  p_enforce_legacy boolean,p_grace integer
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_conn public.integration_connections%rowtype; v_owner text;
begin
  if p_athlete is null or p_athlete='' or p_meso is null or p_meso='' then return pg_catalog.jsonb_build_object('denial','missing_publish_fields'); end if;
  v_ctx:=al_private.al_sheets_actor(p_actor,p_session,p_enforce_legacy,p_grace);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if not exists(select 1 from public.coaching_relationships r join public.users a on a.id=r.athlete_id
    where r.coach_id=p_actor and r.athlete_id=p_athlete and r.ended_at is null and r.deleted_at is null and a.deleted_at is null
      and (a.email_verified_at is not null or a.google_sub is not null or not a.email_verification_required)) then
    return pg_catalog.jsonb_build_object('denial','relationship_required');
  end if;
  select owner_id into v_owner from public.mesocycles where id=p_meso and deleted_at is null for share;
  if not found or v_owner is distinct from p_athlete then return pg_catalog.jsonb_build_object('denial','mesocycle_not_owned'); end if;
  select * into v_conn from public.integration_connections where user_id=p_actor and provider='google-sheets' and status='active' and deleted_at is null for update;
  if not found then return pg_catalog.jsonb_build_object('denial','not_connected'); end if;
  insert into public.integration_outbox(id,provider,connection_id,payload_json,status,attempt_count)
  values(p_job_id,'google-sheets',v_conn.id,p_payload,'queued',0);
  return pg_catalog.jsonb_build_object('denial',null,'status','queued','job_id',p_job_id);
end;
$function$;

create or replace function al_private.al_sheets_worker_claim(p_claim text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_job public.integration_outbox%rowtype; v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  update public.integration_outbox set status='failed',retry_after=null,claim_token=null,result='Worker lease expired after maximum attempts'
   where provider='google-sheets' and status='processing' and attempt_count>=3 and retry_after<=v_now;
  select * into v_job from public.integration_outbox where provider='google-sheets' and attempt_count<3 and
    (status='queued' or (status in ('failed','processing') and (retry_after is null or retry_after<=v_now)))
    order by id for update skip locked limit 1;
  if not found then return pg_catalog.jsonb_build_object('jobId',null); end if;
  update public.integration_outbox set status='processing',claim_token=p_claim,retry_after=v_now+interval '15 minutes',attempt_count=coalesce(attempt_count,0)+1
   where id=v_job.id returning * into v_job;
  return pg_catalog.jsonb_build_object('jobId',v_job.id,'connectionId',v_job.connection_id,'payload',v_job.payload_json,'attempt',v_job.attempt_count);
end;
$function$;

create or replace function al_private.al_sheets_worker_begin(p_job text,p_claim text,p_enforce boolean,p_grace integer)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_job public.integration_outbox%rowtype; v_conn public.integration_connections%rowtype; v_coach public.users%rowtype;
  v_payload jsonb; v_meso text; v_athlete text; v_access jsonb; v_tree jsonb; v_mids text[];
begin
  select * into v_job from public.integration_outbox where id=p_job and provider='google-sheets' and status='processing' and claim_token=p_claim for update;
  if not found then return pg_catalog.jsonb_build_object('send',false,'reason','claim_lost'); end if;
  select * into v_conn from public.integration_connections where id=v_job.connection_id and provider='google-sheets' for share;
  if found and not pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended('sheets-connection:'||v_conn.id,0)) then
    update public.integration_outbox set status='queued',attempt_count=greatest(attempt_count-1,0),
      retry_after=null,claim_token=null where id=p_job and status='processing' and claim_token=p_claim;
    return pg_catalog.jsonb_build_object('busy',true);
  end if;
  begin v_payload:=v_job.payload_json::jsonb; exception when others then v_payload:='{}'::jsonb; end;
  v_athlete:=v_payload->>'athlete_id'; v_meso:=v_payload->>'mesocycle_id';
  if not found or v_conn.status<>'active' then return pg_catalog.jsonb_build_object('send',false,'reason','authorization'); end if;
  select * into v_coach from public.users where id=v_conn.user_id and deleted_at is null and role='COACH' for share;
  if not found or (v_coach.email_verified_at is null and v_coach.google_sub is null and v_coach.email_verification_required) then return pg_catalog.jsonb_build_object('send',false,'reason','authorization'); end if;
  v_access:=al_private.al_sheets_actor(v_coach.id,v_payload->>'requested_session_id',p_enforce,p_grace);
  if v_access->>'denial' is not null then return pg_catalog.jsonb_build_object('send',false,'reason','authorization'); end if;
  if not exists(select 1 from public.coaching_relationships r join public.users a on a.id=r.athlete_id where r.coach_id=v_coach.id and r.athlete_id=v_athlete and r.ended_at is null and r.deleted_at is null and a.deleted_at is null and (a.email_verified_at is not null or a.google_sub is not null or not a.email_verification_required)) then return pg_catalog.jsonb_build_object('send',false,'reason','authorization'); end if;
  if not exists(select 1 from public.mesocycles m where m.id=v_meso and m.owner_id=v_athlete and m.deleted_at is null) then return pg_catalog.jsonb_build_object('send',false,'reason','authorization'); end if;
  select coalesce(pg_catalog.array_agg(mc.id::text order by mc.id),array[]::text[]) into v_mids from public.microcycles mc
    where mc.mesocycle_id=v_meso and mc.owner_id=v_athlete and mc.deleted_at is null;
  select al_private.al_microcycles_read(v_coach.id,v_payload->>'requested_session_id',v_athlete,p_enforce)->'microcycles' into v_tree;
  select coalesce(pg_catalog.jsonb_agg(cycle order by cycle->>'id'),'[]'::jsonb) into v_tree
    from pg_catalog.jsonb_array_elements(coalesce(v_tree,'[]'::jsonb)) as items(cycle)
   where cycle->>'id'=any(v_mids);
  return pg_catalog.jsonb_build_object('send',true,'connectionId',v_conn.id,'coachId',v_coach.id,'athleteId',v_athlete,'mesocycleId',v_meso,'payload',v_payload,'microcycles',coalesce(v_tree,'[]'::jsonb));
end;
$function$;

-- Extend the existing roster's stable row additively so the Sheets panel can
-- publish a real active mesocycle instead of fabricating an ID.
create or replace function al_private.al_coach_roster(
 p_actor_user_id text,p_session_id text,p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_rows jsonb;
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null
    and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('denial','not_authorized'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
   case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
     else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',athlete.id,'email',athlete.email,'displayName',athlete.display_name,'activeMicrocycles',
   (select pg_catalog.count(*)::integer from public.microcycles mc where mc.owner_id=athlete.id and mc.active is true),
   'activeMesocycleId',(select m.id from public.mesocycles m where m.owner_id=athlete.id and m.deleted_at is null
      order by (m.status='ACTIVE') desc,m.updated_at desc nulls last,m.id limit 1)
 ) order by athlete.id),'[]'::jsonb) into v_rows
 from public.coaching_relationships cr join public.users athlete on athlete.id=cr.athlete_id
 where cr.coach_id=p_actor_user_id and cr.ended_at is null and cr.deleted_at is null and athlete.deleted_at is null;
 return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_sheets_worker_credentials(p_job text,p_claim text)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_connection text; v_access text; v_refresh text; v_exp timestamp without time zone;
begin
  select connection_id into v_connection from public.integration_outbox where id=p_job and provider='google-sheets' and status='processing' and claim_token=p_claim;
  if not found then return pg_catalog.jsonb_build_object('denial','claim_lost'); end if;
  select encrypted_payload,expires_at into v_access,v_exp from public.integration_credentials where connection_id=v_connection and credential_type='access_token';
  select encrypted_payload into v_refresh from public.integration_credentials where connection_id=v_connection and credential_type='refresh_token';
  return pg_catalog.jsonb_build_object('accessCipher',v_access,'accessExpiresAt',v_exp,'refreshCipher',v_refresh);
end;
$function$;

create or replace function al_private.al_sheets_worker_checkpoint(p_job text,p_claim text,p_payload text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
begin
  update public.integration_outbox set payload_json=p_payload where id=p_job and provider='google-sheets' and status='processing' and claim_token=p_claim;
  return pg_catalog.jsonb_build_object('updated',found);
end;
$function$;

create or replace function al_private.al_sheets_worker_finish(p_job text,p_claim text,p_success boolean,p_result text,p_payload text,p_access_cipher text,p_access_exp timestamptz,p_refresh_cipher text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_job public.integration_outbox%rowtype; v_delay integer;
begin
  select * into v_job from public.integration_outbox where id=p_job and provider='google-sheets' and status='processing' and claim_token=p_claim for update;
  if not found then return pg_catalog.jsonb_build_object('updated',false); end if;
  perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('sheets-connection:'||v_job.connection_id,0));
  if p_access_cipher is not null then
    insert into public.integration_credentials(connection_id,credential_type,encrypted_payload,expires_at,rotated_at)
     values(v_job.connection_id,'access_token',p_access_cipher,p_access_exp,pg_catalog.timezone('utc',pg_catalog.clock_timestamp()))
     on conflict(connection_id,credential_type) do update set encrypted_payload=excluded.encrypted_payload,expires_at=excluded.expires_at,rotated_at=excluded.rotated_at;
  end if;
  if p_refresh_cipher is not null then
    insert into public.integration_credentials(connection_id,credential_type,encrypted_payload,expires_at,rotated_at)
     values(v_job.connection_id,'refresh_token',p_refresh_cipher,null,pg_catalog.timezone('utc',pg_catalog.clock_timestamp()))
     on conflict(connection_id,credential_type) do update set encrypted_payload=excluded.encrypted_payload,rotated_at=excluded.rotated_at;
  end if;
  if p_payload is not null then update public.integration_outbox set payload_json=p_payload where id=p_job; end if;
  if p_success then
    update public.integration_outbox set status='success',result=p_result,retry_after=null,claim_token=null where id=p_job;
  else
    v_delay:=case when v_job.attempt_count=1 then 5 when v_job.attempt_count=2 then 10 else 0 end;
    update public.integration_outbox set status='failed',attempt_count=case when p_result like '%automatic retry stopped%' then 3 else attempt_count end,
      result=left(coalesce(p_result,'Export failed'),180),
      retry_after=case when v_job.attempt_count<3 and p_result not like '%automatic retry stopped%' then pg_catalog.timezone('utc',pg_catalog.clock_timestamp())+pg_catalog.make_interval(mins=>v_delay) else null end,
      claim_token=null where id=p_job;
  end if;
  return pg_catalog.jsonb_build_object('updated',true);
end;
$function$;

create or replace function al_private.al_telegram_webhook_claim(p_update text,p_claim text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_evt public.webhook_events%rowtype; v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  insert into public.webhook_events(id,provider,external_event_id,received_at,status,claim_token,lease_expires_at,attempt_count)
    values(pg_catalog.gen_random_uuid()::text,'telegram',p_update,v_now,'processing',p_claim,v_now+interval '2 minutes',1)
    on conflict(external_event_id) do nothing;
  if found then return pg_catalog.jsonb_build_object('claimed',true); end if;
  select * into v_evt from public.webhook_events where provider='telegram' and external_event_id=p_update for update;
  if not found or v_evt.status='processed' then return pg_catalog.jsonb_build_object('duplicate',true); end if;
  if v_evt.status='processing' and v_evt.lease_expires_at>v_now then return pg_catalog.jsonb_build_object('duplicate',true); end if;
  update public.webhook_events set status='processing',claim_token=p_claim,lease_expires_at=v_now+interval '2 minutes',attempt_count=attempt_count+1 where id=v_evt.id;
  return pg_catalog.jsonb_build_object('claimed',true);
end;
$function$;

create or replace function al_private.al_telegram_webhook_finish(p_update text,p_claim text,p_success boolean)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
begin
  update public.webhook_events set status=case when p_success then 'processed' else 'failed' end,
    processed_at=case when p_success then pg_catalog.timezone('utc',pg_catalog.clock_timestamp()) else null end,
    claim_token=null,lease_expires_at=null where provider='telegram' and external_event_id=p_update and claim_token=p_claim and status='processing';
  return pg_catalog.jsonb_build_object('updated',found);
end;
$function$;

create or replace function al_private.al_telegram_html_escape(p_value text)
returns text language sql immutable security definer set search_path=''
as $function$
  select pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(coalesce(p_value,''),'&','&amp;'),
          '<','&lt;'),
        '>','&gt;'),
      pg_catalog.chr(34),'&quot;'),
    pg_catalog.chr(39),'&#39;')
$function$;

create or replace function al_private.al_telegram_webhook_command(
  p_update text,p_claim text,p_external_id text,p_text text,p_chat_id text,p_link_hash text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_evt public.webhook_events%rowtype; v_conn public.integration_connections%rowtype;
  v_user public.users%rowtype; v_token public.telegram_link_tokens%rowtype;
  v_workout public.workouts%rowtype; v_ex public.exercises%rowtype; v_set public.exercise_sets%rowtype;
  v_athlete record;
  v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
  v_today text:=pg_catalog.to_char(v_now,'YYYY-MM-DD'); v_msg text:=''; v_markup jsonb;
  v_idx integer:=0; v_eligible boolean;
begin
  select * into v_evt from public.webhook_events where provider='telegram' and external_event_id=p_update
    and status='processing' and claim_token=p_claim for update;
  if not found then return pg_catalog.jsonb_build_object('retry',true); end if;
  if p_text like '/start %' and p_link_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram-identity:'||p_external_id,0));
    select * into v_token from public.telegram_link_tokens where token_hash=p_link_hash and consumed_at is null and expires_at>v_now for update;
    if not found then return pg_catalog.jsonb_build_object('message','Invalid or expired linking token.'); end if;
    select * into v_user from public.users where id=v_token.user_id for update;
    if not found or v_user.deleted_at is not null or (v_user.email_verified_at is null and v_user.google_sub is null and
      (case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy,false) else coalesce(v_user.email_verification_required,true) end)) then
      return pg_catalog.jsonb_build_object('message','Invalid or expired linking token.');
    end if;
    if exists(select 1 from public.integration_connections c where c.provider='telegram' and c.external_account_id=p_external_id and c.status='active' and c.deleted_at is null and c.user_id<>v_user.id) then
      return pg_catalog.jsonb_build_object('message','This Telegram account is already linked to another user.');
    end if;
    update public.telegram_link_tokens set consumed_at=v_now where token_hash=p_link_hash and consumed_at is null;
    if not found then return pg_catalog.jsonb_build_object('message','Invalid or expired linking token.'); end if;
    insert into public.integration_connections(id,user_id,provider,external_account_id,status,scopes,created_at,updated_at,revoked_at,deleted_at)
      values(pg_catalog.gen_random_uuid()::text,v_user.id,'telegram',p_external_id,'active','miniapp,bot',v_now,v_now,null,null)
      on conflict(user_id,provider) do update set external_account_id=excluded.external_account_id,status='active',scopes='miniapp,bot',revoked_at=null,deleted_at=null,updated_at=v_now;
    return pg_catalog.jsonb_build_object('message','<b>Account linked successfully!</b> You can now use /today to fetch your workouts or launch the Mini App.');
  end if;

  select * into v_conn from public.integration_connections where provider='telegram' and external_account_id=p_external_id
    and status='active' and deleted_at is null limit 1;
  if not found then return pg_catalog.jsonb_build_object('message','This Telegram account is not linked. To sync your training, please link it in the settings panel.'); end if;
  select * into v_user from public.users where id=v_conn.user_id;
  if not found or v_user.deleted_at is not null or (v_user.email_verified_at is null and v_user.google_sub is null and
    (case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy,false) else coalesce(v_user.email_verification_required,true) end)) then
    return pg_catalog.jsonb_build_object('message','Linked user profile is unavailable.');
  end if;

  if p_text='/log' then
    v_markup:=pg_catalog.jsonb_build_object('inline_keyboard',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('text','Launch Logger Console','web_app',pg_catalog.jsonb_build_object('url','__APP_URL__/?tg_auth=true')))));
    return pg_catalog.jsonb_build_object('message','Open the Mini App logger to log active training sets:','replyMarkup',v_markup);
  elsif p_text='/today' then
    select w.* into v_workout from public.workouts w join public.microcycles mc on mc.id=w.microcycle_id
      where mc.owner_id=v_user.id and mc.deleted_at is null and w.deleted_at is null and w.date=v_today order by w.id limit 1;
    if not found then return pg_catalog.jsonb_build_object('message','<b>Rest day!</b> No workouts scheduled for today ('||v_today||').'); end if;
    v_msg:='<b>Today''s Workout: '||al_private.al_telegram_html_escape(v_workout.title)||' ('||v_today||')</b>'||E'\n\n';
    select count(*) into v_idx from public.exercises e where e.workout_id=v_workout.id and e.deleted_at is null;
    if v_idx=0 then v_msg:=v_msg||'No exercises programmed.'; else
      v_idx:=0;
      for v_ex in select * from public.exercises where workout_id=v_workout.id and deleted_at is null order by id loop
        v_idx:=v_idx+1;
        v_msg:=v_msg||v_idx||'. '||al_private.al_telegram_html_escape(v_ex.title)||' ('||al_private.al_telegram_html_escape(v_ex.variation)||') - '||al_private.al_telegram_html_escape(v_ex.tier)||E'\n';
        for v_set in select * from public.exercise_sets where exercise_id=v_ex.id and deleted_at is null order by id loop
          v_msg:=v_msg||'  • Set '||al_private.al_telegram_html_escape(v_set.label)||': ';
          if v_set."plannedWeight" is not null then v_msg:=v_msg||v_set."plannedWeight"||'kg x '||coalesce(v_set."plannedReps"::text,'')||' @ RPE '||coalesce(v_set."plannedRpe"::text,''); else v_msg:=v_msg||'Prescription placeholder'; end if;
          if v_set.actual is not null then v_msg:=v_msg||' <i>(Logged: '||v_set.actual||'kg x '||coalesce(v_set.reps::text,'')||' @ '||coalesce(v_set."executedRpe"::text,'')||')</i>'; end if;
          v_msg:=v_msg||E'\n';
        end loop;
      end loop;
    end if;
    v_markup:=pg_catalog.jsonb_build_object('inline_keyboard',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('text','Open Web App console','web_app',pg_catalog.jsonb_build_object('url','__APP_URL__/?tg_auth=true')))));
    return pg_catalog.jsonb_build_object('message',v_msg,'replyMarkup',v_markup);
  elsif p_text='/done' then
    update public.workouts w set status='COMPLETED',updated_at=v_now
      where w.id=(select w2.id from public.workouts w2 join public.microcycles mc2 on mc2.id=w2.microcycle_id
        where mc2.owner_id=v_user.id and mc2.deleted_at is null and w2.deleted_at is null and w2.date=v_today order by w2.id limit 1)
      returning w.* into v_workout;
    if not found then return pg_catalog.jsonb_build_object('message','No workout scheduled today to mark as done.'); end if;
    return pg_catalog.jsonb_build_object('message','<b>Workout Completed!</b> Your workout <i>'''||al_private.al_telegram_html_escape(v_workout.title)||'''</i> is flagged as completed.');
  elsif p_text='/status' then
    if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('message','Unauthorized. Only coaches can request /status reports.'); end if;
    v_msg:='<b>Athlete Status Summary ('||v_today||'):</b>'||E'\n\n';
    for v_athlete in select a.id,a.email from public.coaching_relationships r join public.users a on a.id=r.athlete_id
      where r.coach_id=v_user.id and r.ended_at is null and r.deleted_at is null and a.deleted_at is null
        and (a.email_verified_at is not null or a.google_sub is not null or not a.email_verification_required) order by a.email loop
      select w.* into v_workout from public.workouts w join public.microcycles mc on mc.id=w.microcycle_id
        where mc.owner_id=v_athlete.id and mc.deleted_at is null and w.deleted_at is null and w.date=v_today order by w.id limit 1;
      if found then v_msg:=v_msg||'• <b>'||al_private.al_telegram_html_escape(v_athlete.email)||'</b>: '||al_private.al_telegram_html_escape(v_workout.title)||' - <code>'||al_private.al_telegram_html_escape(v_workout.status)||'</code> (Tonnage: '||coalesce(v_workout.tonnage,0)||'kg)'||E'\n';
      else v_msg:=v_msg||'• <b>'||al_private.al_telegram_html_escape(v_athlete.email)||'</b>: Rest day'||E'\n'; end if;
    end loop;
    return pg_catalog.jsonb_build_object('message',v_msg);
  end if;
  return pg_catalog.jsonb_build_object('message','Sorry, I didn''t recognize that command. Use /today, /log, /done, or /status.');
end;
$function$;

-- Secret values are generated inside Vault; no plaintext material is present in this migration.
do $block$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='adaptive_lifting_integration_encryption_key') then
    perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32),'base64'), 'adaptive_lifting_integration_encryption_key');
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='adaptive_lifting_google_sheets_worker_internal_secret') then
    perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32),'hex'), 'adaptive_lifting_google_sheets_worker_internal_secret');
  end if;
end;
$block$;

-- A narrow pg_cron tick invokes only the private Google Sheets worker endpoint.
create or replace function al_private.al_google_sheets_worker_cron_tick()
returns bigint language plpgsql volatile security definer set search_path=''
as $function$
declare v_secret text; v_url text; v_secret_count integer; v_url_count integer; v_request_id bigint;
begin
  select count(*)::integer,min(ds.decrypted_secret) into v_secret_count,v_secret from vault.decrypted_secrets ds
   where ds.name='adaptive_lifting_google_sheets_worker_internal_secret';
  select count(*)::integer,min(ds.decrypted_secret) into v_url_count,v_url from vault.decrypted_secrets ds
   where ds.name='adaptive_lifting_google_sheets_worker_edge_url';
  if v_secret_count<>1 or v_url_count<>1 or pg_catalog.btrim(coalesce(v_secret,''))='' or
     v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/google-sheets-worker$' then return null; end if;
  select net.http_post(
    url:=v_url,
    headers:=pg_catalog.jsonb_build_object('content-type','application/json','authorization','Bearer '||v_secret),
    body:='{}'::jsonb, timeout_milliseconds:=10000
  ) into v_request_id;
  return v_request_id;
end;
$function$;
revoke all on function al_private.al_google_sheets_worker_cron_tick() from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
do $cron$
begin
  if exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') and exists(select 1 from pg_catalog.pg_extension where extname='pg_net') then
    perform cron.schedule('al-google-sheets-worker','* * * * *','select al_private.al_google_sheets_worker_cron_tick()');
  end if;
end;
$cron$;

revoke all on function al_private.al_integration_secret(text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_integration_actor(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_telegram_link_token_create(text,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_telegram_session(text,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_telegram_connection(text,text,boolean,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_actor(text,text,boolean,integer) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_state_create(text,text,text,boolean,integer) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_state_consume(text,boolean,integer) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_credentials_save(text,text,text,timestamptz,text,boolean,integer) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_status(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_disconnect(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_publish(text,text,text,text,text,text,boolean,integer) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_sheets_worker_claim(text) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_sheets_worker_begin(text,text,boolean,integer) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_sheets_worker_credentials(text,text) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_sheets_worker_checkpoint(text,text,text) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_sheets_worker_finish(text,text,boolean,text,text,text,timestamptz,text) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_telegram_webhook_claim(text,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_telegram_webhook_finish(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_telegram_html_escape(text) from public,anon,authenticated,al_edge_catalog_reader,al_edge_catalog_runtime;
revoke all on function al_private.al_telegram_webhook_command(text,text,text,text,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
grant execute on function al_private.al_integration_secret(text) to al_edge_catalog_runtime;
grant execute on function al_private.al_telegram_link_token_create(text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_telegram_session(text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_telegram_connection(text,text,boolean,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_state_create(text,text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_state_consume(text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_actor(text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_credentials_save(text,text,text,timestamptz,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_status(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_disconnect(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_publish(text,text,text,text,text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_worker_claim(text) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_worker_begin(text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_worker_credentials(text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_worker_checkpoint(text,text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_sheets_worker_finish(text,text,boolean,text,text,text,timestamptz,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_telegram_webhook_claim(text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_telegram_webhook_finish(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_telegram_webhook_command(text,text,text,text,text,text,boolean) to al_edge_catalog_runtime;

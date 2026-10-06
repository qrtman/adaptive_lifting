-- Mini App and /start consume the same link token. Acquire the identity lock
-- before locking the token in both paths so concurrent consumers cannot form
-- an identity/token lock cycle.
create or replace function al_private.al_telegram_session(
  p_external_id text,p_link_hash text,p_session_id text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_conn public.integration_connections%rowtype; v_user public.users%rowtype; v_target_user_id text;
  v_now timestamp without time zone:=pg_catalog.timezone('utc',pg_catalog.clock_timestamp()); v_expires timestamp without time zone;
begin
  if p_external_id is null or p_external_id !~ '^[1-9][0-9]{0,19}$' then return pg_catalog.jsonb_build_object('denial','invalid_telegram_user'); end if;
  if p_link_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram-identity:'||p_external_id,0));
    select t.user_id into v_target_user_id from public.telegram_link_tokens t
      where t.token_hash=p_link_hash and t.consumed_at is null and t.expires_at>v_now for update;
    if not found then return pg_catalog.jsonb_build_object('denial','invalid_link_token'); end if;
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
revoke all on function al_private.al_telegram_session(text,text,text,boolean)
  from public,anon,authenticated,al_edge_catalog_reader;
grant execute on function al_private.al_telegram_session(text,text,text,boolean)
  to al_edge_catalog_runtime;

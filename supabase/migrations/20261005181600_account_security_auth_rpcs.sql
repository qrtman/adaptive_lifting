-- Narrow custom-app-auth interfaces for the account/security Edge routes.
-- Supabase Auth is intentionally not involved.

grant usage on schema al_private to al_edge_catalog_runtime;
grant select (email, role, display_name) on public.users to al_edge_catalog_runtime;

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
  v_hash text;
  v_user public.users%rowtype;
  v_count integer;
begin
  if p_email is null or p_password is null or p_session_id is null or p_session_id = ''
     or pg_catalog.length(p_session_id) > 255 or p_subject_hash is null
     or p_subject_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

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

  select * into v_user from public.users
   where pg_catalog.lower(email) = pg_catalog.lower(pg_catalog.btrim(p_email))
   order by id limit 1;
  if not found or v_user.deleted_at is not null or v_user.hashed_password is null
     or pg_catalog.octet_length(p_password) > 72 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_credentials');
  end if;
  -- pgcrypto implements bcrypt's $2a$ prefix. Python bcrypt emits $2b$;
  -- normalizing only the prefix preserves the salt/cost/hash bytes.
  if extensions.crypt(p_password, pg_catalog.replace(v_user.hashed_password, '$2b$', '$2a$'))
       is distinct from pg_catalog.replace(v_user.hashed_password, '$2b$', '$2a$') then
    return pg_catalog.jsonb_build_object('denial', 'invalid_credentials');
  end if;
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

create or replace function al_private.al_auth_logout(p_user_id text, p_session_id text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
begin
  if p_user_id is not null and p_session_id is not null then
    update public.sessions set revoked_at = pg_catalog.timezone('utc', pg_catalog.clock_timestamp())
     where id = p_session_id and user_id = p_user_id and jwt_id = p_session_id;
  end if;
  return pg_catalog.jsonb_build_object('status', 'success');
end;
$function$;

create or replace function al_private.al_auth_me(
  p_actor_user_id text, p_session_id text, p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_exp timestamp without time zone; v_scopes jsonb;
begin
  select s.expires_at into v_exp from public.sessions s
   where s.user_id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > pg_catalog.timezone('utc', pg_catalog.now());
  if not found then return pg_catalog.jsonb_build_object('denial', 'invalid_session'); end if;
  select u.* into v_user from public.users u join public.sessions s on s.user_id = u.id
   where u.id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > pg_catalog.timezone('utc', pg_catalog.now());
  if not found or v_user.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy_email_verification, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then return pg_catalog.jsonb_build_object('denial', 'account_ineligible'); end if;
  if v_user.role = 'COACH' then
    select pg_catalog.jsonb_build_array(p_actor_user_id) || coalesce(
      pg_catalog.jsonb_agg(cr.athlete_id order by cr.athlete_id), '[]'::jsonb)
      into v_scopes from public.coaching_relationships cr
     where cr.coach_id = p_actor_user_id and cr.ended_at is null and cr.deleted_at is null;
  else
    v_scopes := pg_catalog.jsonb_build_array(p_actor_user_id);
  end if;
  return pg_catalog.jsonb_build_object('denial', null,
    'sessionExpiresAt', pg_catalog.to_char(v_exp, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'scopes', v_scopes);
end;
$function$;

create or replace function al_private.al_auth_profile(
  p_actor_user_id text, p_session_id text, p_display_name text,
  p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.users u join public.sessions s on s.user_id = u.id
   where u.id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > pg_catalog.timezone('utc', pg_catalog.now())
   for update of u;
  if not found or v_user.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy_email_verification, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then return pg_catalog.jsonb_build_object('denial', 'account_ineligible'); end if;
  if p_display_name is not null and pg_catalog.char_length(p_display_name) > 80 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_display_name');
  end if;
  update public.users set display_name = nullif(p_display_name, '') where id = p_actor_user_id;
  select * into v_user from public.users where id = p_actor_user_id;
  return pg_catalog.jsonb_build_object('denial', null, 'profile', pg_catalog.jsonb_build_object(
    'id', v_user.id, 'email', v_user.email, 'role', v_user.role, 'displayName', v_user.display_name));
end;
$function$;

create or replace function al_private.al_account_access_state(
  p_actor_user_id text, p_session_id text,
  p_enforce_legacy_email_verification boolean, p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype;
  v_selected record;
  v_stripe public.subscriptions%rowtype;
  v_latest public.subscriptions%rowtype;
  v_active_count integer;
  v_plan jsonb;
  v_grant jsonb := null;
  v_source jsonb := null;
  v_billing jsonb := null;
  v_entitlements jsonb;
  v_can_checkout boolean;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;
  select u.* into v_user from public.users u join public.sessions s on s.user_id = u.id
   where u.id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > v_now
   for update of u;
  if not found or v_user.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy_email_verification, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then return pg_catalog.jsonb_build_object('denial', 'account_ineligible'); end if;
  if v_user.role <> 'COACH' then
    return pg_catalog.jsonb_build_object('denial', null, 'workspace', null,
      'membershipRole', null, 'entitlements', null, 'grant', null,
      'accessSource', null, 'usage', null);
  end if;

  select * into v_workspace from public.workspaces where owner_user_id = p_actor_user_id for update;
  if not found then
    insert into public.workspaces(id, name, owner_user_id, created_at, updated_at)
    values (extensions.gen_random_uuid()::text,
      coalesce(nullif(pg_catalog.btrim(v_user.display_name), ''), pg_catalog.split_part(v_user.email, '@', 1)) || ' Coaching',
      p_actor_user_id, v_now, v_now)
    on conflict (owner_user_id) do nothing;
    select * into v_workspace from public.workspaces where owner_user_id = p_actor_user_id for update;
    if not found then raise exception 'workspace initialization failed'; end if;
    insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'WORKSPACE_CREATED', 'Workspace', v_workspace.id,
      v_now, pg_catalog.json_build_object('owner_user_id', p_actor_user_id)::text);
  end if;
  select * into v_member from public.workspace_members
   where workspace_id = v_workspace.id and user_id = p_actor_user_id for update;
  if not found then
    insert into public.workspace_members(id, workspace_id, user_id, role, created_at)
    values (extensions.gen_random_uuid()::text, v_workspace.id, p_actor_user_id, 'OWNER', v_now);
    v_member.role := 'OWNER';
    insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'WORKSPACE_MEMBER_ADDED', 'Workspace', v_workspace.id,
      v_now, pg_catalog.json_build_object('user_id', p_actor_user_id, 'role', 'OWNER')::text);
  elsif v_member.role <> 'OWNER' then
    update public.workspace_members set role = 'OWNER'
     where workspace_id = v_workspace.id and user_id = p_actor_user_id;
    v_member.role := 'OWNER';
  end if;

  select count(*)::integer into v_active_count from public.coaching_relationships
   where coach_id = p_actor_user_id and ended_at is null;

  with candidates as (
    select g.plan_key, 'grant'::text as source_type, g.id as source_id,
      'ACTIVE'::text as source_status, g.starts_at,
      g.expires_at as period_end, null::boolean as cancel_at_period_end
    from public.access_grants g
    where g.workspace_id = v_workspace.id and g.starts_at <= v_now
      and (g.expires_at is null or g.expires_at > v_now) and g.revoked_at is null
      and g.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
    union all
    select s.plan_key, 'subscription'::text, s.id, s.status,
      coalesce(s.current_period_start, s.created_at), s.current_period_end, s.cancel_at_period_end
    from public.subscriptions s
    where s.workspace_id = v_workspace.id
      and s.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
      and (
        s.status = 'TRIALING'
        or (s.status = 'ACTIVE' and (not s.cancel_at_period_end or (s.current_period_end is not null and v_now < s.current_period_end)))
        or (s.status = 'CANCELED' and s.current_period_end is not null and v_now < s.current_period_end)
        or (s.status = 'PAST_DUE' and s.current_period_end is not null and v_now < s.current_period_end + (p_past_due_grace_days * interval '1 day'))
      )
  )
  select c.* into v_selected from candidates c order by
    case c.plan_key when 'coach_starter' then 1 when 'coach_beta' then 2 when 'coach_pro' then 3 when 'coach_unlimited' then 4 else 0 end desc,
    c.starts_at desc, c.source_id desc, c.source_type desc limit 1;

  if found then
    v_plan := case v_selected.plan_key
      when 'coach_starter' then pg_catalog.jsonb_build_object('maxActiveAthletes',5,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',false)
      when 'coach_beta' then pg_catalog.jsonb_build_object('maxActiveAthletes',20,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',true)
      when 'coach_pro' then pg_catalog.jsonb_build_object('maxActiveAthletes',25,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',true)
      when 'coach_unlimited' then pg_catalog.jsonb_build_object('maxActiveAthletes',null,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',true)
    end;
    v_entitlements := pg_catalog.jsonb_build_object('active',true,'planKey',v_selected.plan_key) || v_plan;
    if v_selected.source_type = 'grant' then
      select pg_catalog.jsonb_build_object('source',g.source,'startsAt',g.starts_at,
        'expiresAt',g.expires_at) into v_grant
      from public.access_grants g where g.id = v_selected.source_id and g.workspace_id = v_workspace.id;
      v_source := pg_catalog.jsonb_build_object('type','grant','status','ACTIVE','expiresAt',v_selected.period_end);
    else
      v_source := pg_catalog.jsonb_build_object('type','subscription','status',v_selected.source_status,
        'currentPeriodEnd',v_selected.period_end,'cancelAtPeriodEnd',coalesce(v_selected.cancel_at_period_end,false));
    end if;
  else
    v_entitlements := pg_catalog.jsonb_build_object('active',false,'planKey',null,
      'maxActiveAthletes',0,'canProgram',false,'canUseAnalytics',false,'canUseIntegrations',false);
  end if;

  if v_selected.source_type is distinct from 'subscription' and v_selected.source_type is not null then
    select * into v_stripe from public.subscriptions where id = v_selected.source_id and workspace_id = v_workspace.id;
  elsif v_selected.source_type is null then
    select * into v_latest from public.subscriptions where workspace_id = v_workspace.id
      order by updated_at desc, id limit 1;
    if found then
      v_source := pg_catalog.jsonb_build_object('type','subscription','status',v_latest.status,
        'currentPeriodEnd',v_latest.current_period_end,'cancelAtPeriodEnd',coalesce(v_latest.cancel_at_period_end,false));
    end if;
  end if;
  select * into v_stripe from public.subscriptions where workspace_id = v_workspace.id and provider = 'stripe'
    order by updated_at desc, id limit 1;
  if found then
    v_billing := pg_catalog.jsonb_build_object('planKey',v_stripe.plan_key,'status',v_stripe.status,
      'currentPeriodEnd',v_stripe.current_period_end,'cancelAtPeriodEnd',v_stripe.cancel_at_period_end);
  end if;
  select not exists(select 1 from public.subscriptions s where s.workspace_id = v_workspace.id and s.provider = 'stripe'
    and s.status <> 'EXPIRED' and not (s.status = 'CANCELED' and s.current_period_end is not null and s.current_period_end <= v_now))
    into v_can_checkout;

  return pg_catalog.jsonb_build_object('denial',null,
    'workspace',pg_catalog.jsonb_build_object('id',v_workspace.id,'name',v_workspace.name),
    'membershipRole',v_member.role,'entitlements',v_entitlements,'grant',v_grant,
    'accessSource',v_source,'billingSubscription',v_billing,'canStartCheckout',v_can_checkout,
    'usage',pg_catalog.jsonb_build_object('activeAthletes',v_active_count,
      'maxActiveAthletes',coalesce(v_entitlements->'maxActiveAthletes','null'::jsonb)));
end;
$function$;

revoke all on function al_private.al_auth_login(text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_auth_logout(text,text) from public, anon, authenticated;
revoke all on function al_private.al_auth_me(text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_auth_profile(text,text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_account_access_state(text,text,boolean,integer) from public, anon, authenticated;
grant execute on function al_private.al_auth_login(text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_auth_logout(text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_auth_me(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_auth_profile(text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_account_access_state(text,text,boolean,integer) to al_edge_catalog_runtime;

\n
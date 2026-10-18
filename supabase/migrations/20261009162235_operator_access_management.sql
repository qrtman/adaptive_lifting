-- Trusted operator replacements for the production-relevant manage_user CLI.
-- These functions are private SQL surfaces and are callable only by postgres.

create or replace function al_private.al_operator_ensure_coach_workspace(p_user_id text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_label text;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.role <> 'COACH' then
    raise exception 'a persisted coach account is required';
  end if;

  select * into v_workspace from public.workspaces
   where owner_user_id = v_user.id for update;
  if not found then
    v_label := coalesce(nullif(pg_catalog.btrim(v_user.display_name), ''),
      pg_catalog.split_part(v_user.email, '@', 1));
    insert into public.workspaces(id, name, owner_user_id, created_at, updated_at)
    values (extensions.gen_random_uuid()::text, v_label || ' Coaching',
      v_user.id, v_now, v_now)
    on conflict (owner_user_id) do nothing;
    select * into v_workspace from public.workspaces
     where owner_user_id = v_user.id for update;
    if not found then raise exception 'workspace initialization failed'; end if;
    insert into public.audit_events(id, actor_user_id, event_type,
      resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'WORKSPACE_CREATED',
      'Workspace', v_workspace.id, v_now,
      pg_catalog.json_build_object('owner_user_id', v_user.id)::text);
  end if;

  select * into v_member from public.workspace_members
   where workspace_id = v_workspace.id and user_id = v_user.id for update;
  if not found then
    insert into public.workspace_members(id, workspace_id, user_id, role, created_at)
    values (extensions.gen_random_uuid()::text, v_workspace.id, v_user.id, 'OWNER', v_now);
    insert into public.audit_events(id, actor_user_id, event_type,
      resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'WORKSPACE_MEMBER_ADDED',
      'Workspace', v_workspace.id, v_now,
      pg_catalog.json_build_object('user_id', v_user.id, 'role', 'OWNER')::text);
  elsif v_member.role <> 'OWNER' then
    update public.workspace_members set role = 'OWNER'
     where workspace_id = v_workspace.id and user_id = v_user.id;
  end if;
  return v_workspace.id;
end;
$function$;

create or replace function al_private.al_operator_promote_coach(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_user public.users%rowtype;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if v_email is null or v_email = '' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid account email';
  end if;
  select * into v_user from public.users
   where pg_catalog.lower(email) = v_email for update;
  if not found then raise exception 'account not found'; end if;
  if v_user.role = 'COACH' then
    return pg_catalog.jsonb_build_object('status', 'already_coach', 'userId', v_user.id);
  end if;
  if v_user.role <> 'ATHLETE' then raise exception 'account role cannot be promoted'; end if;

  update public.users set role = 'COACH' where id = v_user.id;
  insert into public.audit_events(id, actor_user_id, event_type, resource_type,
    resource_id, created_at, metadata_json)
  values (extensions.gen_random_uuid()::text, null, 'COACH_PROMOTED',
    'User', v_user.id, v_now,
    pg_catalog.json_build_object('email', v_email)::text);
  return pg_catalog.jsonb_build_object('status', 'promoted', 'userId', v_user.id);
end;
$function$;

create or replace function al_private.al_operator_grant_coach_access(
  p_email text,
  p_plan_key text,
  p_days integer,
  p_no_expiry boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_user public.users%rowtype;
  v_workspace_id text;
  v_source text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_expires timestamp without time zone;
  v_grant public.access_grants%rowtype;
begin
  if v_email is null or v_email = '' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid account email';
  end if;
  if p_plan_key not in ('coach_beta', 'coach_starter', 'coach_pro', 'coach_unlimited') then
    raise exception 'unknown coach plan';
  end if;
  if p_no_expiry is null or ((p_days is null) = (not p_no_expiry)) then
    raise exception 'specify exactly one of days or no expiry';
  end if;
  if p_days is not null and p_days <= 0 then
    raise exception 'grant duration must be a positive number of days';
  end if;
  select * into v_user from public.users
   where pg_catalog.lower(email) = v_email for update;
  if not found then raise exception 'account not found'; end if;

  if v_user.role = 'ATHLETE' then
    update public.users set role = 'COACH' where id = v_user.id;
    insert into public.audit_events(id, actor_user_id, event_type, resource_type,
      resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'COACH_PROMOTED',
      'User', v_user.id, v_now,
      pg_catalog.json_build_object('email', v_email)::text);
  elsif v_user.role <> 'COACH' then
    raise exception 'account role cannot receive coach access';
  end if;

  v_workspace_id := al_private.al_operator_ensure_coach_workspace(v_user.id);
  v_source := case when p_plan_key = 'coach_beta' then 'beta' else 'manual' end;
  if p_days is not null then v_expires := v_now + (p_days * interval '1 day'); end if;

  select * into v_grant from public.access_grants
   where workspace_id = v_workspace_id
     and plan_key = p_plan_key
     and source = v_source
     and starts_at <= v_now
     and (expires_at is null or expires_at > v_now)
     and revoked_at is null
   order by starts_at desc, created_at desc, id
   limit 1 for update;
  if not found then
    insert into public.access_grants(id, workspace_id, plan_key, source,
      starts_at, expires_at, revoked_at, created_by_user_id, reason, created_at)
    values (extensions.gen_random_uuid()::text, v_workspace_id, p_plan_key,
      v_source, v_now, v_expires, null, null, p_reason, v_now)
    returning * into v_grant;
    insert into public.audit_events(id, actor_user_id, event_type, resource_type,
      resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'ACCESS_GRANTED',
      'AccessGrant', v_grant.id, v_now,
      pg_catalog.json_build_object('plan_key', p_plan_key, 'source', v_source,
        'expires_at', v_expires, 'reason', p_reason)::text);
  end if;
  return pg_catalog.jsonb_build_object('status', 'granted', 'userId', v_user.id,
    'workspaceId', v_workspace_id, 'grantId', v_grant.id, 'planKey', v_grant.plan_key,
    'source', v_grant.source, 'startsAt', v_grant.starts_at, 'expiresAt', v_grant.expires_at);
end;
$function$;

create or replace function al_private.al_operator_revoke_coach_access(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype;
  v_grant public.access_grants%rowtype;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_count integer := 0;
begin
  if v_email is null or v_email = '' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid account email';
  end if;
  select * into v_user from public.users
   where pg_catalog.lower(email) = v_email for update;
  if not found then raise exception 'account not found'; end if;
  select * into v_workspace from public.workspaces
   where owner_user_id = v_user.id for update;
  if not found then return pg_catalog.jsonb_build_object('revokedCount', 0); end if;

  for v_grant in
    select * from public.access_grants
     where workspace_id = v_workspace.id and starts_at <= v_now
       and (expires_at is null or expires_at > v_now) and revoked_at is null
     order by starts_at desc, created_at desc, id for update
  loop
    update public.access_grants set revoked_at = v_now where id = v_grant.id;
    insert into public.audit_events(id, actor_user_id, event_type, resource_type,
      resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'ACCESS_REVOKED',
      'AccessGrant', v_grant.id, v_now,
      pg_catalog.json_build_object('plan_key', v_grant.plan_key, 'source', v_grant.source)::text);
    v_count := v_count + 1;
  end loop;
  return pg_catalog.jsonb_build_object('revokedCount', v_count,
    'workspaceId', v_workspace.id);
end;
$function$;

create or replace function al_private.al_operator_link_billing_customer(
  p_email text,
  p_customer_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_user public.users%rowtype;
  v_workspace_id text;
  v_existing public.billing_customers%rowtype;
  v_id text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if v_email is null or v_email = '' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid account email';
  end if;
  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'invalid Stripe customer identifier';
  end if;
  select * into v_user from public.users
   where pg_catalog.lower(email) = v_email for update;
  if not found then raise exception 'account not found'; end if;
  if v_user.role <> 'COACH' then raise exception 'billing customer requires a coach account'; end if;

  v_workspace_id := al_private.al_operator_ensure_coach_workspace(v_user.id);
  select * into v_existing from public.billing_customers
   where workspace_id = v_workspace_id and provider = 'stripe' for update;
  if found then
    if v_existing.provider_customer_id <> p_customer_id then
      raise exception 'workspace already has a Stripe customer mapping';
    end if;
    return pg_catalog.jsonb_build_object('status', 'already_linked',
      'workspaceId', v_workspace_id,
      'customerMasked', pg_catalog.left(p_customer_id, 5) || '…' || pg_catalog.right(p_customer_id, 4));
  end if;
  select * into v_existing from public.billing_customers
   where provider = 'stripe' and provider_customer_id = p_customer_id for update;
  if found and v_existing.workspace_id <> v_workspace_id then
    raise exception 'Stripe customer is already linked to another workspace';
  end if;

  v_id := extensions.gen_random_uuid()::text;
  insert into public.billing_customers(id, workspace_id, provider,
    provider_customer_id, created_at, updated_at)
  values (v_id, v_workspace_id, 'stripe', p_customer_id, v_now, v_now)
  on conflict do nothing;
  if not found then
    select * into v_existing from public.billing_customers
     where workspace_id = v_workspace_id and provider = 'stripe';
    if not found or v_existing.provider_customer_id <> p_customer_id then
      raise exception 'Stripe customer or workspace is already linked';
    end if;
    return pg_catalog.jsonb_build_object('status', 'already_linked',
      'workspaceId', v_workspace_id,
      'customerMasked', pg_catalog.left(p_customer_id, 5) || '…' || pg_catalog.right(p_customer_id, 4));
  end if;
  insert into public.audit_events(id, actor_user_id, event_type, resource_type,
    resource_id, created_at, metadata_json)
  values (extensions.gen_random_uuid()::text, null, 'BILLING_CUSTOMER_LINKED',
    'BillingCustomer', v_id, v_now,
    pg_catalog.jsonb_build_object('provider', 'stripe')::text);
  return pg_catalog.jsonb_build_object('status', 'linked', 'workspaceId', v_workspace_id,
    'customerMasked', pg_catalog.left(p_customer_id, 5) || '…' || pg_catalog.right(p_customer_id, 4));
end;
$function$;

-- Read-only support view. Effective entitlement is delegated to the same
-- account-access resolver used by the application when a live session exists.
create or replace function al_private.al_operator_access_inspect(
  p_email text,
  p_past_due_grace_days integer default 3
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype;
  v_session_id text;
  v_access jsonb;
  v_active_count integer := 0;
begin
  if v_email is null or v_email = '' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid account email';
  end if;
  if p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    raise exception 'past-due grace must be between 0 and 30 days';
  end if;
  select * into v_user from public.users where pg_catalog.lower(email) = v_email;
  if not found then raise exception 'account not found'; end if;
  select * into v_workspace from public.workspaces where owner_user_id = v_user.id;
  if found then
    select * into v_member from public.workspace_members
     where workspace_id = v_workspace.id and user_id = v_user.id;
    select count(*)::integer into v_active_count from public.coaching_relationships
     where coach_id = v_user.id and ended_at is null;
    select s.id into v_session_id from public.sessions s
     where s.user_id = v_user.id and s.jwt_id = s.id and s.revoked_at is null
       and s.expires_at > pg_catalog.timezone('utc', pg_catalog.clock_timestamp())
     order by s.expires_at desc, s.id limit 1;
    if v_session_id is not null then
      v_access := al_private.al_account_access_state(
        v_user.id, v_session_id, false, p_past_due_grace_days);
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'email', v_user.email,
    'role', v_user.role,
    'emailVerified', v_user.email_verified_at is not null or v_user.google_sub is not null,
    'workspace', case when v_workspace.id is null then null else
      pg_catalog.jsonb_build_object('id', v_workspace.id, 'name', v_workspace.name,
        'membershipRole', v_member.role) end,
    'effectiveAccess', v_access,
    'effectiveAccessStatus', case when v_user.role <> 'COACH' then 'not_coach'
      when v_workspace.id is null then 'no_workspace'
      when v_member.role is distinct from 'OWNER' then 'owner_membership_missing'
      when v_session_id is null then 'no_active_session'
      else 'resolved' end,
    'activeAthletes', v_active_count,
    'grants', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', g.id, 'planKey', g.plan_key, 'source', g.source, 'startsAt', g.starts_at,
      'expiresAt', g.expires_at, 'revokedAt', g.revoked_at, 'reason', g.reason)
      order by g.created_at desc, g.id) from public.access_grants g
      where g.workspace_id = v_workspace.id), '[]'::jsonb),
    'subscriptions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'provider', s.provider, 'planKey', s.plan_key, 'status', s.status,
      'currentPeriodEnd', s.current_period_end, 'cancelAtPeriodEnd', s.cancel_at_period_end)
      order by s.updated_at desc, s.id) from public.subscriptions s
      where s.workspace_id = v_workspace.id), '[]'::jsonb),
    'billingCustomers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'provider', c.provider, 'customerMasked', pg_catalog.left(c.provider_customer_id, 5) || '…' ||
        pg_catalog.right(c.provider_customer_id, 4)) order by c.provider)
      from public.billing_customers c where c.workspace_id = v_workspace.id), '[]'::jsonb),
    'checkout', (select pg_catalog.jsonb_build_object('status', r.status,
      'planKey', r.plan_key, 'expiresAt', r.expires_at)
      from public.billing_checkout_reservations r
      where r.workspace_id = v_workspace.id and r.provider = 'stripe'),
    'redeemedVouchers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', v.id, 'codePrefix', v.code_prefix, 'planKey', v.plan_key,
      'redeemedAt', v.redeemed_at, 'paymentReference', v.payment_reference)
      order by v.redeemed_at desc, v.id) from public.vouchers v
      where v.redeemed_by_user_id = v_user.id), '[]'::jsonb)
  );
end;
$function$;

revoke all on function al_private.al_operator_ensure_coach_workspace(text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_operator_promote_coach(text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_operator_grant_coach_access(text, text, integer, boolean, text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_operator_revoke_coach_access(text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_operator_link_billing_customer(text, text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_operator_access_inspect(text, integer)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;

grant execute on function al_private.al_operator_ensure_coach_workspace(text) to postgres;
grant execute on function al_private.al_operator_promote_coach(text) to postgres;
grant execute on function al_private.al_operator_grant_coach_access(text, text, integer, boolean, text) to postgres;
grant execute on function al_private.al_operator_revoke_coach_access(text) to postgres;
grant execute on function al_private.al_operator_link_billing_customer(text, text) to postgres;
grant execute on function al_private.al_operator_access_inspect(text, integer) to postgres;

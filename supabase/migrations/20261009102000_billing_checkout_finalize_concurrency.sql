-- Concurrent retry/webhook winners must not orphan or re-expose a Checkout URL.
create or replace function al_private.al_billing_checkout_claim(
  p_actor text,
  p_session text,
  p_enforce boolean,
  p_plan text,
  p_request text
) returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_ctx jsonb;
  v_workspace public.workspaces%rowtype;
  v_row public.billing_checkout_reservations%rowtype;
  v_now timestamp without time zone := timezone('utc', clock_timestamp());
  v_current boolean;
begin
  v_ctx := al_private.al_billing_owner(p_actor, p_session, p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_plan not in ('coach_starter', 'coach_pro', 'coach_unlimited') or
     p_request !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('error', 'invalid_request');
  end if;

  select * into v_workspace
  from public.workspaces
  where id = v_ctx->>'workspaceId'
  for update;
  if not found then return jsonb_build_object('denial', 'billing_owner_required'); end if;

  select exists(
    select 1 from public.subscriptions s
    where s.workspace_id = v_workspace.id and s.provider = 'stripe'
      and s.status <> 'EXPIRED'
      and not (s.status = 'CANCELED' and s.current_period_end is not null and s.current_period_end <= v_now)
  ) into v_current;
  if v_current then return jsonb_build_object('error', 'subscription_exists'); end if;

  select * into v_row
  from public.billing_checkout_reservations
  where workspace_id = v_workspace.id and provider = 'stripe'
  for update;
  if found and v_row.request_id = p_request and v_row.plan_key <> p_plan then
    return jsonb_build_object('error', 'request_conflict');
  end if;
  if found and v_row.status = 'OPEN' and coalesce(v_row.expires_at, 'infinity'::timestamp) > v_now then
    if v_row.plan_key <> p_plan then return jsonb_build_object('error', 'checkout_in_progress'); end if;
    return jsonb_build_object('action', 'resume', 'url', v_row.provider_checkout_url,
      'requestId', v_row.request_id, 'planKey', v_row.plan_key);
  end if;
  if found and v_row.status = 'OPEN' and v_row.expires_at <= v_now then
    return jsonb_build_object('action', 'expire', 'sessionId', v_row.provider_checkout_session_id,
      'requestId', v_row.request_id);
  end if;
  if found and v_row.status = 'CREATING' then
    if v_row.plan_key <> p_plan or v_now - v_row.created_at > interval '23 hours' or
       (v_row.request_id <> p_request and v_now - v_row.updated_at < interval '10 minutes') then
      return jsonb_build_object('error', 'checkout_in_progress');
    end if;
    update public.billing_checkout_reservations set updated_at = v_now where id = v_row.id;
    return jsonb_build_object('action', 'recover', 'requestId', v_row.request_id, 'planKey', v_row.plan_key);
  end if;
  if found and v_row.request_id = p_request and v_row.status <> 'FAILED' then
    return jsonb_build_object('error', 'request_conflict');
  end if;

  if v_row.id is null then
    insert into public.billing_checkout_reservations(id, workspace_id, provider, request_id, plan_key, status, created_at, updated_at)
    values(extensions.gen_random_uuid()::text, v_workspace.id, 'stripe', p_request, p_plan, 'CREATING', v_now, v_now);
  else
    update public.billing_checkout_reservations
    set request_id = p_request, plan_key = p_plan, provider_checkout_session_id = null,
        provider_checkout_url = null, expires_at = null, status = 'CREATING', created_at = v_now, updated_at = v_now
    where id = v_row.id;
  end if;
  select * into v_row from public.billing_checkout_reservations
    where workspace_id = v_workspace.id and provider = 'stripe';
  insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
  values(extensions.gen_random_uuid()::text, p_actor, 'CHECKOUT_RESERVED', 'BillingCheckoutReservation', v_row.id, v_now,
    jsonb_build_object('provider', 'stripe', 'plan_key', v_row.plan_key, 'request_id', v_row.request_id)::text);
  return jsonb_build_object('action', 'create', 'requestId', v_row.request_id, 'planKey', v_row.plan_key);
end;
$function$;

create or replace function al_private.al_billing_checkout_finalize(
  p_actor text,
  p_session text,
  p_enforce boolean,
  p_request text,
  p_session_id text,
  p_url text,
  p_expires bigint
) returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_ctx jsonb;
  v_row public.billing_checkout_reservations%rowtype;
  v_now timestamp without time zone := timezone('utc', clock_timestamp());
begin
  v_ctx := al_private.al_billing_owner(p_actor, p_session, p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_session_id !~ '^cs_' or p_url !~ '^https://checkout[.]stripe[.]com/' or p_expires <= 0 then
    return jsonb_build_object('error', 'provider_state_unsafe');
  end if;

  perform 1 from public.workspaces where id = v_ctx->>'workspaceId' for update;
  select * into v_row
  from public.billing_checkout_reservations
  where workspace_id = v_ctx->>'workspaceId' and provider = 'stripe'
  for update;
  if not found or v_row.request_id <> p_request then
    return jsonb_build_object('error', 'checkout_in_progress');
  end if;

  if v_row.status = 'OPEN' then
    if v_row.provider_checkout_session_id = p_session_id and v_row.provider_checkout_url = p_url then
      return jsonb_build_object('ok', true, 'resumed', true);
    end if;
    return jsonb_build_object('error', 'checkout_in_progress');
  end if;
  if v_row.status = 'COMPLETED' then
    return jsonb_build_object('error', 'subscription_exists');
  end if;
  if v_row.status <> 'CREATING' then
    return jsonb_build_object('error', 'checkout_in_progress');
  end if;

  update public.billing_checkout_reservations
  set provider_checkout_session_id = p_session_id,
      provider_checkout_url = p_url,
      expires_at = timezone('utc', to_timestamp(p_expires)),
      status = 'OPEN',
      updated_at = v_now
  where id = v_row.id;

  insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
  values(extensions.gen_random_uuid()::text, p_actor, 'CHECKOUT_CREATED', 'BillingCheckoutReservation', v_row.id, v_now,
    jsonb_build_object('provider', 'stripe', 'plan_key', v_row.plan_key, 'request_id', v_row.request_id)::text);
  return jsonb_build_object('ok', true, 'resumed', false);
end;
$function$;

revoke all on function al_private.al_billing_checkout_claim(text,text,boolean,text,text)
  from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.al_billing_checkout_claim(text,text,boolean,text,text)
  to al_edge_catalog_runtime;
revoke all on function al_private.al_billing_checkout_finalize(text,text,boolean,text,text,text,bigint)
  from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.al_billing_checkout_finalize(text,text,boolean,text,text,text,bigint)
  to al_edge_catalog_runtime;

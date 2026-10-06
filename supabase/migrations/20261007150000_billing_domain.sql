-- Billing routes use narrow private RPCs. App plans remain athlete-owned.

create or replace function al_private.al_billing_secret(p_name text)
returns text language plpgsql stable security definer set search_path=''
as $function$
declare v_value text;
begin
  if p_name not in (
    'adaptive_lifting_voucher_code_secret',
    'adaptive_lifting_stripe_billing_enabled',
    'adaptive_lifting_stripe_secret_key',
    'adaptive_lifting_stripe_webhook_secret',
    'adaptive_lifting_stripe_price_coach_starter',
    'adaptive_lifting_stripe_price_coach_pro',
    'adaptive_lifting_stripe_price_coach_unlimited',
    'adaptive_lifting_stripe_expect_livemode'
  ) then return null; end if;
  select d.decrypted_secret into v_value from vault.decrypted_secrets d where d.name=p_name;
  if not found or nullif(pg_catalog.btrim(v_value),'') is null then return null; end if;
  return v_value;
end;
$function$;

create or replace function al_private.al_billing_owner(p_actor text,p_session text,p_enforce boolean)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_ctx jsonb; v_workspace public.workspaces%rowtype; v_user public.users%rowtype; v_member public.workspace_members%rowtype;
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if v_ctx->>'role'<>'COACH' then return jsonb_build_object('denial','billing_owner_required'); end if;
  select * into v_user from public.users where id=p_actor;
  select * into v_workspace from public.workspaces where owner_user_id=p_actor;
  if not found then return jsonb_build_object('denial','billing_owner_required'); end if;
  select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=p_actor;
  if not found or v_member.role<>'OWNER' then return jsonb_build_object('denial','billing_owner_required'); end if;
  return jsonb_build_object('denial',null,'userId',v_user.id,'email',v_user.email,
    'displayName',v_user.display_name,'workspaceId',v_workspace.id,'workspaceName',v_workspace.name);
end;
$function$;

create or replace function al_private.al_billing_customer_context(p_actor text,p_session text,p_enforce boolean)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_customer public.billing_customers%rowtype;
begin
  v_ctx:=al_private.al_billing_owner(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  select * into v_customer from public.billing_customers where workspace_id=v_ctx->>'workspaceId' and provider='stripe';
  return v_ctx || jsonb_build_object('customerId',v_customer.provider_customer_id);
end;
$function$;

create or replace function al_private.al_billing_customer_link(p_actor text,p_session text,p_enforce boolean,p_customer text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_workspace text; v_existing public.billing_customers%rowtype; v_id text;
begin
  v_ctx:=al_private.al_billing_owner(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  v_workspace:=v_ctx->>'workspaceId';
  if p_customer !~ '^cus_[A-Za-z0-9]+$' then return jsonb_build_object('error','customer_unavailable'); end if;
  perform 1 from public.workspaces where id=v_workspace for update;
  select * into v_existing from public.billing_customers where workspace_id=v_workspace and provider='stripe' for update;
  if found then
    if v_existing.provider_customer_id<>p_customer then return jsonb_build_object('error','customer_unavailable'); end if;
    return jsonb_build_object('customerId',v_existing.provider_customer_id);
  end if;
  if exists(select 1 from public.billing_customers where provider='stripe' and provider_customer_id=p_customer) then
    return jsonb_build_object('error','customer_unavailable');
  end if;
  v_id:=extensions.gen_random_uuid()::text;
  insert into public.billing_customers(id,workspace_id,provider,provider_customer_id,created_at,updated_at)
  values(v_id,v_workspace,'stripe',p_customer,timezone('utc',clock_timestamp()),timezone('utc',clock_timestamp()))
  on conflict do nothing;
  if not found then
    select * into v_existing from public.billing_customers where workspace_id=v_workspace and provider='stripe';
    if not found or v_existing.provider_customer_id<>p_customer then return jsonb_build_object('error','customer_unavailable'); end if;
    return jsonb_build_object('customerId',v_existing.provider_customer_id);
  end if;
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'BILLING_CUSTOMER_LINKED','BillingCustomer',v_id,
    timezone('utc',clock_timestamp()),jsonb_build_object('provider','stripe')::text);
  return jsonb_build_object('customerId',p_customer);
end;
$function$;

create or replace function al_private.al_billing_checkout_claim(
  p_actor text,p_session text,p_enforce boolean,p_plan text,p_request text
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_workspace public.workspaces%rowtype; v_row public.billing_checkout_reservations%rowtype;
  v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_current boolean;
begin
  v_ctx:=al_private.al_billing_owner(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_plan not in ('coach_starter','coach_pro','coach_unlimited') or p_request !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('error','invalid_request'); end if;
  select * into v_workspace from public.workspaces where id=v_ctx->>'workspaceId' for update;
  if not found then return jsonb_build_object('denial','billing_owner_required'); end if;
  select exists(select 1 from public.subscriptions s where s.workspace_id=v_workspace.id and s.provider='stripe'
    and s.status<>'EXPIRED' and not(s.status='CANCELED' and s.current_period_end is not null and s.current_period_end<=v_now)) into v_current;
  if v_current then return jsonb_build_object('error','subscription_exists'); end if;
  select * into v_row from public.billing_checkout_reservations where workspace_id=v_workspace.id and provider='stripe' for update;
  if found and v_row.request_id=p_request and v_row.plan_key<>p_plan then return jsonb_build_object('error','request_conflict'); end if;
  if found and v_row.status='OPEN' and coalesce(v_row.expires_at,'infinity'::timestamp)>v_now then
    if v_row.plan_key<>p_plan then return jsonb_build_object('error','checkout_in_progress'); end if;
    return jsonb_build_object('action','resume','url',v_row.provider_checkout_url,'requestId',v_row.request_id,'planKey',v_row.plan_key);
  end if;
  if found and v_row.status='OPEN' and v_row.expires_at<=v_now then
    return jsonb_build_object('action','expire','sessionId',v_row.provider_checkout_session_id,'requestId',v_row.request_id);
  end if;
  if found and v_row.status='CREATING' then
    if v_row.plan_key<>p_plan or v_now-v_row.created_at>interval '23 hours' or
      (v_row.request_id<>p_request and v_now-v_row.updated_at<interval '10 minutes') then
      return jsonb_build_object('error','checkout_in_progress');
    end if;
    update public.billing_checkout_reservations set updated_at=v_now where id=v_row.id;
    return jsonb_build_object('action','recover','requestId',v_row.request_id,'planKey',v_row.plan_key);
  end if;
  if found and v_row.request_id=p_request and v_row.status<>'FAILED' then return jsonb_build_object('error','request_conflict'); end if;
  if v_row.id is null then
    insert into public.billing_checkout_reservations(id,workspace_id,provider,request_id,plan_key,status,created_at,updated_at)
    values(extensions.gen_random_uuid()::text,v_workspace.id,'stripe',p_request,p_plan,'CREATING',v_now,v_now);
  else
    update public.billing_checkout_reservations set request_id=p_request,plan_key=p_plan,
      provider_checkout_session_id=null,provider_checkout_url=null,expires_at=null,status='CREATING',created_at=v_now,updated_at=v_now
     where id=v_row.id;
  end if;
  select * into v_row from public.billing_checkout_reservations where workspace_id=v_workspace.id and provider='stripe';
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'CHECKOUT_RESERVED','BillingCheckoutReservation',v_row.id,v_now,
    jsonb_build_object('provider','stripe','plan_key',v_row.plan_key,'request_id',v_row.request_id)::text);
  return jsonb_build_object('action','create','requestId',v_row.request_id,'planKey',v_row.plan_key);
end;
$function$;

create or replace function al_private.al_billing_checkout_expired(p_actor text,p_session text,p_enforce boolean,p_request text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_row public.billing_checkout_reservations%rowtype;
begin
  v_ctx:=al_private.al_billing_owner(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  perform 1 from public.workspaces where id=v_ctx->>'workspaceId' for update;
  select * into v_row from public.billing_checkout_reservations where workspace_id=v_ctx->>'workspaceId' and provider='stripe' for update;
  if not found or v_row.request_id<>p_request or v_row.status<>'OPEN' or v_row.expires_at>v_now then return jsonb_build_object('error','provider_state_unsafe'); end if;
  update public.billing_checkout_reservations set status='EXPIRED',updated_at=v_now where id=v_row.id;
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'CHECKOUT_EXPIRED','BillingCheckoutReservation',v_row.id,v_now,
    jsonb_build_object('provider','stripe','plan_key',v_row.plan_key,'request_id',v_row.request_id)::text);
  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function al_private.al_billing_checkout_fail(p_actor text,p_session text,p_enforce boolean,p_request text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_row public.billing_checkout_reservations%rowtype; v_now timestamp without time zone:=timezone('utc',clock_timestamp());
begin
  v_ctx:=al_private.al_billing_owner(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  perform 1 from public.workspaces where id=v_ctx->>'workspaceId' for update;
  select * into v_row from public.billing_checkout_reservations where workspace_id=v_ctx->>'workspaceId' and provider='stripe' for update;
  if found and v_row.request_id=p_request and v_row.status='CREATING' then
    update public.billing_checkout_reservations set status='FAILED',updated_at=v_now where id=v_row.id;
    insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,p_actor,'CHECKOUT_FAILED','BillingCheckoutReservation',v_row.id,v_now,
      jsonb_build_object('provider','stripe','plan_key',v_row.plan_key,'request_id',v_row.request_id)::text);
  end if;
  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function al_private.al_billing_checkout_finalize(
  p_actor text,p_session text,p_enforce boolean,p_request text,p_session_id text,p_url text,p_expires bigint
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_row public.billing_checkout_reservations%rowtype; v_now timestamp without time zone:=timezone('utc',clock_timestamp());
begin
  v_ctx:=al_private.al_billing_owner(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_session_id !~ '^cs_' or p_url !~ '^https://checkout[.]stripe[.]com/' or p_expires<=0 then return jsonb_build_object('error','provider_state_unsafe'); end if;
  perform 1 from public.workspaces where id=v_ctx->>'workspaceId' for update;
  select * into v_row from public.billing_checkout_reservations where workspace_id=v_ctx->>'workspaceId' and provider='stripe' for update;
  if not found or v_row.request_id<>p_request or v_row.status<>'CREATING' then return jsonb_build_object('error','checkout_in_progress'); end if;
  update public.billing_checkout_reservations set provider_checkout_session_id=p_session_id,provider_checkout_url=p_url,
    expires_at=timezone('utc',to_timestamp(p_expires)),status='OPEN',updated_at=v_now where id=v_row.id;
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'CHECKOUT_CREATED','BillingCheckoutReservation',v_row.id,v_now,
    jsonb_build_object('provider','stripe','plan_key',v_row.plan_key,'request_id',v_row.request_id)::text);
  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function al_private.al_voucher_actor(p_actor text,p_session text,p_enforce boolean)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_ctx jsonb;
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if v_ctx->>'role'<>'COACH' then return jsonb_build_object('denial','voucher_coach_required'); end if;
  return v_ctx;
end;
$function$;

create or replace function al_private.al_voucher_rate_limit(p_user text,p_ip text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_min timestamp without time zone; v_hour timestamp without time zone;
  v_ip_hash text; v_user_hash text; v_ip_min integer; v_ip_hour integer; v_user_min integer; v_user_hour integer;
begin
  v_min:=date_trunc('minute',v_now); v_hour:=date_trunc('hour',v_now);
  v_ip_hash:=encode(extensions.digest('voucher:ip:'||coalesce(p_ip,'unknown'),'sha256'),'hex');
  v_user_hash:=encode(extensions.digest('voucher:user:'||coalesce(p_user,''),'sha256'),'hex');
  insert into public.voucher_redemption_limits(subject_hash,minute_started_at,minute_count,hour_started_at,hour_count,updated_at)
  values(v_ip_hash,v_min,1,v_hour,1,v_now)
  on conflict(subject_hash) do update set
    minute_count=case when voucher_redemption_limits.minute_started_at=excluded.minute_started_at then voucher_redemption_limits.minute_count+1 else 1 end,
    minute_started_at=excluded.minute_started_at,
    hour_count=case when voucher_redemption_limits.hour_started_at=excluded.hour_started_at then voucher_redemption_limits.hour_count+1 else 1 end,
    hour_started_at=excluded.hour_started_at,updated_at=excluded.updated_at
  returning minute_count,hour_count into v_ip_min,v_ip_hour;
  insert into public.voucher_redemption_limits(subject_hash,minute_started_at,minute_count,hour_started_at,hour_count,updated_at)
  values(v_user_hash,v_min,1,v_hour,1,v_now)
  on conflict(subject_hash) do update set
    minute_count=case when voucher_redemption_limits.minute_started_at=excluded.minute_started_at then voucher_redemption_limits.minute_count+1 else 1 end,
    minute_started_at=excluded.minute_started_at,
    hour_count=case when voucher_redemption_limits.hour_started_at=excluded.hour_started_at then voucher_redemption_limits.hour_count+1 else 1 end,
    hour_started_at=excluded.hour_started_at,updated_at=excluded.updated_at
  returning minute_count,hour_count into v_user_min,v_user_hour;
  return jsonb_build_object('allowed',v_ip_min<=5 and v_ip_hour<=20 and v_user_min<=5 and v_user_hour<=20);
end;
$function$;

create or replace function al_private.al_voucher_redeem(p_actor text,p_session text,p_enforce boolean,p_hash text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype; v_member public.workspace_members%rowtype; v_voucher public.vouchers%rowtype;
  v_latest public.access_grants%rowtype; v_start timestamp without time zone; v_end timestamp without time zone; v_grant_id text;
begin
  v_ctx:=al_private.al_voucher_actor(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('denial','invalid'); end if;
  select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_actor and s.id=p_session and s.jwt_id=p_session and s.revoked_at is null and s.expires_at>v_now for update of u;
  if not found then return jsonb_build_object('denial','invalid_session'); end if;
  if v_user.deleted_at is not null or (v_user.email_verified_at is null and v_user.google_sub is null and v_user.email_verification_required) then return jsonb_build_object('denial','account_ineligible'); end if;
  select * into v_voucher from public.vouchers where code_hash=p_hash for update;
  if not found or v_voucher.assigned_user_id<>p_actor or v_voucher.source<>'offline_payment' or
     v_voucher.plan_key not in ('coach_starter','coach_pro','coach_unlimited') or v_voucher.duration_days<=0 or
     v_voucher.redeemed_at is not null or v_voucher.revoked_at is not null or (v_voucher.expires_at is not null and v_voucher.expires_at<=v_now) then
    return jsonb_build_object('denial','invalid'); end if;
  update public.vouchers set redeemed_at=v_now,redeemed_by_user_id=p_actor where id=v_voucher.id
    and assigned_user_id=p_actor and redeemed_at is null and revoked_at is null and (expires_at is null or expires_at>v_now);
  if not found then return jsonb_build_object('denial','invalid'); end if;
  select * into v_workspace from public.workspaces where owner_user_id=p_actor for update;
  if not found then
    insert into public.workspaces(id,name,owner_user_id,created_at,updated_at)
    values(extensions.gen_random_uuid()::text,coalesce(nullif(btrim(v_user.display_name),''),split_part(v_user.email,'@',1))||' Coaching',p_actor,v_now,v_now)
    on conflict(owner_user_id) do nothing;
    select * into v_workspace from public.workspaces where owner_user_id=p_actor for update;
    if not found then raise exception 'workspace initialization failed'; end if;
    insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,null,'WORKSPACE_CREATED','Workspace',v_workspace.id,v_now,jsonb_build_object('owner_user_id',p_actor)::text);
  end if;
  select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=p_actor for update;
  if not found then
    insert into public.workspace_members(id,workspace_id,user_id,role,created_at) values(extensions.gen_random_uuid()::text,v_workspace.id,p_actor,'OWNER',v_now);
    insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,null,'WORKSPACE_MEMBER_ADDED','Workspace',v_workspace.id,v_now,jsonb_build_object('user_id',p_actor,'role','OWNER')::text);
  elsif v_member.role<>'OWNER' then return jsonb_build_object('denial','invalid'); end if;
  update public.workspaces set updated_at=v_now where id=v_workspace.id;
  select * into v_latest from public.access_grants where workspace_id=v_workspace.id and source='offline_payment'
    and plan_key=v_voucher.plan_key and revoked_at is null and expires_at>v_now order by expires_at desc,id limit 1 for update;
  v_start:=coalesce(v_latest.expires_at,v_now); v_end:=v_start+(v_voucher.duration_days*interval '1 day'); v_grant_id:=extensions.gen_random_uuid()::text;
  insert into public.access_grants(id,workspace_id,plan_key,source,starts_at,expires_at,created_by_user_id,reason,created_at)
  values(v_grant_id,v_workspace.id,v_voucher.plan_key,'offline_payment',v_start,v_end,v_voucher.created_by_user_id,'voucher:'||v_voucher.id,v_now);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'VOUCHER_REDEEMED','Voucher',v_voucher.id,v_now,
    jsonb_build_object('voucher_id',v_voucher.id,'plan_key',v_voucher.plan_key,'duration_days',v_voucher.duration_days,'assigned_user_id',p_actor,'payment_reference',v_voucher.payment_reference)::text);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'ACCESS_GRANTED','AccessGrant',v_grant_id,v_now,
    jsonb_build_object('plan_key',v_voucher.plan_key,'source','offline_payment','expires_at',v_end,'reason','voucher:'||v_voucher.id)::text);
  return jsonb_build_object('denial',null,'planKey',v_voucher.plan_key,'durationDays',v_voucher.duration_days,'grantId',v_grant_id);
end;
$function$;

create or replace function al_private.al_stripe_webhook_apply(p_event jsonb,p_grace integer)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_event_id text:=p_event->>'id'; v_event_type text:=p_event->>'type'; v_created bigint; v_now timestamp without time zone:=timezone('utc',clock_timestamp());
  v_inbox public.webhook_events%rowtype; v_obj jsonb; v_items jsonb; v_item jsonb; v_price jsonb; v_price_id text; v_plan text;
  v_customer_id text; v_customer public.billing_customers%rowtype; v_workspace public.workspaces%rowtype; v_sub_id text; v_sub public.subscriptions%rowtype;
  v_status text; v_cancel boolean; v_start timestamp without time zone; v_end timestamp without time zone; v_canceled timestamp without time zone; v_ended timestamp without time zone;
  v_event_time timestamp without time zone; v_stale boolean:=false; v_changed boolean:=false; v_state_changed boolean:=false; v_old_status text; v_old_plan text; v_res public.billing_checkout_reservations%rowtype;
begin
  if v_event_id is null or v_event_id='' or v_event_type is null or jsonb_typeof(p_event->'created')<>'number' then return jsonb_build_object('status','failed'); end if;
  v_created:=(p_event->>'created')::bigint; v_event_time:=timezone('utc',to_timestamp(v_created));
  insert into public.webhook_events(id,provider,external_event_id,received_at,status,attempt_count)
  values(extensions.gen_random_uuid()::text,'stripe',v_event_id,v_now,'PROCESSING',0) on conflict(external_event_id) do nothing;
  select * into v_inbox from public.webhook_events where provider='stripe' and external_event_id=v_event_id for update;
  if v_inbox.status in ('PROCESSED','IGNORED','STALE') then return jsonb_build_object('status','duplicate'); end if;
  update public.webhook_events set status='PROCESSING',attempt_count=attempt_count+1,processed_at=null where id=v_inbox.id;
  if p_event ? 'account' then
    update public.webhook_events set status='IGNORED',processed_at=v_now where id=v_inbox.id;
    return jsonb_build_object('status','ignored_connect');
  end if;
  if v_event_type not in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed') then
    update public.webhook_events set status='IGNORED',processed_at=v_now where id=v_inbox.id;
    return jsonb_build_object('status','ignored');
  end if;
  begin
    v_obj:=p_event->'data'->'object';
    if jsonb_typeof(v_obj)<>'object' then raise exception 'invalid subscription object'; end if;
    v_sub_id:=v_obj->>'id'; v_customer_id:=case when jsonb_typeof(v_obj->'customer')='object' then v_obj->'customer'->>'id' else v_obj->>'customer' end;
    v_items:=v_obj->'items'->'data';
    if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)<>1 then raise exception 'invalid subscription item count'; end if;
    v_item:=v_items->0; v_price:=v_item->'price';
    if jsonb_typeof(v_price)<>'object' or jsonb_typeof(v_price->'recurring')<>'object' then raise exception 'non-recurring price'; end if;
    v_price_id:=v_price->>'id';
    if v_price_id=al_private.al_billing_secret('adaptive_lifting_stripe_price_coach_starter') then v_plan:='coach_starter';
    elsif v_price_id=al_private.al_billing_secret('adaptive_lifting_stripe_price_coach_pro') then v_plan:='coach_pro';
    elsif v_price_id=al_private.al_billing_secret('adaptive_lifting_stripe_price_coach_unlimited') then v_plan:='coach_unlimited';
    else raise exception 'unknown price'; end if;
    v_status:=case v_obj->>'status' when 'trialing' then 'TRIALING' when 'active' then 'ACTIVE' when 'past_due' then 'PAST_DUE'
      when 'canceled' then 'CANCELED' when 'incomplete' then 'INCOMPLETE' when 'incomplete_expired' then 'EXPIRED'
      when 'unpaid' then 'EXPIRED' when 'paused' then 'EXPIRED' else null end;
    if v_status is null or v_sub_id is null or v_customer_id is null then raise exception 'unknown status or missing identity'; end if;
    if jsonb_typeof(v_obj->'cancel_at_period_end') not in ('boolean','null') and v_obj ? 'cancel_at_period_end' then raise exception 'invalid cancellation flag'; end if;
    v_cancel:=coalesce((v_obj->>'cancel_at_period_end')::boolean,false);
    if v_obj ? 'current_period_start' and jsonb_typeof(v_obj->'current_period_start')='number' then v_start:=timezone('utc',to_timestamp((v_obj->>'current_period_start')::bigint)); end if;
    if v_obj ? 'current_period_end' and jsonb_typeof(v_obj->'current_period_end')='number' then v_end:=timezone('utc',to_timestamp((v_obj->>'current_period_end')::bigint)); end if;
    if v_obj ? 'canceled_at' and jsonb_typeof(v_obj->'canceled_at')='number' then v_canceled:=timezone('utc',to_timestamp((v_obj->>'canceled_at')::bigint)); end if;
    if v_obj ? 'ended_at' and jsonb_typeof(v_obj->'ended_at')='number' then v_ended:=timezone('utc',to_timestamp((v_obj->>'ended_at')::bigint)); end if;
    if v_start is not null and v_end is not null and v_end<v_start then raise exception 'invalid period'; end if;
    select * into v_customer from public.billing_customers where provider='stripe' and provider_customer_id=v_customer_id for share;
    if not found then raise exception 'unknown customer'; end if;
    perform 1 from public.workspaces where id=v_customer.workspace_id for update;
    select * into v_sub from public.subscriptions where provider='stripe' and provider_subscription_id=v_sub_id for update;
    if found and v_sub.workspace_id<>v_customer.workspace_id then raise exception 'subscription workspace mismatch'; end if;
    if found and v_sub.provider_event_created_at is not null and
      (v_event_time,v_event_id)<=(v_sub.provider_event_created_at,coalesce(v_sub.provider_event_id,'')) then
      v_stale:=true;
    else
      v_old_status:=v_sub.status; v_old_plan:=v_sub.plan_key;
      v_state_changed:=not found or v_sub.plan_key is distinct from v_plan or v_sub.status is distinct from v_status or
        v_sub.provider_customer_id is distinct from v_customer_id or v_sub.current_period_start is distinct from v_start or
        v_sub.current_period_end is distinct from v_end or v_sub.cancel_at_period_end is distinct from v_cancel or
        v_sub.canceled_at is distinct from v_canceled or v_sub.ended_at is distinct from v_ended;
      if not found then
        insert into public.subscriptions(id,workspace_id,provider,provider_customer_id,provider_subscription_id,plan_key,status,
          current_period_start,current_period_end,cancel_at_period_end,canceled_at,ended_at,provider_event_created_at,provider_event_id,created_at,updated_at)
        values(extensions.gen_random_uuid()::text,v_customer.workspace_id,'stripe',v_customer_id,v_sub_id,v_plan,v_status,
          v_start,v_end,v_cancel,v_canceled,v_ended,v_event_time,v_event_id,v_now,v_now) returning * into v_sub;
      else
        update public.subscriptions set provider_customer_id=v_customer_id,plan_key=v_plan,status=v_status,current_period_start=v_start,
          current_period_end=v_end,cancel_at_period_end=v_cancel,canceled_at=v_canceled,ended_at=v_ended,
          provider_event_created_at=v_event_time,provider_event_id=v_event_id,updated_at=v_now
         where id=v_sub.id returning * into v_sub;
      end if;
      if v_state_changed then
        insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
        values(extensions.gen_random_uuid()::text,null,
          case when v_old_status is null then 'SUBSCRIPTION_CREATED' when v_old_status<>v_status then 'SUBSCRIPTION_STATUS_CHANGED' else 'SUBSCRIPTION_UPDATED' end,
          'Subscription',v_sub.id,v_now,jsonb_build_object('provider','stripe','plan_key',v_plan,'old_plan_key',v_old_plan,
            'old_status',v_old_status,'new_status',v_status,'provider_event_id',v_event_id)::text);
      end if;
      if v_status not in ('CANCELED','EXPIRED') then
        select * into v_res from public.billing_checkout_reservations where workspace_id=v_customer.workspace_id and provider='stripe' for update;
        if found and v_res.status in ('CREATING','OPEN') and v_res.created_at<=v_event_time then
          update public.billing_checkout_reservations set status='COMPLETED',updated_at=v_now where id=v_res.id;
          if v_res.plan_key<>v_plan then
            insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
            values(extensions.gen_random_uuid()::text,null,'CHECKOUT_RECONCILIATION_MISMATCH','BillingCheckoutReservation',v_res.id,v_now,
              jsonb_build_object('provider','stripe','plan_key',v_res.plan_key,'provider_event_id',v_event_id)::text);
          end if;
          insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
          values(extensions.gen_random_uuid()::text,null,'CHECKOUT_COMPLETED','BillingCheckoutReservation',v_res.id,v_now,
            jsonb_build_object('provider','stripe','plan_key',v_res.plan_key,'provider_event_id',v_event_id)::text);
        end if;
      end if;
    end if;
    if v_stale then
      update public.webhook_events set status='STALE',processed_at=v_now where id=v_inbox.id;
      return jsonb_build_object('status','stale');
    end if;
    update public.webhook_events set status='PROCESSED',processed_at=v_now where id=v_inbox.id;
    return jsonb_build_object('status','processed');
  exception when others then
    -- This block is a subtransaction: subscription/audit/reservation mutations roll back,
    -- while the durable event inbox remains retryable and stores no payload.
    update public.webhook_events set status='FAILED',processed_at=v_now where id=v_inbox.id;
    return jsonb_build_object('status','failed');
  end;
end;
$function$;

create or replace function al_private.al_billing_operator_create_voucher(
  p_email text,p_plan text,p_days integer,p_valid_days integer default null,p_payment_reference text default null,p_notes text default null
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_user public.users%rowtype; v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_deadline timestamp without time zone;
  v_secret text; v_alphabet text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text:='VCH-'; v_chars text:=''; v_bytes bytea; v_i integer; v_candidate integer;
  v_hash text; v_id text; v_groups text[];
begin
  if p_plan not in ('coach_starter','coach_pro','coach_unlimited') or p_days is null or p_days<=0 or
    (p_valid_days is not null and p_valid_days<=0) or (p_payment_reference is not null and length(p_payment_reference)>120) or
    (p_notes is not null and length(p_notes)>500) then raise exception 'invalid voucher parameters'; end if;
  select * into v_user from public.users where lower(email)=lower(btrim(p_email)) and deleted_at is null and role='COACH';
  if not found then raise exception 'voucher recipient must be an existing coach'; end if;
  v_secret:=al_private.al_billing_secret('adaptive_lifting_voucher_code_secret');
  if v_secret is null or octet_length(v_secret)<32 then raise exception 'voucher secret unavailable'; end if;
  if p_valid_days is not null then v_deadline:=v_now+(p_valid_days*interval '1 day'); end if;
  while length(v_chars)<20 loop
    v_bytes:=extensions.gen_random_bytes(32);
    for v_i in 0..length(v_bytes)-1 loop
      v_candidate:=get_byte(v_bytes,v_i);
      if v_candidate<224 then
        v_chars:=v_chars||substr(v_alphabet,(v_candidate%32)+1,1);
        if length(v_chars)=20 then exit; end if;
      end if;
    end loop;
  end loop;
  v_groups:=array[substr(v_chars,1,5),substr(v_chars,6,5),substr(v_chars,11,5),substr(v_chars,16,5)];
  v_code:='VCH-'||array_to_string(v_groups,'-');
  v_hash:=encode(extensions.hmac(v_code,v_secret,'sha256'),'hex');
  v_id:=extensions.gen_random_uuid()::text;
  insert into public.vouchers(id,code_hash,code_prefix,plan_key,duration_days,source,assigned_user_id,payment_reference,expires_at,created_by_user_id,created_at,notes)
  values(v_id,v_hash,'VCH-'||substr(v_groups[1],1,4),p_plan,p_days,'offline_payment',v_user.id,p_payment_reference,v_deadline,null,v_now,p_notes);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,null,'VOUCHER_CREATED','Voucher',v_id,v_now,
    jsonb_build_object('voucher_id',v_id,'plan_key',p_plan,'duration_days',p_days,'assigned_user_id',v_user.id,'payment_reference',p_payment_reference)::text);
  return jsonb_build_object('id',v_id,'code',v_code,'codePrefix','VCH-'||substr(v_groups[1],1,4),'planKey',p_plan,'durationDays',p_days,
    'assignedEmail',v_user.email,'createdAt',v_now,'expiresAt',v_deadline,'paymentReference',p_payment_reference);
end;
$function$;

create or replace function al_private.al_billing_operator_inspect_voucher(p_code text)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_secret text; v_hash text; v_row public.vouchers%rowtype; v_email text;
begin
  v_secret:=al_private.al_billing_secret('adaptive_lifting_voucher_code_secret');
  if v_secret is null then raise exception 'voucher secret unavailable'; end if;
  if p_code !~* '^VCH-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}$' then raise exception 'voucher not found'; end if;
  v_hash:=encode(extensions.hmac(upper(btrim(p_code)),v_secret,'sha256'),'hex');
  select * into v_row from public.vouchers where code_hash=v_hash;
  if not found then raise exception 'voucher not found'; end if;
  select email into v_email from public.users where id=v_row.assigned_user_id;
  return jsonb_build_object('id',v_row.id,'codePrefix',v_row.code_prefix,'assignedEmail',v_email,'planKey',v_row.plan_key,
    'durationDays',v_row.duration_days,'paymentReference',v_row.payment_reference,'createdAt',v_row.created_at,'expiresAt',v_row.expires_at,
    'redeemedAt',v_row.redeemed_at,'redeemedByEmail',(select email from public.users where id=v_row.redeemed_by_user_id),'revokedAt',v_row.revoked_at);
end;
$function$;

create or replace function al_private.al_billing_operator_revoke_voucher(p_code text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_secret text; v_hash text; v_row public.vouchers%rowtype; v_now timestamp without time zone:=timezone('utc',clock_timestamp());
begin
  v_secret:=al_private.al_billing_secret('adaptive_lifting_voucher_code_secret');
  if v_secret is null then raise exception 'voucher secret unavailable'; end if;
  if p_code !~* '^VCH-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}$' then raise exception 'voucher not found'; end if;
  v_hash:=encode(extensions.hmac(upper(btrim(p_code)),v_secret,'sha256'),'hex');
  select * into v_row from public.vouchers where code_hash=v_hash for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_row.redeemed_at is not null then raise exception 'already redeemed; resulting grant is managed separately'; end if;
  if v_row.revoked_at is null then
    update public.vouchers set revoked_at=v_now where id=v_row.id;
    insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,null,'VOUCHER_REVOKED','Voucher',v_row.id,v_now,
      jsonb_build_object('voucher_id',v_row.id,'plan_key',v_row.plan_key,'assigned_user_id',v_row.assigned_user_id)::text);
  end if;
  return jsonb_build_object('id',v_row.id,'revoked',true);
end;
$function$;

create or replace function al_private.al_billing_operator_diagnostics(p_stale_minutes integer default 10)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
begin
  return jsonb_build_object(
    'voucherSecretConfigured',al_private.al_billing_secret('adaptive_lifting_voucher_code_secret') is not null,
    'stripeConfigured',al_private.al_billing_secret('adaptive_lifting_stripe_secret_key') is not null,
    'failedStripeWebhookEvents',(select count(*) from public.webhook_events where provider='stripe' and status='FAILED'),
    'staleCreatingCheckouts',(select count(*) from public.billing_checkout_reservations where provider='stripe' and status='CREATING' and updated_at<timezone('utc',clock_timestamp())-(greatest(coalesce(p_stale_minutes,10),0)*interval '1 minute')),
    'billingCustomers',(select count(*) from public.billing_customers where provider='stripe'),
    'stripeSubscriptions',(select coalesce(jsonb_agg(jsonb_build_object('workspaceId',workspace_id,'planKey',plan_key,'status',status,'periodEnd',current_period_end) order by updated_at desc),'[]'::jsonb) from public.subscriptions where provider='stripe')
  );
end;
$function$;

revoke all on function al_private.al_billing_secret(text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_owner(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_customer_context(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_customer_link(text,text,boolean,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_checkout_claim(text,text,boolean,text,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_checkout_expired(text,text,boolean,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_checkout_fail(text,text,boolean,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_checkout_finalize(text,text,boolean,text,text,text,bigint) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_voucher_actor(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_voucher_rate_limit(text,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_voucher_redeem(text,text,boolean,text) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_stripe_webhook_apply(jsonb,integer) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_billing_operator_create_voucher(text,text,integer,integer,text,text) from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
revoke all on function al_private.al_billing_operator_inspect_voucher(text) from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
revoke all on function al_private.al_billing_operator_revoke_voucher(text) from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
revoke all on function al_private.al_billing_operator_diagnostics(integer) from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
grant execute on function al_private.al_billing_secret(text) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_owner(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_customer_context(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_customer_link(text,text,boolean,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_checkout_claim(text,text,boolean,text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_checkout_expired(text,text,boolean,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_checkout_fail(text,text,boolean,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_billing_checkout_finalize(text,text,boolean,text,text,text,bigint) to al_edge_catalog_runtime;
grant execute on function al_private.al_voucher_actor(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_voucher_rate_limit(text,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_voucher_redeem(text,text,boolean,text) to al_edge_catalog_runtime;
grant execute on function al_private.al_stripe_webhook_apply(jsonb,integer) to al_edge_catalog_runtime;

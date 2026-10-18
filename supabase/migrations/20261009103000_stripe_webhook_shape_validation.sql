-- Keep the webhook inbox and subscription write atomic while validating every
-- normalized timestamp with the same strict type boundary as the reference.
create or replace function al_private.al_stripe_webhook_apply(p_event jsonb, p_grace integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_event_id text := p_event->>'id';
  v_event_type text := p_event->>'type';
  v_created bigint;
  v_now timestamp without time zone := timezone('utc', clock_timestamp());
  v_inbox public.webhook_events%rowtype;
  v_obj jsonb;
  v_items jsonb;
  v_price jsonb;
  v_price_id text;
  v_plan text;
  v_customer_id text;
  v_customer public.billing_customers%rowtype;
  v_sub_id text;
  v_sub public.subscriptions%rowtype;
  v_status text;
  v_cancel boolean;
  v_start timestamp without time zone;
  v_end timestamp without time zone;
  v_canceled timestamp without time zone;
  v_ended timestamp without time zone;
  v_event_time timestamp without time zone;
  v_stale boolean := false;
  v_state_changed boolean := false;
  v_old_status text;
  v_old_plan text;
  v_res public.billing_checkout_reservations%rowtype;
begin
  if v_event_id is null or v_event_id = '' or v_event_type is null or
     jsonb_typeof(p_event->'created') <> 'number' or (p_event->>'created') !~ '^[0-9]+$' then
    return jsonb_build_object('status', 'failed');
  end if;
  v_created := (p_event->>'created')::bigint;
  v_event_time := timezone('utc', to_timestamp(v_created));

  insert into public.webhook_events(id, provider, external_event_id, received_at, status, attempt_count)
  values(extensions.gen_random_uuid()::text, 'stripe', v_event_id, v_now, 'PROCESSING', 0)
  on conflict(external_event_id) do nothing;
  select * into v_inbox from public.webhook_events
    where provider = 'stripe' and external_event_id = v_event_id for update;
  if v_inbox.status in ('PROCESSED', 'IGNORED', 'STALE') then
    return jsonb_build_object('status', 'duplicate');
  end if;
  update public.webhook_events set status = 'PROCESSING', attempt_count = attempt_count + 1, processed_at = null
    where id = v_inbox.id;

  if p_event ? 'account' then
    update public.webhook_events set status = 'IGNORED', processed_at = v_now where id = v_inbox.id;
    return jsonb_build_object('status', 'ignored_connect');
  end if;
  if v_event_type not in (
    'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
    'customer.subscription.paused', 'customer.subscription.resumed'
  ) then
    update public.webhook_events set status = 'IGNORED', processed_at = v_now where id = v_inbox.id;
    return jsonb_build_object('status', 'ignored');
  end if;

  begin
    v_obj := p_event->'data'->'object';
    if jsonb_typeof(v_obj) <> 'object' then raise exception 'invalid subscription object'; end if;
    v_sub_id := v_obj->>'id';
    v_customer_id := case when jsonb_typeof(v_obj->'customer') = 'object'
      then v_obj->'customer'->>'id' else v_obj->>'customer' end;
    v_items := v_obj->'items'->'data';
    if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) <> 1 then
      raise exception 'invalid subscription item count';
    end if;
    v_price := v_items->0->'price';
    if jsonb_typeof(v_price) <> 'object' or jsonb_typeof(v_price->'recurring') <> 'object' then
      raise exception 'non-recurring price';
    end if;
    v_price_id := v_price->>'id';
    if v_price_id = al_private.al_billing_secret('adaptive_lifting_stripe_price_coach_starter') then
      v_plan := 'coach_starter';
    elsif v_price_id = al_private.al_billing_secret('adaptive_lifting_stripe_price_coach_pro') then
      v_plan := 'coach_pro';
    elsif v_price_id = al_private.al_billing_secret('adaptive_lifting_stripe_price_coach_unlimited') then
      v_plan := 'coach_unlimited';
    else
      raise exception 'unknown price';
    end if;

    v_status := case v_obj->>'status'
      when 'trialing' then 'TRIALING' when 'active' then 'ACTIVE' when 'past_due' then 'PAST_DUE'
      when 'canceled' then 'CANCELED' when 'incomplete' then 'INCOMPLETE'
      when 'incomplete_expired' then 'EXPIRED' when 'unpaid' then 'EXPIRED' when 'paused' then 'EXPIRED'
      else null end;
    if v_status is null or nullif(pg_catalog.btrim(v_sub_id), '') is null or
       nullif(pg_catalog.btrim(v_customer_id), '') is null then
      raise exception 'unknown status or missing identity';
    end if;
    if v_obj ? 'cancel_at_period_end' and jsonb_typeof(v_obj->'cancel_at_period_end') <> 'boolean' then
      raise exception 'invalid cancellation flag';
    end if;
    v_cancel := coalesce((v_obj->>'cancel_at_period_end')::boolean, false);

    if v_obj ? 'current_period_start' and jsonb_typeof(v_obj->'current_period_start') not in ('number', 'null') then
      raise exception 'invalid period start';
    end if;
    if v_obj ? 'current_period_end' and jsonb_typeof(v_obj->'current_period_end') not in ('number', 'null') then
      raise exception 'invalid period end';
    end if;
    if v_obj ? 'canceled_at' and jsonb_typeof(v_obj->'canceled_at') not in ('number', 'null') then
      raise exception 'invalid canceled timestamp';
    end if;
    if v_obj ? 'ended_at' and jsonb_typeof(v_obj->'ended_at') not in ('number', 'null') then
      raise exception 'invalid ended timestamp';
    end if;
    if jsonb_typeof(v_obj->'current_period_start') = 'number' then
      v_start := timezone('utc', to_timestamp((v_obj->>'current_period_start')::double precision));
    end if;
    if jsonb_typeof(v_obj->'current_period_end') = 'number' then
      v_end := timezone('utc', to_timestamp((v_obj->>'current_period_end')::double precision));
    end if;
    if jsonb_typeof(v_obj->'canceled_at') = 'number' then
      v_canceled := timezone('utc', to_timestamp((v_obj->>'canceled_at')::double precision));
    end if;
    if jsonb_typeof(v_obj->'ended_at') = 'number' then
      v_ended := timezone('utc', to_timestamp((v_obj->>'ended_at')::double precision));
    end if;
    if v_start is not null and v_end is not null and v_end < v_start then raise exception 'invalid period'; end if;

    select * into v_customer from public.billing_customers
      where provider = 'stripe' and provider_customer_id = v_customer_id for share;
    if not found then raise exception 'unknown customer'; end if;
    perform 1 from public.workspaces where id = v_customer.workspace_id for update;
    select * into v_sub from public.subscriptions
      where provider = 'stripe' and provider_subscription_id = v_sub_id for update;
    if found and v_sub.workspace_id <> v_customer.workspace_id then raise exception 'subscription workspace mismatch'; end if;

    if found and v_sub.provider_event_created_at is not null and
       (v_event_time, convert_to(v_event_id, 'UTF8')) <=
       (v_sub.provider_event_created_at, convert_to(coalesce(v_sub.provider_event_id, ''), 'UTF8')) then
      v_stale := true;
    else
      v_old_status := v_sub.status;
      v_old_plan := v_sub.plan_key;
      v_state_changed := not found or v_sub.plan_key is distinct from v_plan or v_sub.status is distinct from v_status or
        v_sub.provider_customer_id is distinct from v_customer_id or v_sub.current_period_start is distinct from v_start or
        v_sub.current_period_end is distinct from v_end or v_sub.cancel_at_period_end is distinct from v_cancel or
        v_sub.canceled_at is distinct from v_canceled or v_sub.ended_at is distinct from v_ended;
      if not found then
        insert into public.subscriptions(id, workspace_id, provider, provider_customer_id, provider_subscription_id,
          plan_key, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at,
          provider_event_created_at, provider_event_id, created_at, updated_at)
        values(extensions.gen_random_uuid()::text, v_customer.workspace_id, 'stripe', v_customer_id, v_sub_id,
          v_plan, v_status, v_start, v_end, v_cancel, v_canceled, v_ended, v_event_time, v_event_id, v_now, v_now)
        returning * into v_sub;
      else
        update public.subscriptions set provider_customer_id = v_customer_id, plan_key = v_plan, status = v_status,
          current_period_start = v_start, current_period_end = v_end, cancel_at_period_end = v_cancel,
          canceled_at = v_canceled, ended_at = v_ended, provider_event_created_at = v_event_time,
          provider_event_id = v_event_id, updated_at = v_now where id = v_sub.id returning * into v_sub;
      end if;

      if v_state_changed then
        insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
        values(extensions.gen_random_uuid()::text, null,
          case when v_old_status is null then 'SUBSCRIPTION_CREATED'
            when v_old_status <> v_status then 'SUBSCRIPTION_STATUS_CHANGED' else 'SUBSCRIPTION_UPDATED' end,
          'Subscription', v_sub.id, v_now,
          jsonb_build_object('provider', 'stripe', 'plan_key', v_plan, 'old_plan_key', v_old_plan,
            'old_status', v_old_status, 'new_status', v_status, 'provider_event_id', v_event_id)::text);
      end if;

      if v_status not in ('CANCELED', 'EXPIRED') then
        select * into v_res from public.billing_checkout_reservations
          where workspace_id = v_customer.workspace_id and provider = 'stripe' for update;
        if found and v_res.status in ('CREATING', 'OPEN') and v_res.created_at <= v_event_time then
          update public.billing_checkout_reservations set status = 'COMPLETED', updated_at = v_now where id = v_res.id;
          if v_res.plan_key <> v_plan then
            insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
            values(extensions.gen_random_uuid()::text, null, 'CHECKOUT_RECONCILIATION_MISMATCH',
              'BillingCheckoutReservation', v_res.id, v_now,
              jsonb_build_object('provider', 'stripe', 'plan_key', v_res.plan_key, 'provider_event_id', v_event_id)::text);
          end if;
          insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
          values(extensions.gen_random_uuid()::text, null, 'CHECKOUT_COMPLETED', 'BillingCheckoutReservation', v_res.id, v_now,
            jsonb_build_object('provider', 'stripe', 'plan_key', v_res.plan_key, 'provider_event_id', v_event_id)::text);
        end if;
      end if;
    end if;

    if v_stale then
      update public.webhook_events set status = 'STALE', processed_at = v_now where id = v_inbox.id;
      return jsonb_build_object('status', 'stale');
    end if;
    update public.webhook_events set status = 'PROCESSED', processed_at = v_now where id = v_inbox.id;
    return jsonb_build_object('status', 'processed');
  exception when others then
    -- Roll back mapped subscription/audit/reservation writes while retaining a
    -- payload-free FAILED inbox entry for a later retry.
    update public.webhook_events set status = 'FAILED', processed_at = v_now where id = v_inbox.id;
    return jsonb_build_object('status', 'failed');
  end;
end;
$function$;

revoke all on function al_private.al_stripe_webhook_apply(jsonb, integer)
  from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.al_stripe_webhook_apply(jsonb, integer)
  to al_edge_catalog_runtime;

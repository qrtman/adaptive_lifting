create or replace function al_private.al_billing_secret(p_name text)
returns text language plpgsql stable security definer set search_path=''
as $function$
declare v_value text; v_count integer;
begin
  if p_name not in (
    'adaptive_lifting_voucher_code_secret','adaptive_lifting_voucher_billing_enabled',
    'adaptive_lifting_stripe_billing_enabled','adaptive_lifting_stripe_secret_key',
    'adaptive_lifting_stripe_webhook_secret','adaptive_lifting_stripe_price_coach_starter',
    'adaptive_lifting_stripe_price_coach_pro','adaptive_lifting_stripe_price_coach_unlimited',
    'adaptive_lifting_stripe_expect_livemode'
  ) then return null; end if;
  select count(*),min(d.decrypted_secret) into v_count,v_value
  from vault.decrypted_secrets d where d.name=p_name;
  if v_count<>1 or nullif(pg_catalog.btrim(v_value),'') is null then return null; end if;
  return v_value;
end;
$function$;

create or replace function al_private.al_billing_operator_create_voucher(
  p_email text,p_plan text,p_days integer,p_valid_days integer default null,p_payment_reference text default null,p_notes text default null
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_user public.users%rowtype; v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_deadline timestamp without time zone;
  v_secret text; v_enabled text; v_alphabet text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text:='VCH-'; v_chars text:=''; v_bytes bytea; v_i integer; v_candidate integer;
  v_hash text; v_id text; v_groups text[];
begin
  if p_plan not in ('coach_starter','coach_pro','coach_unlimited') or p_days is null or p_days<=0 or
    (p_valid_days is not null and p_valid_days<=0) or (p_payment_reference is not null and length(p_payment_reference)>120) or
    (p_notes is not null and length(p_notes)>500) then raise exception 'invalid voucher parameters'; end if;
  select * into v_user from public.users where lower(email)=lower(btrim(p_email)) and deleted_at is null and role='COACH';
  if not found then raise exception 'voucher recipient must be an existing coach'; end if;
  v_enabled:=al_private.al_billing_secret('adaptive_lifting_voucher_billing_enabled');
  if lower(btrim(coalesce(v_enabled,''))) not in ('1','true','yes') then raise exception 'voucher billing is disabled'; end if;
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
  v_hash:=encode(extensions.hmac(v_code,v_secret,'sha256'),'hex'); v_id:=extensions.gen_random_uuid()::text;
  insert into public.vouchers(id,code_hash,code_prefix,plan_key,duration_days,source,assigned_user_id,payment_reference,expires_at,created_by_user_id,created_at,notes)
  values(v_id,v_hash,'VCH-'||substr(v_groups[1],1,4),p_plan,p_days,'offline_payment',v_user.id,p_payment_reference,v_deadline,null,v_now,p_notes);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,null,'VOUCHER_CREATED','Voucher',v_id,v_now,
    jsonb_build_object('voucher_id',v_id,'plan_key',p_plan,'duration_days',p_days,'assigned_user_id',v_user.id,'payment_reference',p_payment_reference)::text);
  return jsonb_build_object('id',v_id,'code',v_code,'codePrefix','VCH-'||substr(v_groups[1],1,4),'planKey',p_plan,'durationDays',p_days,
    'assignedEmail',v_user.email,'createdAt',v_now,'expiresAt',v_deadline,'paymentReference',p_payment_reference);
end;
$function$;

create or replace function al_private.al_billing_operator_diagnostics(p_stale_minutes integer default 10)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
begin
  return jsonb_build_object(
    'voucherSecretConfigured',al_private.al_billing_secret('adaptive_lifting_voucher_code_secret') is not null,
    'voucherBillingEnabled',lower(coalesce(al_private.al_billing_secret('adaptive_lifting_voucher_billing_enabled'),'')) in ('1','true','yes'),
    'stripeConfigured',al_private.al_billing_secret('adaptive_lifting_stripe_secret_key') is not null,
    'failedStripeWebhookEvents',(select count(*) from public.webhook_events where provider='stripe' and status='FAILED'),
    'staleCreatingCheckouts',(select count(*) from public.billing_checkout_reservations where provider='stripe' and status='CREATING' and updated_at<timezone('utc',clock_timestamp())-(greatest(coalesce(p_stale_minutes,10),0)*interval '1 minute')),
    'billingCustomers',(select count(*) from public.billing_customers where provider='stripe'),
    'stripeSubscriptions',(select coalesce(jsonb_agg(jsonb_build_object('workspaceId',workspace_id,'planKey',plan_key,'status',status,'periodEnd',current_period_end) order by updated_at desc),'[]'::jsonb) from public.subscriptions where provider='stripe')
  );
end;
$function$;

revoke all on function al_private.al_billing_secret(text) from public,anon,authenticated,al_edge_catalog_reader;
grant execute on function al_private.al_billing_secret(text) to al_edge_catalog_runtime;
revoke all on function al_private.al_billing_operator_create_voucher(text,text,integer,integer,text,text)
  from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
revoke all on function al_private.al_billing_operator_diagnostics(integer)
  from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;

-- Operator inspection/revocation uses the voucher id, so a one-time code is
-- never repeated in SQL parameters after issuance.
drop function if exists al_private.al_billing_operator_inspect_voucher(text);
drop function if exists al_private.al_billing_operator_revoke_voucher(text);

create function al_private.al_billing_operator_inspect_voucher_by_id(p_voucher_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_row public.vouchers%rowtype;
begin
  select * into v_row
  from public.vouchers
  where id = p_voucher_id;
  if not found then raise exception 'voucher not found'; end if;
  return jsonb_build_object(
    'id', v_row.id,
    'codePrefix', v_row.code_prefix,
    'assignedUserId', v_row.assigned_user_id,
    'planKey', v_row.plan_key,
    'durationDays', v_row.duration_days,
    'paymentReference', v_row.payment_reference,
    'notes', v_row.notes,
    'createdAt', v_row.created_at,
    'expiresAt', v_row.expires_at,
    'redeemedAt', v_row.redeemed_at,
    'redeemedByUserId', v_row.redeemed_by_user_id,
    'revokedAt', v_row.revoked_at
  );
end;
$function$;

create function al_private.al_billing_operator_revoke_voucher_by_id(p_voucher_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_row public.vouchers%rowtype;
  v_now timestamp without time zone := timezone('utc', clock_timestamp());
begin
  select * into v_row
  from public.vouchers
  where id = p_voucher_id
  for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_row.redeemed_at is not null then
    raise exception 'already redeemed; resulting grant is managed separately';
  end if;
  if v_row.revoked_at is null then
    update public.vouchers set revoked_at = v_now where id = v_row.id;
    insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
    values(extensions.gen_random_uuid()::text, null, 'VOUCHER_REVOKED', 'Voucher', v_row.id, v_now,
      jsonb_build_object('voucher_id', v_row.id, 'plan_key', v_row.plan_key, 'assigned_user_id', v_row.assigned_user_id)::text);
  end if;
  return jsonb_build_object('id', v_row.id, 'revoked', true);
end;
$function$;

revoke all on function al_private.al_billing_operator_inspect_voucher_by_id(text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_billing_operator_revoke_voucher_by_id(text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;

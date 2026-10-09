-- Keep the voucher HMAC key independent from other secrets stored in Vault.
-- Edge-only secrets are checked by the billing handler before use.
create or replace function al_private.al_billing_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_value text;
  v_count integer;
begin
  if p_name not in (
    'adaptive_lifting_voucher_code_secret',
    'adaptive_lifting_voucher_billing_enabled',
    'adaptive_lifting_stripe_billing_enabled',
    'adaptive_lifting_stripe_secret_key',
    'adaptive_lifting_stripe_webhook_secret',
    'adaptive_lifting_stripe_price_coach_starter',
    'adaptive_lifting_stripe_price_coach_pro',
    'adaptive_lifting_stripe_price_coach_unlimited',
    'adaptive_lifting_stripe_expect_livemode'
  ) then
    return null;
  end if;

  select count(*), min(d.decrypted_secret)
  into v_count, v_value
  from vault.decrypted_secrets d
  where d.name = p_name;

  if v_count <> 1 or nullif(pg_catalog.btrim(v_value), '') is null then
    return null;
  end if;

  if p_name = 'adaptive_lifting_voucher_code_secret' and exists (
    select 1
    from vault.decrypted_secrets d
    where d.name in (
      'adaptive_lifting_integration_encryption_key',
      'adaptive_lifting_offline_auth_private_key',
      'adaptive_lifting_realtime_signing_jwk',
      'adaptive_lifting_email_payload_encryption_key',
      'adaptive_lifting_stripe_secret_key',
      'adaptive_lifting_stripe_webhook_secret'
    )
    and d.decrypted_secret = v_value
  ) then
    return null;
  end if;

  return v_value;
end;
$function$;

revoke all on function al_private.al_billing_secret(text)
  from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.al_billing_secret(text)
  to al_edge_catalog_runtime;

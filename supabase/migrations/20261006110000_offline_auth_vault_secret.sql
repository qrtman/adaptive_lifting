-- Expose exactly one staging offline-auth key to the Edge database runtime.
-- The Vault secret value is provisioned separately and must never appear here.
create or replace function al_private.get_offline_auth_private_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_secret_count bigint;
  v_secret text;
begin
  select pg_catalog.count(*), pg_catalog.max(secret.decrypted_secret)
    into v_secret_count, v_secret
  from vault.decrypted_secrets as secret
  where secret.name = 'adaptive_lifting_offline_auth_private_key';

  if v_secret_count <> 1 or v_secret is null or pg_catalog.btrim(v_secret) = '' then
    raise exception 'offline auth signing key unavailable' using errcode = '55000';
  end if;

  return v_secret;
end;
$function$;

revoke all on function al_private.get_offline_auth_private_key() from public, anon, authenticated;
revoke all on function al_private.get_offline_auth_private_key() from al_edge_catalog_reader;
grant execute on function al_private.get_offline_auth_private_key() to al_edge_catalog_runtime;

revoke all on vault.secrets from al_edge_catalog_runtime;
revoke all on vault.decrypted_secrets from al_edge_catalog_runtime;

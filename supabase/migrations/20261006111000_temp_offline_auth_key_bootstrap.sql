-- Temporary staging-only provisioner. Drop immediately after one-time Vault setup.
create or replace function al_private.set_offline_auth_private_key_once(
  p_actor_id text,
  p_private_key text
) returns void
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  v_secret_count bigint;
  v_secret_id uuid;
begin
  if p_actor_id <> 'stg-account-offline-final-bootstrap'
     or p_private_key is null
     or pg_catalog.btrim(p_private_key) = '' then
    raise exception 'offline auth key bootstrap denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('adaptive_lifting_offline_auth_private_key'));
  select pg_catalog.count(*), pg_catalog.min(id) into v_secret_count, v_secret_id
  from vault.secrets
  where name = 'adaptive_lifting_offline_auth_private_key';

  if v_secret_count > 1 then
    raise exception 'offline auth key bootstrap found duplicate secret names' using errcode = '55000';
  elsif v_secret_count = 1 then
    perform vault.update_secret(
      v_secret_id, p_private_key,
      'adaptive_lifting_offline_auth_private_key',
      'Staging offline authentication signing key', null
    );
  else
    perform vault.create_secret(
      p_private_key,
      'adaptive_lifting_offline_auth_private_key',
      'Staging offline authentication signing key', null
    );
  end if;
end;
$function$;

revoke all on function al_private.set_offline_auth_private_key_once(text,text) from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.set_offline_auth_private_key_once(text,text) to al_edge_catalog_runtime;

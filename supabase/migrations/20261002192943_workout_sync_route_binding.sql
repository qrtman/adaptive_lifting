-- Require both independently supplied route and payload identifiers at the
-- only runtime-callable workout sync RPC boundary. The implementation overload
-- remains owner-only; this wrapper is the runtime's narrow public interface.
create or replace function al_private.al_workout_sync(
  p_actor_user_id text,
  p_session_id text,
  p_route_workout_id text,
  p_payload_workout_id text,
  p_client_device_id text,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer,
  p_changes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_route_workout_id is null or p_payload_workout_id is null
     or p_route_workout_id is distinct from p_payload_workout_id then
    return pg_catalog.jsonb_build_object('denial', 'path_payload_mismatch');
  end if;

  return al_private.al_workout_sync(
    p_actor_user_id,
    p_session_id,
    p_payload_workout_id,
    p_client_device_id,
    p_enforce_legacy_email_verification,
    p_past_due_grace_days,
    p_changes
  );
end;
$function$;

revoke all on function al_private.al_workout_sync(text,text,text,text,boolean,integer,jsonb)
  from public, anon, authenticated, al_edge_catalog_runtime;
revoke all on function al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb)
  from public, anon, authenticated;
grant execute on function al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb)
  to al_edge_catalog_runtime;

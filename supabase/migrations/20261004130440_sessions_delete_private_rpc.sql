-- Root-only soft deletion interface for DELETE /api/sessions/{id}.
-- Reuses the PATCH RPC's transactional session, ownership, relationship, and
-- programming-entitlement guard before changing only Workout tombstone fields.

create or replace function al_private.al_session_delete(
  p_actor_user_id text,
  p_app_session_id text,
  p_workout_id text,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_access jsonb;
  v_deleted_id text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
begin
  -- The existing private PATCH interface owns the canonical authorization
  -- and entitlement implementation. Its SELECT ... FOR UPDATE holds the
  -- Workout row lock through this transaction, serializing duplicate deletes.
  select al_private.al_session_update(
    p_actor_user_id,
    p_app_session_id,
    p_workout_id,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    p_enforce_legacy_email_verification,
    p_past_due_grace_days
  ) into v_access;

  if v_access ->> 'denial' is not null then
    return v_access;
  end if;

  update public.workouts as w
     set deleted_at = v_now,
         updated_at = v_now
   where w.id = p_workout_id
     and w.deleted_at is null
  returning w.id into v_deleted_id;

  if v_deleted_id is null then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'result', pg_catalog.jsonb_build_object('status', 'success')
  );
end;
$function$;

revoke all on function al_private.al_session_delete(text, text, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function al_private.al_session_delete(text, text, text, boolean, integer)
  to al_edge_catalog_runtime;

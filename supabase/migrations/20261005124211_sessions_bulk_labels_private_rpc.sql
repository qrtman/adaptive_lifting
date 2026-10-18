-- Narrow transaction-safe interface for PATCH /api/sessions/labels.
-- Reuses al_session_update as the canonical session/auth/plan/entitlement
-- gate. All authorization is preflighted before any label write, so any
-- denial aborts the complete batch at the Edge boundary without partial work.

create or replace function al_private.al_sessions_bulk_labels(
  p_actor_user_id text,
  p_app_session_id text,
  p_session_ids text[],
  p_block_label text,
  p_week_label text,
  p_clear_block boolean,
  p_clear_week boolean,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_session_id text;
  v_workout public.workouts%rowtype;
  v_owner_id text;
  v_access jsonb;
  v_updated text[] := array[]::text[];
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
begin
  if p_actor_user_id is null or p_actor_user_id = ''
     or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = ''
     or pg_catalog.length(p_app_session_id) > 255
     or p_session_ids is null or pg_catalog.cardinality(p_session_ids) = 0
     or p_past_due_grace_days is null
     or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  foreach v_session_id in array p_session_ids loop
    if v_session_id is null or v_session_id = ''
       or pg_catalog.length(v_session_id) > 255 then
      return pg_catalog.jsonb_build_object('denial', 'invalid_request');
    end if;

    select w.* into v_workout
      from public.workouts as w
     where w.id = v_session_id
     for update;
    if not found then
      continue;
    end if;

    v_owner_id := v_workout.owner_id;
    if v_owner_id is null and v_workout.microcycle_id is not null then
      select mc.owner_id into v_owner_id
        from public.microcycles as mc
       where mc.id = v_workout.microcycle_id
       for share;
    end if;
    if v_owner_id is null then
      continue;
    end if;

    select al_private.al_session_update(
      p_actor_user_id,
      p_app_session_id,
      v_session_id,
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
    v_updated := pg_catalog.array_append(v_updated, v_session_id);
  end loop;

  -- Update only changed labels; no-op requests retain TimestampMixin.onupdate behavior.
  foreach v_session_id in array v_updated loop
    update public.workouts as w
       set block_label = case
             when coalesce(p_clear_block, false) then null
             when p_block_label is not null then p_block_label
             else w.block_label
           end,
           week_label = case
             when coalesce(p_clear_week, false) then null
             when p_week_label is not null then p_week_label
             else w.week_label
           end,
           updated_at = v_now
     where w.id = v_session_id
       and w.deleted_at is null
       and (
         (coalesce(p_clear_block, false) and w.block_label is not null)
         or (not coalesce(p_clear_block, false) and p_block_label is not null
             and w.block_label is distinct from p_block_label)
         or (coalesce(p_clear_week, false) and w.week_label is not null)
         or (not coalesce(p_clear_week, false) and p_week_label is not null
             and w.week_label is distinct from p_week_label)
       );
  end loop;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'result', pg_catalog.jsonb_build_object(
      'status', 'success',
      'updated', pg_catalog.to_jsonb(v_updated)
    )
  );
end;
$function$;

revoke all on function al_private.al_sessions_bulk_labels(
  text, text, text[], text, text, boolean, boolean, boolean, integer
) from public, anon, authenticated;
grant execute on function al_private.al_sessions_bulk_labels(
  text, text, text[], text, text, boolean, boolean, boolean, integer
) to al_edge_catalog_runtime;

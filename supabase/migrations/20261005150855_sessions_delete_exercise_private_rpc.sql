-- Soft-delete one Exercise, its currently-live Sets, and compact remaining
-- live Exercise ranks atomically under the shared parent-Workout row lock.
create or replace function al_private.al_session_delete_exercise(
  p_actor_user_id text,
  p_app_session_id text,
  p_workout_id text,
  p_exercise_id text,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_guard jsonb;
  v_denial text;
  v_workout public.workouts%rowtype;
  v_microcycle_deleted_at timestamp without time zone;
  v_exercise public.exercises%rowtype;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = '' or pg_catalog.length(p_app_session_id) > 255
     or p_workout_id is null or p_workout_id = '' or pg_catalog.length(p_workout_id) > 255
     or p_exercise_id is null or p_exercise_id = '' or pg_catalog.length(p_exercise_id) > 255
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  -- Reuse the existing app-session, plan access, relationship, entitlement,
  -- and Workout row-lock interface shared by Add Exercise and Exercise PATCH.
  v_guard := al_private.al_session_update(
    p_actor_user_id, p_app_session_id, p_workout_id,
    null, null, null, null, null, null,
    p_enforce_legacy_email_verification, p_past_due_grace_days
  );
  v_denial := v_guard ->> 'denial';
  if v_denial is not null then
    return pg_catalog.jsonb_build_object('denial', v_denial);
  end if;

  select w.* into v_workout
    from public.workouts as w
   where w.id = p_workout_id
   for update;
  if not found or v_workout.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;
  if v_workout.microcycle_id is not null then
    select mc.deleted_at into v_microcycle_deleted_at
      from public.microcycles as mc
     where mc.id = v_workout.microcycle_id
     for share;
    if not found or v_microcycle_deleted_at is not null then
      return pg_catalog.jsonb_build_object('denial', 'session_not_found');
    end if;
  end if;

  select e.* into v_exercise
    from public.exercises as e
   where e.id = p_exercise_id
     and e.workout_id = p_workout_id
     and e.deleted_at is null
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('denial', 'lift_not_found');
  end if;

  -- One server timestamp applies to the Exercise and only its live Sets.
  -- Explicit updated_at mirrors the ORM TimestampMixin onupdate behavior.
  update public.exercises
     set deleted_at = v_now,
         updated_at = v_now
   where id = p_exercise_id and workout_id = p_workout_id and deleted_at is null;

  update public.exercise_sets
     set deleted_at = v_now,
         updated_at = v_now
   where exercise_id = p_exercise_id and deleted_at is null;

  -- The parent Workout lock serializes this rank rewrite with Add Exercise
  -- and Exercise move/order operations. Tombstoned siblings are not touched.
  with ranked as (
    select e.id,
           ('a' || (pg_catalog.row_number() over (
             order by coalesce(e.lexo_rank, ''), e.id
           ) - 1)::text) as next_rank
      from public.exercises as e
     where e.workout_id = p_workout_id and e.deleted_at is null
  )
  update public.exercises as e
     set lexo_rank = ranked.next_rank,
         updated_at = v_now
    from ranked
   where e.id = ranked.id
     and e.lexo_rank is distinct from ranked.next_rank;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'status', 'success',
    'id', p_exercise_id
  );
end;
$function$;

revoke all on function al_private.al_session_delete_exercise(
  text, text, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function al_private.al_session_delete_exercise(
  text, text, text, text, boolean, integer
) to al_edge_catalog_runtime;

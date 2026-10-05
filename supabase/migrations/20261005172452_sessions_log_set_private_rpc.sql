-- Atomic execution-only write for POST /api/sets/log. Plan fields remain owned
-- by the Set replacement and sync interfaces. The Workout row lock is shared
-- with every migrated canonical workout write so metrics cannot go stale.
create or replace function al_private.al_set_log(
  p_actor_user_id text,
  p_app_session_id text,
  p_workout_id text,
  p_exercise_id text,
  p_set_id text,
  p_weight double precision,
  p_reps integer,
  p_rpe double precision,
  p_note text,
  p_velocity double precision,
  p_readiness integer,
  p_hrv double precision,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_actor_role text;
  v_verified_at timestamp without time zone;
  v_google_sub text;
  v_verification_required boolean;
  v_legacy_exempt boolean;
  v_user_deleted_at timestamp without time zone;
  v_workout public.workouts%rowtype;
  v_microcycle public.microcycles%rowtype;
  v_owner_id text;
  v_relationship_id integer;
  v_set public.exercise_sets%rowtype;
  v_exercise public.exercises%rowtype;
  v_metrics jsonb;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = '' or pg_catalog.length(p_app_session_id) > 255
     or p_workout_id is null or pg_catalog.length(p_workout_id) > 255
     or p_exercise_id is null or pg_catalog.length(p_exercise_id) > 255
     or p_set_id is null or pg_catalog.length(p_set_id) > 255
     or p_weight is null or p_reps is null or p_rpe is null
     or p_enforce_legacy_email_verification is null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  select u.role, u.email_verified_at, u.google_sub,
         u.email_verification_required, u.email_verification_legacy_exempt,
         u.deleted_at
    into v_actor_role, v_verified_at, v_google_sub,
         v_verification_required, v_legacy_exempt, v_user_deleted_at
    from public.users as u
    join public.sessions as s on s.user_id = u.id
   where u.id = p_actor_user_id
     and s.id = p_app_session_id
     and s.jwt_id = p_app_session_id
     and s.revoked_at is null
     and s.expires_at > v_now;

  if not found or v_user_deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_verified_at is null and v_google_sub is null and (
    case when v_legacy_exempt then p_enforce_legacy_email_verification
         else coalesce(v_verification_required, true) end
  ) then
    return pg_catalog.jsonb_build_object('denial', 'account_ineligible');
  end if;

  -- Match the shared Workout serialization domain used by Set replacement,
  -- Workout Sync, Exercise DELETE, and session mutation RPCs.
  select w.* into v_workout
    from public.workouts as w
   where w.id = p_workout_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;

  v_owner_id := v_workout.owner_id;
  if v_workout.microcycle_id is not null then
    select mc.* into v_microcycle
      from public.microcycles as mc
     where mc.id = v_workout.microcycle_id
     for share;
    if found and v_owner_id is null then v_owner_id := v_microcycle.owner_id; end if;
  end if;
  if v_owner_id is null then
    return pg_catalog.jsonb_build_object('denial', 'session_has_no_owner');
  end if;

  -- Execution requires plan membership only; coaches do not need Programming.
  if v_actor_role = 'ATHLETE' then
    if p_actor_user_id <> v_owner_id then
      return pg_catalog.jsonb_build_object('denial', 'athlete_forbidden');
    end if;
  elsif v_actor_role = 'COACH' then
    select cr.id into v_relationship_id
      from public.coaching_relationships as cr
     where cr.coach_id = p_actor_user_id
       and cr.athlete_id = v_owner_id
       and cr.ended_at is null
       and cr.deleted_at is null
     for share;
    if not found then
      return pg_catalog.jsonb_build_object('denial', 'coach_relationship_required');
    end if;
  else
    return pg_catalog.jsonb_build_object('denial', 'unsupported_role');
  end if;

  if v_workout.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;
  if v_workout.microcycle_id is not null and
     (v_microcycle.id is null or v_microcycle.deleted_at is not null) then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;

  select es.* into v_set
    from public.exercise_sets as es
   where es.id = p_set_id
   for update;
  if not found or v_set.deleted_at is not null or v_set.exercise_id is distinct from p_exercise_id then
    return pg_catalog.jsonb_build_object('denial', 'target_set_not_found');
  end if;

  select e.* into v_exercise
    from public.exercises as e
   where e.id = v_set.exercise_id
     and e.deleted_at is null
     and e.workout_id = p_workout_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('denial', 'target_set_not_found');
  end if;

  update public.exercise_sets as es
     set actual = p_weight,
         reps = p_reps,
         "executedRpe" = p_rpe,
         scope = case when es.scope = 'plan' then 'both' else es.scope end,
         note = case when p_note is not null then p_note else es.note end,
         velocity = case when p_velocity is not null then p_velocity else es.velocity end,
         readiness = case when p_readiness is not null then p_readiness else es.readiness end,
         hrv = case when p_hrv is not null then p_hrv else es.hrv end,
         updated_at = v_now
   where es.id = p_set_id and es.deleted_at is null;

  if not found then
    return pg_catalog.jsonb_build_object('denial', 'target_set_not_found');
  end if;

  v_metrics := al_private.al_recalculate_workout_metrics(p_workout_id);
  return pg_catalog.jsonb_build_object('denial', null, 'metrics', v_metrics);
end;
$function$;

revoke all on function al_private.al_set_log(
  text, text, text, text, text, double precision, integer, double precision,
  text, double precision, integer, double precision, boolean
) from public, anon, authenticated;
grant execute on function al_private.al_set_log(
  text, text, text, text, text, double precision, integer, double precision,
  text, double precision, integer, double precision, boolean
) to al_edge_catalog_runtime;

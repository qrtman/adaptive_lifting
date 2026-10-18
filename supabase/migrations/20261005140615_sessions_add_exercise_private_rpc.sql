-- Narrow, atomic Add Exercise + initial Set write interface.
-- The existing session-update RPC remains the canonical app-session, plan,
-- coach relationship, and programming-entitlement guard.
create or replace function al_private.al_session_add_exercise(
  p_actor_user_id text,
  p_app_session_id text,
  p_workout_id text,
  p_title text,
  p_variation text,
  p_tier text,
  p_lift_category text,
  p_movement_pattern text,
  p_lift_note text,
  p_planned_weight double precision,
  p_planned_reps integer,
  p_planned_rpe double precision,
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
  v_title text;
  v_tier text;
  v_lift_category text;
  v_movement_pattern text;
  v_variation text;
  v_lift_note text;
  v_tags text[];
  v_rank integer;
  v_rank_text text;
  v_exercise_id text;
  v_set_id text;
  v_pattern_names text[] := array[
    'Squat','Front Squat','Box Squat','SSB Squat','Split Squat','Leg Press',
    'Deadlift','Sumo Deadlift','RDL','Good Morning','Hip Thrust','Bench',
    'Close Grip Bench','Incline Bench','Floor Press','Press','Push Press',
    'Chest Supported Row','Cable Row','Pull-up','Lat Pulldown','Curl',
    'Tricep Extension','Face Pull','Clean','Snatch','Jerk'
  ];
  v_pattern_values text[] := array[
    'Knee Dominant','Knee Dominant','Knee Dominant','Knee Dominant','Knee Dominant','Knee Dominant',
    'Hip Dominant','Hip Dominant','Hip Dominant','Hip Dominant','Hip Dominant','Horizontal Push',
    'Horizontal Push','Horizontal Push','Horizontal Push','Vertical Push','Vertical Push',
    'Horizontal Pull','Horizontal Pull','Vertical Pull','Vertical Pull','Misc',
    'Misc','Misc','Weightlifting','Weightlifting','Weightlifting'
  ];
  v_pattern text;
  v_index integer;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = '' or pg_catalog.length(p_app_session_id) > 255
     or p_workout_id is null or p_workout_id = '' or pg_catalog.length(p_workout_id) > 255
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  -- This existing guarded RPC locks the Workout row and enforces the same app
  -- session, account eligibility, plan access, relationship, and entitlement
  -- rules used by other session writes. Null patch values make it read-only.
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

  v_title := pg_catalog.btrim(coalesce(p_title, ''));
  if v_title = '' then
    return pg_catalog.jsonb_build_object('denial', 'title_required');
  end if;
  v_tier := coalesce(nullif(p_tier, ''), 'Comp');
  if v_tier not in ('Comp', 'Variation', 'Accessory') then
    return pg_catalog.jsonb_build_object('denial', 'invalid_tier');
  end if;
  v_lift_category := coalesce(nullif(p_lift_category, ''), 'Other');
  if v_lift_category not in ('Squat', 'Bench', 'Deadlift', 'Other') then
    return pg_catalog.jsonb_build_object('denial', 'invalid_lift_category');
  end if;

  if coalesce(p_movement_pattern, '') <> '' then
    if p_movement_pattern not in (
      'Knee Dominant','Hip Dominant','Horizontal Push','Vertical Push',
      'Horizontal Pull','Vertical Pull','Misc','Weightlifting'
    ) then
      return pg_catalog.jsonb_build_object('denial', 'invalid_movement_pattern');
    end if;
    v_movement_pattern := p_movement_pattern;
  else
    v_pattern := null;
    -- Exact titles precede substring matching, preserving Python dict order.
    for v_index in 1..pg_catalog.array_length(v_pattern_names, 1) loop
      if v_title = v_pattern_names[v_index] then
        v_pattern := v_pattern_values[v_index];
        exit;
      end if;
    end loop;
    if v_pattern is null then
      for v_index in 1..pg_catalog.array_length(v_pattern_names, 1) loop
        if pg_catalog.strpos(pg_catalog.lower(v_title), pg_catalog.lower(v_pattern_names[v_index])) > 0 then
          v_pattern := v_pattern_values[v_index];
          exit;
        end if;
      end loop;
    end if;
    v_movement_pattern := coalesce(v_pattern, case v_lift_category
      when 'Squat' then 'Knee Dominant'
      when 'Bench' then 'Horizontal Push'
      when 'Deadlift' then 'Hip Dominant'
      else 'Misc'
    end);
  end if;

  v_variation := coalesce(nullif(pg_catalog.btrim(coalesce(p_variation, '')), ''),
    case when v_tier = 'Accessory' then 'Accessory' else v_title end);
  v_lift_note := nullif(pg_catalog.btrim(coalesce(p_lift_note, '')), '');
  v_tags := case when v_lift_category <> 'Other' then array[v_lift_category]
    when v_tier = 'Accessory' then array['Accessory']::text[] else array[]::text[] end;

  select pg_catalog.count(*)::integer into v_rank
    from public.exercises as e
   where e.workout_id = p_workout_id and e.deleted_at is null;
  v_rank_text := 'a' || v_rank::text;
  while exists (
    select 1 from public.exercises as e
     where e.workout_id = p_workout_id and e.deleted_at is null and e.lexo_rank = v_rank_text
  ) loop
    v_rank := v_rank + 1;
    v_rank_text := 'a' || v_rank::text;
  end loop;

  v_exercise_id := 'e-' || pg_catalog.substr(
    pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text || pg_catalog.txid_current()::text), 1, 10
  );
  v_set_id := 's-' || pg_catalog.substr(
    pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text || pg_catalog.txid_current()::text || v_exercise_id), 1, 10
  );

  insert into public.exercises(
    id, lexo_rank, title, variation, tier, lift_category, movement_pattern,
    lift_note, tags_raw, top, vol, workout_id, updated_at, deleted_at
  ) values (
    v_exercise_id, v_rank_text, v_title, v_variation, v_tier, v_lift_category,
    v_movement_pattern, v_lift_note, pg_catalog.array_to_string(v_tags, ','),
    pg_catalog.chr(8212), pg_catalog.chr(8212), p_workout_id, pg_catalog.timezone('utc', pg_catalog.now()), null
  );

  insert into public.exercise_sets(
    id, lexo_rank, label, scope, "plannedWeight", "plannedReps", "plannedRpe",
    "isAuto", "isTop", actual, reps, "executedRpe", exercise_id, updated_at, deleted_at
  ) values (
    v_set_id, 'a0', 'Set 1', 'both', p_planned_weight, p_planned_reps, p_planned_rpe,
    false, true, null, null, null, v_exercise_id, pg_catalog.timezone('utc', pg_catalog.now()), null
  );

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'exercise', pg_catalog.jsonb_build_object(
      'id', v_exercise_id,
      'title', v_title,
      'variation', v_variation,
      'tier', v_tier,
      'liftCategory', v_lift_category,
      'movementPattern', v_movement_pattern,
      'liftNote', v_lift_note,
      'tags', to_jsonb(v_tags),
      'top', pg_catalog.chr(8212),
      'vol', pg_catalog.chr(8212),
      'sets', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', v_set_id,
        'label', 'Set 1',
        'scope', 'both',
        'plannedWeight', p_planned_weight,
        'plannedReps', p_planned_reps,
        'plannedRpe', p_planned_rpe,
        'actual', null,
        'reps', null,
        'executedRpe', null,
        'velocity', null,
        'readiness', null,
        'hrv', null,
        'isAuto', false,
        'isTop', true,
        'intensityType', 'RPE',
        'dropPercent', 0
      ))
    )
  );
end;
$function$;

revoke all on function al_private.al_session_add_exercise(
  text, text, text, text, text, text, text, text, text,
  double precision, integer, double precision, boolean, integer
) from public, anon, authenticated;
grant execute on function al_private.al_session_add_exercise(
  text, text, text, text, text, text, text, text, text,
  double precision, integer, double precision, boolean, integer
) to al_edge_catalog_runtime;

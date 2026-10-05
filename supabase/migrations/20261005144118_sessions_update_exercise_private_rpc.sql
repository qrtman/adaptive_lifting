-- Narrow PATCH /api/sessions/{id}/exercises/{exercise_id} interface.
-- al_session_update is the existing authorization/entitlement guard and locks
-- the parent Workout, sharing a serialization domain with Add Exercise.
create or replace function al_private.al_session_update_exercise(
  p_actor_user_id text,
  p_app_session_id text,
  p_workout_id text,
  p_exercise_id text,
  p_title text,
  p_variation text,
  p_tier text,
  p_lift_category text,
  p_movement_pattern text,
  p_lift_note text,
  p_move text,
  p_order text[],
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
  v_title text;
  v_variation text;
  v_tier text;
  v_lift_category text;
  v_movement_pattern text;
  v_lift_note text;
  v_live_ids text[];
  v_ordered_ids text[];
  v_sorted_input_ids text[];
  v_unique_count integer;
  v_index integer;
  v_swap_index integer;
  v_swap_id text;
  v_pattern text;
  v_response_pattern text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_metadata_changed boolean;
  v_sets jsonb;
  v_tags jsonb;
  v_result jsonb;
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
  v_i integer;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = '' or pg_catalog.length(p_app_session_id) > 255
     or p_workout_id is null or p_workout_id = '' or pg_catalog.length(p_workout_id) > 255
     or p_exercise_id is null or p_exercise_id = '' or pg_catalog.length(p_exercise_id) > 255
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  -- Null patch fields make the existing session RPC a read-only authorization
  -- guard while retaining its row lock, plan access, and coach entitlement.
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

  v_title := v_exercise.title;
  if p_title is not null then
    v_title := pg_catalog.btrim(p_title);
    if v_title = '' then
      return pg_catalog.jsonb_build_object('denial', 'title_required');
    end if;
  end if;
  v_variation := v_exercise.variation;
  if p_variation is not null then
    v_variation := pg_catalog.btrim(p_variation);
    if v_variation = '' then
      return pg_catalog.jsonb_build_object('denial', 'variation_required');
    end if;
  end if;
  v_tier := v_exercise.tier;
  if p_tier is not null then
    if p_tier not in ('Comp', 'Variation', 'Accessory') then
      return pg_catalog.jsonb_build_object('denial', 'invalid_tier');
    end if;
    v_tier := p_tier;
  end if;
  v_lift_category := v_exercise.lift_category;
  if p_lift_category is not null then
    if p_lift_category not in ('Squat', 'Bench', 'Deadlift', 'Other') then
      return pg_catalog.jsonb_build_object('denial', 'invalid_lift_category');
    end if;
    v_lift_category := p_lift_category;
  end if;
  v_movement_pattern := v_exercise.movement_pattern;
  if p_movement_pattern is not null then
    if p_movement_pattern <> '' then
      if p_movement_pattern not in (
        'Knee Dominant','Hip Dominant','Horizontal Push','Vertical Push',
        'Horizontal Pull','Vertical Pull','Misc','Weightlifting'
      ) then
        return pg_catalog.jsonb_build_object('denial', 'invalid_movement_pattern');
      end if;
      v_movement_pattern := p_movement_pattern;
    else
      v_pattern := null;
      -- Match pattern_for: exact title pass, then ordered case-insensitive
      -- substring pass, then category fallback.
      for v_i in 1..pg_catalog.array_length(v_pattern_names, 1) loop
        if v_title = v_pattern_names[v_i] then
          v_pattern := v_pattern_values[v_i];
          exit;
        end if;
      end loop;
      if v_pattern is null then
        for v_i in 1..pg_catalog.array_length(v_pattern_names, 1) loop
          if pg_catalog.strpos(pg_catalog.lower(v_title), pg_catalog.lower(v_pattern_names[v_i])) > 0 then
            v_pattern := v_pattern_values[v_i];
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
  end if;
  v_lift_note := v_exercise.lift_note;
  if p_lift_note is not null then
    v_lift_note := nullif(pg_catalog.btrim(p_lift_note), '');
  end if;

  select coalesce(pg_catalog.array_agg(e.id order by coalesce(e.lexo_rank, ''), e.id), array[]::text[])
    into v_live_ids
    from public.exercises as e
   where e.workout_id = p_workout_id and e.deleted_at is null;
  v_ordered_ids := v_live_ids;

  if p_move is not null then
    if pg_catalog.lower(pg_catalog.btrim(p_move)) not in ('up', 'down') then
      return pg_catalog.jsonb_build_object('denial', 'invalid_move');
    end if;
    v_index := pg_catalog.array_position(v_ordered_ids, p_exercise_id);
    v_swap_index := case pg_catalog.lower(pg_catalog.btrim(p_move))
      when 'up' then v_index - 1 else v_index + 1 end;
    if v_swap_index >= 1 and v_swap_index <= pg_catalog.cardinality(v_ordered_ids) then
      v_swap_id := v_ordered_ids[v_index];
      v_ordered_ids[v_index] := v_ordered_ids[v_swap_index];
      v_ordered_ids[v_swap_index] := v_swap_id;
    end if;
  end if;

  if p_order is not null then
    select pg_catalog.count(distinct item) into v_unique_count
      from pg_catalog.unnest(p_order) as requested(item);
    select pg_catalog.array_agg(item order by item) into v_sorted_input_ids
      from pg_catalog.unnest(p_order) as requested(item);
    if pg_catalog.cardinality(p_order) <> pg_catalog.cardinality(v_live_ids)
       or v_unique_count <> pg_catalog.cardinality(v_live_ids)
       or v_sorted_input_ids is distinct from (
         select pg_catalog.array_agg(item order by item)
           from pg_catalog.unnest(v_live_ids) as live(item)
       ) then
      return pg_catalog.jsonb_build_object('denial', 'invalid_order');
    end if;
    v_ordered_ids := p_order;
  end if;

  v_metadata_changed := v_exercise.title is distinct from v_title
    or v_exercise.variation is distinct from v_variation
    or v_exercise.tier is distinct from v_tier
    or v_exercise.lift_category is distinct from v_lift_category
    or v_exercise.movement_pattern is distinct from v_movement_pattern
    or v_exercise.lift_note is distinct from v_lift_note;

  -- Rank rewrites affect live rows only. Add Exercise calls the same Workout
  -- guard/row lock, so reorders and appends cannot race one another.
  update public.exercises as e
     set lexo_rank = 'a' || (pg_catalog.array_position(v_ordered_ids, e.id) - 1)::text,
         updated_at = v_now
   where e.workout_id = p_workout_id
     and e.deleted_at is null
     and e.lexo_rank is distinct from ('a' || (pg_catalog.array_position(v_ordered_ids, e.id) - 1)::text);

  if v_metadata_changed then
    update public.exercises as e
       set title = v_title,
           variation = v_variation,
           tier = v_tier,
           lift_category = v_lift_category,
           movement_pattern = v_movement_pattern,
           lift_note = v_lift_note,
           updated_at = v_now
     where e.id = p_exercise_id and e.workout_id = p_workout_id and e.deleted_at is null;
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', s.id,
      'label', s.label,
      'scope', coalesce(nullif(s.scope, ''), 'both'),
      'plannedWeight', s."plannedWeight",
      'plannedReps', s."plannedReps",
      'plannedRpe', s."plannedRpe",
      'actual', s.actual,
      'reps', s.reps,
      'executedRpe', s."executedRpe",
      'velocity', s.velocity,
      'readiness', s.readiness,
      'hrv', s.hrv,
      'isAuto', s."isAuto",
      'isTop', s."isTop",
      'intensityType', coalesce(nullif(s.intensity_type, ''), 'RPE'),
      'dropPercent', coalesce(s."dropPercent", 0)
    ) || case when s.note is null then '{}'::jsonb else pg_catalog.jsonb_build_object('note', s.note) end
    order by coalesce(s.lexo_rank, ''), s.id
  ), '[]'::jsonb)
    into v_sets
    from public.exercise_sets as s
   where s.exercise_id = p_exercise_id and s.deleted_at is null;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pg_catalog.btrim(tag)) order by ord), '[]'::jsonb)
    into v_tags
    from pg_catalog.regexp_split_to_table(coalesce(v_exercise.tags_raw, ''), ',') with ordinality as parsed(tag, ord)
   where pg_catalog.btrim(tag) <> '';

  select e.* into v_exercise
    from public.exercises as e
   where e.id = p_exercise_id and e.workout_id = p_workout_id and e.deleted_at is null;
  v_response_pattern := v_exercise.movement_pattern;
  if v_response_pattern is null then
    v_pattern := null;
    for v_i in 1..pg_catalog.array_length(v_pattern_names, 1) loop
      if v_exercise.title = v_pattern_names[v_i] then
        v_pattern := v_pattern_values[v_i];
        exit;
      end if;
    end loop;
    if v_pattern is null then
      for v_i in 1..pg_catalog.array_length(v_pattern_names, 1) loop
        if pg_catalog.strpos(pg_catalog.lower(v_exercise.title), pg_catalog.lower(v_pattern_names[v_i])) > 0 then
          v_pattern := v_pattern_values[v_i];
          exit;
        end if;
      end loop;
    end if;
    v_response_pattern := coalesce(v_pattern, case v_exercise.lift_category
      when 'Squat' then 'Knee Dominant'
      when 'Bench' then 'Horizontal Push'
      when 'Deadlift' then 'Hip Dominant'
      else 'Misc' end);
  end if;

  select pg_catalog.jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'variation', e.variation,
    'tier', coalesce(e.tier, 'Comp'),
    'liftCategory', coalesce(e.lift_category, 'Other'),
    'movementPattern', v_response_pattern,
    'liftNote', e.lift_note,
    'tags', v_tags,
    'top', e.top,
    'vol', e.vol,
    'sets', v_sets
  ) into v_result
    from public.exercises as e
   where e.id = p_exercise_id and e.workout_id = p_workout_id and e.deleted_at is null;

  if v_result is null then
    return pg_catalog.jsonb_build_object('denial', 'lift_not_found');
  end if;
  return pg_catalog.jsonb_build_object('denial', null, 'exercise', v_result);
end;
$function$;

revoke all on function al_private.al_session_update_exercise(
  text, text, text, text, text, text, text, text, text, text, text, text[], boolean, integer
) from public, anon, authenticated;
grant execute on function al_private.al_session_update_exercise(
  text, text, text, text, text, text, text, text, text, text, text, text[], boolean, integer
) to al_edge_catalog_runtime;

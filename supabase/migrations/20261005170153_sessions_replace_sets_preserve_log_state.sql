create or replace function al_private.al_session_replace_exercise_sets(
  p_actor_user_id text,
  p_app_session_id text,
  p_workout_id text,
  p_exercise_id text,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer,
  p_sets jsonb
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
  v_item jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_incoming_ids text[] := array[]::text[];
  v_source_ids text[] := array[]::text[];
  v_resolved_ids text[] := array[]::text[];
  v_candidate_id text;
  v_set_id text;
  v_existing_exercise_id text;
  v_existing_deleted_at timestamp without time zone;
  v_fallback boolean;
  v_index integer := 0;
  v_index2 integer;
  v_intensity text;
  v_planned_rpe double precision;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_metrics jsonb;
  v_sets jsonb;
  v_tags jsonb;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = '' or pg_catalog.length(p_app_session_id) > 255
     or p_workout_id is null or p_workout_id = '' or pg_catalog.length(p_workout_id) > 255
     or p_exercise_id is null or p_exercise_id = '' or pg_catalog.length(p_exercise_id) > 255
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30
     or p_sets is null or pg_catalog.jsonb_typeof(p_sets) <> 'array' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  v_guard := al_private.al_session_update(
    p_actor_user_id, p_app_session_id, p_workout_id,
    null, null, null, null, null, null,
    p_enforce_legacy_email_verification, p_past_due_grace_days
  );
  v_denial := v_guard ->> 'denial';
  if v_denial is not null then
    return pg_catalog.jsonb_build_object('denial', v_denial);
  end if;

  select w.* into v_workout from public.workouts as w
   where w.id = p_workout_id for update;
  if not found or v_workout.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;
  if v_workout.microcycle_id is not null then
    select mc.deleted_at into v_microcycle_deleted_at
      from public.microcycles as mc where mc.id = v_workout.microcycle_id for share;
    if not found or v_microcycle_deleted_at is not null then
      return pg_catalog.jsonb_build_object('denial', 'session_not_found');
    end if;
  end if;

  select e.* into v_exercise from public.exercises as e
   where e.id = p_exercise_id and e.workout_id = p_workout_id and e.deleted_at is null
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('denial', 'lift_not_found');
  end if;

  -- Resolve IDs and reject ownership/tombstone conflicts before changing rows.
  -- Missing IDs preserve the stable deterministic fallback in ordinary cases.
  for v_item in select value from pg_catalog.jsonb_array_elements(p_sets)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      return pg_catalog.jsonb_build_object('denial', 'invalid_set_payload');
    end if;
    v_fallback := not (v_item ? 'id') or v_item->'id' = 'null'::jsonb
      or v_item->>'id' = '';
    v_candidate_id := case when v_fallback
      then 's-' || v_index::text || '-' || pg_catalog.right(p_exercise_id, 6)
      else v_item->>'id' end;
    if v_candidate_id is null or pg_catalog.length(v_candidate_id) > 255 then
      return pg_catalog.jsonb_build_object('denial', 'invalid_set_payload');
    end if;

    v_set_id := null;
    if pg_catalog.array_length(v_source_ids, 1) is not null then
      for v_index2 in 1..pg_catalog.array_length(v_source_ids, 1) loop
        if v_source_ids[v_index2] = v_candidate_id then
          v_set_id := v_resolved_ids[v_index2];
          exit;
        end if;
      end loop;
    end if;
    if v_set_id is null then
      v_set_id := v_candidate_id;
      select es.exercise_id, es.deleted_at into v_existing_exercise_id, v_existing_deleted_at
        from public.exercise_sets as es where es.id = v_set_id for update;
      if found and v_existing_exercise_id is distinct from p_exercise_id then
        return pg_catalog.jsonb_build_object('denial', 'set_id_owned_elsewhere');
      end if;
      if found and v_existing_deleted_at is not null then
        if not v_fallback then
          return pg_catalog.jsonb_build_object('denial', 'tombstoned_set');
        end if;
        loop
          v_set_id := 's-' || pg_catalog.substr(pg_catalog.md5(
            pg_catalog.random()::text || pg_catalog.clock_timestamp()::text || p_exercise_id
          ), 1, 16);
          exit when not exists(select 1 from public.exercise_sets es where es.id = v_set_id)
            and not (v_set_id = any(v_resolved_ids));
        end loop;
      end if;
      v_source_ids := pg_catalog.array_append(v_source_ids, v_candidate_id);
      v_resolved_ids := pg_catalog.array_append(v_resolved_ids, v_set_id);
    end if;
    v_resolved := v_resolved || pg_catalog.jsonb_build_array(v_item || pg_catalog.jsonb_build_object('id', v_set_id));
    v_incoming_ids := pg_catalog.array_append(v_incoming_ids, v_set_id);
    v_index := v_index + 1;
  end loop;

  v_index := 0;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_resolved)
  loop
    v_set_id := v_item->>'id';
    v_intensity := coalesce(nullif(v_item->>'intensityType', ''), 'RPE');
    if v_intensity not in ('RPE', 'PERCENT') then v_intensity := 'RPE'; end if;
    v_planned_rpe := case
      when v_item ? 'plannedRpe' and v_item->'plannedRpe' <> 'null'::jsonb
        then (v_item->>'plannedRpe')::double precision
      else null end;

    -- Existing IDs are prescription updates; preserve Set Log's scope and execution values.
    if exists(select 1 from public.exercise_sets es where es.id = v_set_id and es.exercise_id = p_exercise_id) then
      update public.exercise_sets as es set
        lexo_rank = 'a' || v_index::text,
        label = coalesce(nullif(v_item->>'label', ''), 'Set ' || (v_index + 1)::text),
        "plannedWeight" = case when v_item->'plannedWeight' = 'null'::jsonb then null else (v_item->>'plannedWeight')::double precision end,
        "plannedReps" = case when v_item->'plannedReps' = 'null'::jsonb then null else (v_item->>'plannedReps')::integer end,
        "plannedRpe" = v_planned_rpe,
        intensity_type = v_intensity,
        "isAuto" = coalesce((v_item->>'isAuto')::boolean, false),
        "isTop" = case when v_item->'isTop' is not null and v_item->'isTop' <> 'null'::jsonb
          then (v_item->>'isTop')::boolean else v_index = 0 end,
        "dropPercent" = case when v_item->'dropPercent' = 'null'::jsonb then null else (v_item->>'dropPercent')::double precision end,
        updated_at = v_now
       where es.id = v_set_id and es.exercise_id = p_exercise_id and es.deleted_at is null;
    else
      insert into public.exercise_sets(
        id, exercise_id, lexo_rank, label, scope, "plannedWeight", "plannedReps", "plannedRpe",
        intensity_type, "isAuto", "isTop", actual, reps, "executedRpe", "dropPercent", deleted_at, updated_at
      ) values (
        v_set_id, p_exercise_id, 'a' || v_index::text,
        coalesce(nullif(v_item->>'label', ''), 'Set ' || (v_index + 1)::text),
        case when v_item->>'scope' in ('plan', 'log', 'both') then v_item->>'scope' else 'both' end,
        case when v_item->'plannedWeight' = 'null'::jsonb then null else (v_item->>'plannedWeight')::double precision end,
        case when v_item->'plannedReps' = 'null'::jsonb then null else (v_item->>'plannedReps')::integer end,
        v_planned_rpe, v_intensity, coalesce((v_item->>'isAuto')::boolean, false),
        case when v_item->'isTop' is not null and v_item->'isTop' <> 'null'::jsonb then (v_item->>'isTop')::boolean else v_index = 0 end,
        null,
        case when v_item->'dropPercent' = 'null'::jsonb then null else (v_item->>'dropPercent')::double precision end,
        null, v_now
      );
    end if;
    v_index := v_index + 1;
  end loop;

  update public.exercise_sets as es set deleted_at = v_now, updated_at = v_now
   where es.exercise_id = p_exercise_id and es.deleted_at is null
     and not (es.id = any(v_incoming_ids));

  v_metrics := al_private.al_recalculate_workout_metrics(p_workout_id);

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', es.id,
      'label', es.label,
      'scope', coalesce(nullif(es.scope, ''), 'both'),
      'plannedWeight', es."plannedWeight",
      'plannedReps', es."plannedReps",
      'plannedRpe', es."plannedRpe",
      'actual', es.actual,
      'reps', es.reps,
      'executedRpe', es."executedRpe",
      'velocity', es.velocity,
      'readiness', es.readiness,
      'hrv', es.hrv,
      'isAuto', coalesce(es."isAuto", false),
      'isTop', coalesce(es."isTop", false),
      'intensityType', coalesce(nullif(es.intensity_type, ''), 'RPE'),
      'dropPercent', coalesce(es."dropPercent", 0)
    ) || case when es.note is null then '{}'::jsonb else pg_catalog.jsonb_build_object('note', es.note) end
    order by coalesce(es.lexo_rank, ''), es.id
  ), '[]'::jsonb) into v_sets
    from public.exercise_sets as es
   where es.exercise_id = p_exercise_id and es.deleted_at is null;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.btrim(t.tag) order by t.ordinality), '[]'::jsonb)
    into v_tags
    from pg_catalog.unnest(pg_catalog.string_to_array(coalesce(v_exercise.tags_raw, ''), ','))
      with ordinality as t(tag, ordinality)
   where pg_catalog.btrim(t.tag) <> '';

  select e.* into v_exercise from public.exercises as e where e.id = p_exercise_id;
  return pg_catalog.jsonb_build_object(
    'denial', null,
    'exercise', pg_catalog.jsonb_build_object(
      'id', v_exercise.id,
      'title', v_exercise.title,
      'variation', v_exercise.variation,
      'tier', coalesce(v_exercise.tier, 'Comp'),
      'liftCategory', coalesce(v_exercise.lift_category, 'Other'),
      'movementPattern', coalesce(v_exercise.movement_pattern, al_private.al_microcycle_pattern_for(v_exercise.title, v_exercise.lift_category)),
      'liftNote', v_exercise.lift_note,
      'tags', v_tags,
      'top', v_exercise.top,
      'vol', v_exercise.vol,
      'sets', v_sets
    ),
    'metrics', v_metrics
  );
end;
$function$;

revoke all on function al_private.al_session_replace_exercise_sets(
  text, text, text, text, boolean, integer, jsonb
) from public, anon, authenticated;
grant execute on function al_private.al_session_replace_exercise_sets(
  text, text, text, text, boolean, integer, jsonb
) to al_edge_catalog_runtime;
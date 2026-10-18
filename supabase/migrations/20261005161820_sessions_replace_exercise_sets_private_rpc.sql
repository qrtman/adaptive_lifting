-- Shared canonical, live-only metric recalculation. Both Workout Sync and REST
-- Set replacement call this helper inside their outer write transaction.
create or replace function al_private.al_recalculate_workout_metrics(
  p_workout_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_workout public.workouts%rowtype;
  v_owner_id text;
  v_microcycle public.microcycles%rowtype;
  v_previous_microcycle_id text;
  v_previous_tonnage double precision;
  v_week_num integer;
  v_total_tonnage double precision := 0;
  v_exercise public.exercises%rowtype;
  v_set public.exercise_sets%rowtype;
  v_volume double precision;
  v_best_e1rm double precision;
  v_top_weight double precision;
  v_top_reps integer;
  v_weight double precision;
  v_reps integer;
  v_rpe double precision;
  v_denominator double precision;
  v_candidate text;
  v_vol_label text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if p_workout_id is null or p_workout_id = '' then
    raise exception 'workout id required';
  end if;

  select w.* into v_workout
    from public.workouts as w
   where w.id = p_workout_id and w.deleted_at is null
   for update;
  if not found then
    raise exception 'live workout required';
  end if;

  v_owner_id := v_workout.owner_id;
  if v_workout.microcycle_id is not null then
    select mc.* into v_microcycle
      from public.microcycles as mc where mc.id = v_workout.microcycle_id;
    if v_owner_id is null then v_owner_id := v_microcycle.owner_id; end if;
  end if;

  for v_exercise in
    select e.* from public.exercises as e
     where e.workout_id = p_workout_id and e.deleted_at is null
     order by coalesce(e.lexo_rank, ''), e.id
     for update
  loop
    v_volume := 0;
    v_best_e1rm := 0;
    v_top_weight := 0;
    v_top_reps := 0;
    for v_set in
      select es.* from public.exercise_sets as es
       where es.exercise_id = v_exercise.id and es.deleted_at is null
       order by coalesce(es.lexo_rank, ''), es.id
    loop
      v_weight := coalesce(v_set.actual, v_set."plannedWeight", 0);
      v_reps := coalesce(v_set.reps, v_set."plannedReps", 0);
      v_rpe := coalesce(v_set."executedRpe", v_set."plannedRpe", 0);
      if v_weight > 0 and v_reps > 0 then
        v_volume := v_volume + v_weight * v_reps;
        if v_reps > 12 or v_rpe <= 0 then
          v_denominator := 1;
        else
          v_denominator := 1 - 0.03 * (10 - greatest(v_rpe, 5) + v_reps - 1);
        end if;
        if v_denominator <= 0.1 then v_denominator := 1; end if;
        if v_denominator = 1 then
          v_rpe := v_weight;
        else
          v_rpe := pg_catalog.round((v_weight / v_denominator)::numeric, 2)::double precision;
        end if;
        if coalesce(v_set."isTop", false) or v_rpe > v_best_e1rm then
          v_best_e1rm := v_rpe;
          v_top_weight := v_weight;
          v_top_reps := v_reps;
        end if;
      end if;
    end loop;
    v_total_tonnage := v_total_tonnage + v_volume;
    if v_top_weight > 0 then
      v_candidate := (case when pg_catalog.strpos(v_top_weight::text, '.') = 0
        then v_top_weight::text || '.0' else v_top_weight::text end)
        || 'kg x ' || v_top_reps::text;
    else
      v_candidate := pg_catalog.chr(8212);
    end if;
    if v_volume > 0 then
      v_vol_label := pg_catalog.to_char(v_volume, 'FM999,999,999,999,990') || 'kg';
    else
      v_vol_label := pg_catalog.chr(8212);
    end if;
    update public.exercises as e
       set top = v_candidate,
           vol = v_vol_label,
           updated_at = v_now
     where e.id = v_exercise.id
       and (e.top is distinct from v_candidate or e.vol is distinct from v_vol_label);
  end loop;

  if v_microcycle.id is not null and v_owner_id is not null then
    begin
      v_week_num := (pg_catalog.regexp_match(v_microcycle."weekName", '([^ ]+)$'))[1]::integer;
      if v_week_num > 1 then
        select mc.id into v_previous_microcycle_id
          from public.microcycles as mc
         where mc.owner_id = v_owner_id
           and mc.deleted_at is null
           and mc."weekName" = 'Microcycle ' || pg_catalog.lpad((v_week_num - 1)::text, 2, '0')
         order by mc.id
         limit 1;
        if v_previous_microcycle_id is not null then
          select w.tonnage into v_previous_tonnage
            from public.workouts as w
           where w.microcycle_id = v_previous_microcycle_id
             and w."dayLabel" = v_workout."dayLabel"
             and w.deleted_at is null
           order by w.id
           limit 1;
          if found then
            update public.workouts as w
               set tonnage = v_total_tonnage,
                   delta = v_total_tonnage - v_previous_tonnage,
                   updated_at = v_now
             where w.id = p_workout_id
               and (w.tonnage is distinct from v_total_tonnage
                 or w.delta is distinct from v_total_tonnage - v_previous_tonnage);
          else
            update public.workouts as w set tonnage = v_total_tonnage, updated_at = v_now
             where w.id = p_workout_id and w.tonnage is distinct from v_total_tonnage;
          end if;
        else
          update public.workouts as w set tonnage = v_total_tonnage, updated_at = v_now
           where w.id = p_workout_id and w.tonnage is distinct from v_total_tonnage;
        end if;
      else
        update public.workouts as w set tonnage = v_total_tonnage, updated_at = v_now
         where w.id = p_workout_id and w.tonnage is distinct from v_total_tonnage;
      end if;
    exception when others then
      -- Preserve legacy tolerance for non-numbered/nonstandard Microcycle labels.
      update public.workouts as w set tonnage = v_total_tonnage, updated_at = v_now
       where w.id = p_workout_id and w.tonnage is distinct from v_total_tonnage;
    end;
  else
    update public.workouts as w set tonnage = v_total_tonnage, updated_at = v_now
     where w.id = p_workout_id and w.tonnage is distinct from v_total_tonnage;
  end if;

  select w.* into v_workout from public.workouts as w where w.id = p_workout_id;
  return pg_catalog.jsonb_build_object(
    'tonnage', v_workout.tonnage,
    'delta', v_workout.delta,
    'updated_at', pg_catalog.replace(v_workout.updated_at::text, ' ', 'T') || 'Z'
  );
end;
$function$;

revoke all on function al_private.al_recalculate_workout_metrics(text)
  from public, anon, authenticated, al_edge_catalog_runtime;

-- Complete replacement for one live Exercise plus a transactional canonical
-- metric refresh. It shares the Workout row lock used by Add/PATCH/DELETE,
-- Workout Sync, and session writes.
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

    if exists(select 1 from public.exercise_sets es where es.id = v_set_id and es.exercise_id = p_exercise_id) then
      update public.exercise_sets as es set
        lexo_rank = 'a' || v_index::text,
        label = coalesce(nullif(v_item->>'label', ''), 'Set ' || (v_index + 1)::text),
        scope = case when v_item->>'scope' in ('plan', 'log', 'both') then v_item->>'scope' else 'both' end,
        "plannedWeight" = case when v_item->'plannedWeight' = 'null'::jsonb then null else (v_item->>'plannedWeight')::double precision end,
        "plannedReps" = case when v_item->'plannedReps' = 'null'::jsonb then null else (v_item->>'plannedReps')::integer end,
        "plannedRpe" = v_planned_rpe,
        intensity_type = v_intensity,
        "isAuto" = coalesce((v_item->>'isAuto')::boolean, false),
        "isTop" = case when v_item->'isTop' is not null and v_item->'isTop' <> 'null'::jsonb
          then (v_item->>'isTop')::boolean else v_index = 0 end,
        actual = case when v_item->'actual' = 'null'::jsonb then null else (v_item->>'actual')::double precision end,
        reps = case when v_item->'reps' = 'null'::jsonb then null else (v_item->>'reps')::integer end,
        "executedRpe" = case when v_item->'executedRpe' = 'null'::jsonb then null else (v_item->>'executedRpe')::double precision end,
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
        case when v_item->'actual' = 'null'::jsonb then null else (v_item->>'actual')::double precision end,
        case when v_item->'reps' = 'null'::jsonb then null else (v_item->>'reps')::integer end,
        case when v_item->'executedRpe' = 'null'::jsonb then null else (v_item->>'executedRpe')::double precision end,
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


-- Keep Workout Sync and REST Set replacement on one canonical metric implementation.
create or replace function al_private.al_workout_sync(
  p_actor_user_id text,
  p_session_id text,
  p_workout_id text,
  p_client_device_id text,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer,
  p_changes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone;
  v_actor_role text;
  v_workspace_id text;
  v_workout public.workouts%rowtype;
  v_owner_id text;
  v_rel_id integer;
  v_lock public.workout_locks%rowtype;
  v_raw_device public.client_devices%rowtype;
  v_device public.client_devices%rowtype;
  v_device_id text;
  v_change jsonb;
  v_fields jsonb;
  v_entity text;
  v_entity_id text;
  v_mutation_id text;
  v_client_updated timestamp without time zone;
  v_existing_result text;
  v_parent_workout_id text;
  v_deleted_at timestamp without time zone;
  v_conflict_reason text;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_item jsonb;
  v_set_id text;
  v_index integer;
  v_incoming_ids text[];
  v_intensity text;
  v_planned_rpe double precision;
  v_top_weight double precision;
  v_top_reps integer;
  v_top_e1rm double precision;
  v_best_e1rm double precision;
  v_weight double precision;
  v_reps integer;
  v_rpe double precision;
  v_denominator double precision;
  v_volume double precision;
  v_total_tonnage double precision := 0;
  v_exercise public.exercises%rowtype;
  v_set public.exercise_sets%rowtype;
  v_micro_week text;
  v_previous_micro text;
  v_previous_tonnage double precision;
  v_canonical_updated_at timestamp without time zone;
  v_metrics jsonb;
begin
  if p_actor_user_id is null or p_actor_user_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_session_id is null or p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_workout_id is null or p_workout_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_client_device_id is null or p_client_device_id = ''
     or p_enforce_legacy_email_verification is null
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30
     or p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'array' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  v_now := pg_catalog.clock_timestamp() at time zone 'utc';
  select u.role into v_actor_role
  from public.users u
  join public.sessions s on s.user_id = u.id
  where u.id = p_actor_user_id and u.deleted_at is null
    and s.id = p_session_id and s.jwt_id = p_session_id
    and s.revoked_at is null and s.expires_at > v_now;
  if v_actor_role is null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if exists (
    select 1 from public.users u
    where u.id = p_actor_user_id and u.google_sub is null
      and u.email_verified_at is null and u.email_verification_required
      and (not u.email_verification_legacy_exempt or p_enforce_legacy_email_verification)
  ) then
    return pg_catalog.jsonb_build_object('denial', 'account_ineligible');
  end if;

  -- Serialize writes per workout (and serialize against FK-backed lock insertions).
  select * into v_workout from public.workouts w where w.id = p_workout_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('denial', 'workout_not_found');
  end if;
  if v_workout.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'workout_not_found');
  end if;
  if v_workout.owner_id is not null then
    v_owner_id := v_workout.owner_id;
  elsif v_workout.microcycle_id is not null then
    select mc.owner_id into v_owner_id from public.microcycles mc where mc.id = v_workout.microcycle_id;
  end if;
  if v_owner_id is null then
    return pg_catalog.jsonb_build_object('denial', 'workout_not_found');
  end if;

  if v_actor_role = 'ATHLETE' then
    if p_actor_user_id <> v_owner_id then
      return pg_catalog.jsonb_build_object('denial', 'workout_not_found');
    end if;
  elsif v_actor_role = 'COACH' then
    select cr.id into v_rel_id from public.coaching_relationships cr
    where cr.coach_id = p_actor_user_id and cr.athlete_id = v_owner_id
      and cr.ended_at is null and cr.deleted_at is null
    for update;
    if v_rel_id is null then
      return pg_catalog.jsonb_build_object('denial', 'workout_not_found');
    end if;

    select w.id into v_workspace_id
    from public.workspaces w
    join public.workspace_members wm on wm.workspace_id = w.id
      and wm.user_id = p_actor_user_id and wm.role = 'OWNER'
    where w.owner_user_id = p_actor_user_id limit 1;
    if v_workspace_id is null or not (
      exists (
        select 1 from public.access_grants ag
        where ag.workspace_id = v_workspace_id
          and ag.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
          and ag.starts_at <= v_now and (ag.expires_at is null or ag.expires_at > v_now)
          and ag.revoked_at is null
      ) or exists (
        select 1 from public.subscriptions sub
        where sub.workspace_id = v_workspace_id
          and sub.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
          and (
            sub.status = 'TRIALING'
            or (sub.status = 'ACTIVE' and (not sub.cancel_at_period_end or sub.current_period_end > v_now))
            or (sub.status = 'CANCELED' and sub.current_period_end > v_now)
            or (sub.status = 'PAST_DUE' and sub.current_period_end is not null
              and v_now < sub.current_period_end + pg_catalog.make_interval(days => p_past_due_grace_days))
          )
      )
    ) then
      return pg_catalog.jsonb_build_object('denial', 'workspace_access_required');
    end if;
    if not exists (
      select 1 from public.access_grants ag
      where ag.workspace_id = v_workspace_id
        and ag.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
        and ag.starts_at <= v_now and (ag.expires_at is null or ag.expires_at > v_now)
        and ag.revoked_at is null
    ) and not exists (
      select 1 from public.subscriptions sub
      where sub.workspace_id = v_workspace_id
        and sub.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
        and (
          sub.status = 'TRIALING'
          or (sub.status = 'ACTIVE' and (not sub.cancel_at_period_end or sub.current_period_end > v_now))
          or (sub.status = 'CANCELED' and sub.current_period_end > v_now)
          or (sub.status = 'PAST_DUE' and sub.current_period_end is not null
            and v_now < sub.current_period_end + pg_catalog.make_interval(days => p_past_due_grace_days))
        )
    ) then
      return pg_catalog.jsonb_build_object('denial', 'feature_not_included');
    end if;
  else
    return pg_catalog.jsonb_build_object('denial', 'workout_not_found');
  end if;

  select * into v_lock from public.workout_locks wl where wl.workout_id = p_workout_id for update;
  if found and v_lock.holder_user_id <> p_actor_user_id and v_lock.expires_at > v_now then
    return pg_catalog.jsonb_build_object('denial', 'workout_locked');
  end if;

  -- Match ensure_client_device and isolate both raw-ID collisions and duplicate
  -- mutation attempts across concurrent Edge requests.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workout-sync:raw:' || p_client_device_id, 0));
  select * into v_raw_device from public.client_devices d where d.id = p_client_device_id;
  if not found or v_raw_device.user_id = p_actor_user_id then
    v_device_id := p_client_device_id;
  else
    v_device_id := p_actor_user_id || ':' || p_client_device_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workout-sync:device:' || v_device_id, 0));
  select * into v_device from public.client_devices d where d.id = v_device_id for update;
  if not found then
    insert into public.client_devices(id,user_id,last_seen_at) values(v_device_id,p_actor_user_id,v_now);
  elsif v_device.revoked_at is not null or v_device.user_id is distinct from p_actor_user_id then
    return pg_catalog.jsonb_build_object('denial', 'device_revoked');
  else
    update public.client_devices set last_seen_at = v_now where id = v_device_id;
  end if;

  for v_change in select value from pg_catalog.jsonb_array_elements(p_changes)
  loop
    v_entity := v_change->>'entity';
    v_entity_id := v_change->>'id';
    v_mutation_id := v_change->>'mutation_id';
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workout-sync:mutation:' || v_device_id || ':' || v_mutation_id, 0));
    select m.result into v_existing_result from public.sync_mutations m
    where m.client_device_id = v_device_id and m.mutation_id = v_mutation_id;
    if found then
      if v_existing_result = 'ACCEPTED' then
        v_accepted := v_accepted || pg_catalog.jsonb_build_array(v_mutation_id);
      else
        v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      end if;
      continue;
    end if;

    begin
      v_client_updated := (v_change->>'updated_at')::timestamp without time zone;
    exception when others then
      v_client_updated := v_now;
    end;
    if v_client_updated is null then v_client_updated := v_now; end if;
    if v_client_updated > v_now + interval '5 minutes' then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('mutation_id',v_mutation_id,'reason','CLIENT_CLOCK_SKEW'));
      insert into public.sync_mutations(mutation_id,client_device_id,entity_type,entity_id,field_path,updated_at,applied_at,result)
      values(v_mutation_id,v_device_id,v_entity,v_entity_id,'ALL',v_client_updated,null,'REJECTED_CLOCK_SKEW');
      continue;
    end if;

    if v_entity not in ('Workout','Exercise','ExerciseSet') then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      continue;
    end if;
    v_parent_workout_id := null;
    v_deleted_at := null;
    if v_entity = 'Workout' then
      select w.id,w.deleted_at into v_parent_workout_id,v_deleted_at from public.workouts w where w.id = v_entity_id for update;
    elsif v_entity = 'Exercise' then
      select e.workout_id,e.deleted_at into v_parent_workout_id,v_deleted_at from public.exercises e where e.id = v_entity_id for update;
    else
      select w.id,es.deleted_at into v_parent_workout_id,v_deleted_at
      from public.exercise_sets es join public.exercises e on e.id = es.exercise_id
      join public.workouts w on w.id = e.workout_id where es.id = v_entity_id for update of es;
    end if;
    if v_parent_workout_id is null then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      continue;
    end if;
    if v_parent_workout_id <> p_workout_id then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('mutation_id',v_mutation_id,'reason','WORKOUT_MISMATCH'));
      continue;
    end if;
    if v_deleted_at is not null then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('mutation_id',v_mutation_id,'reason','TOMBSTONE_CONFLICT'));
      insert into public.sync_mutations(mutation_id,client_device_id,entity_type,entity_id,field_path,updated_at,applied_at,result)
      values(v_mutation_id,v_device_id,v_entity,v_entity_id,'ALL',v_client_updated,null,'REJECTED_TOMBSTONE');
      continue;
    end if;
    v_fields := coalesce(v_change->'fields','{}'::jsonb);
    if (v_entity = 'Workout' and (v_fields - array['date','dayLabel','title','color','status','athlete_bw','block_label','week_label']) <> '{}'::jsonb)
      or (v_entity = 'Exercise' and (v_fields - array['lexo_rank','title','variation','tier','lift_category','movement_pattern','lift_note','tags_raw','tags','sets']) <> '{}'::jsonb)
      or (v_entity = 'ExerciseSet' and (v_fields - array['lexo_rank','label','scope','plannedWeight','plannedReps','plannedRpe','dropPercent','isAuto','actual','reps','executedRpe','isTop','intensity_type','note','velocity','readiness','hrv']) <> '{}'::jsonb) then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('mutation_id',v_mutation_id,'reason','FIELD_NOT_WRITABLE'));
      continue;
    end if;

    if v_entity = 'Exercise' and v_fields ? 'sets' and pg_catalog.jsonb_typeof(v_fields->'sets') = 'array'
       and exists (
         select 1 from pg_catalog.jsonb_array_elements(v_fields->'sets') with ordinality incoming(value,ordinality)
         join public.exercise_sets es on es.id = coalesce(nullif(incoming.value->>'id',''), 's-' || (incoming.ordinality-1)::text || '-' || pg_catalog.right(v_entity_id,6))
         where es.exercise_id <> v_entity_id
       ) then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('mutation_id',v_mutation_id,'reason','WORKOUT_MISMATCH'));
      continue;
    end if;

    if v_entity = 'Workout' then
      update public.workouts w set
        date = case when v_fields ? 'date' then v_fields->>'date' else w.date end,
        "dayLabel" = case when v_fields ? 'dayLabel' then v_fields->>'dayLabel' else w."dayLabel" end,
        title = case when v_fields ? 'title' then v_fields->>'title' else w.title end,
        color = case when v_fields ? 'color' then v_fields->>'color' else w.color end,
        status = case when v_fields ? 'status' then v_fields->>'status' else w.status end,
        athlete_bw = case when v_fields ? 'athlete_bw' then (v_fields->>'athlete_bw')::double precision else w.athlete_bw end,
        block_label = case when v_fields ? 'block_label' then v_fields->>'block_label' else w.block_label end,
        week_label = case when v_fields ? 'week_label' then v_fields->>'week_label' else w.week_label end,
        updated_at = v_now where w.id = v_entity_id;
    elsif v_entity = 'Exercise' then
      update public.exercises e set
        lexo_rank = case when v_fields ? 'lexo_rank' then v_fields->>'lexo_rank' else e.lexo_rank end,
        title = case when v_fields ? 'title' then v_fields->>'title' else e.title end,
        variation = case when v_fields ? 'variation' then v_fields->>'variation' else e.variation end,
        tier = case when v_fields ? 'tier' then v_fields->>'tier' else e.tier end,
        lift_category = case when v_fields ? 'lift_category' then v_fields->>'lift_category' else e.lift_category end,
        movement_pattern = case when v_fields ? 'movement_pattern' then v_fields->>'movement_pattern' else e.movement_pattern end,
        lift_note = case when v_fields ? 'lift_note' then v_fields->>'lift_note' else e.lift_note end,
        tags_raw = case when v_fields ? 'tags_raw' then v_fields->>'tags_raw'
          when v_fields ? 'tags' then coalesce((select pg_catalog.string_agg(t.value, ',') from pg_catalog.jsonb_array_elements_text(v_fields->'tags') t(value)), '')
          else e.tags_raw end,
        updated_at = v_now where e.id = v_entity_id returning * into v_exercise;
      if v_fields ? 'sets' and pg_catalog.jsonb_typeof(v_fields->'sets') = 'array' then
        v_incoming_ids := array[]::text[];
        v_index := 0;
        for v_item in select value from pg_catalog.jsonb_array_elements(v_fields->'sets')
        loop
          if pg_catalog.jsonb_typeof(v_item) <> 'object' then
            raise exception 'Invalid nested set payload';
          end if;
          v_set_id := coalesce(nullif(v_item->>'id',''), 's-' || v_index::text || '-' || pg_catalog.right(v_entity_id,6));
          v_incoming_ids := pg_catalog.array_append(v_incoming_ids,v_set_id);
          v_intensity := coalesce(nullif(v_item->>'intensityType',''),nullif(v_item->>'intensity_type',''),'RPE');
          if v_intensity not in ('RPE','PERCENT') then v_intensity := 'RPE'; end if;
          v_planned_rpe := case when v_item ? 'plannedRpe' and v_item->'plannedRpe' <> 'null'::jsonb then (v_item->>'plannedRpe')::double precision
            when v_item ? 'target_value' and v_item->'target_value' <> 'null'::jsonb then (v_item->>'target_value')::double precision else null end;
          select * into v_set from public.exercise_sets es where es.id = v_set_id and es.exercise_id = v_entity_id for update;
          if found then
            update public.exercise_sets es set
              lexo_rank = 'a' || v_index::text,
              label = coalesce(nullif(v_item->>'label',''),'Set ' || (v_index+1)::text),
              scope = case when v_item->>'scope' in ('plan','log','both') then v_item->>'scope' else 'both' end,
              "plannedWeight" = case when v_item ? 'plannedWeight' then (v_item->>'plannedWeight')::double precision else null end,
              "plannedReps" = case when v_item ? 'plannedReps' then (v_item->>'plannedReps')::integer else null end,
              "plannedRpe" = v_planned_rpe,
              "intensity_type" = v_intensity,
              "isAuto" = coalesce((v_item->>'isAuto')::boolean,false),
              "isTop" = case when v_item ? 'isTop' and v_item->'isTop' <> 'null'::jsonb then (v_item->>'isTop')::boolean else v_index=0 end,
              actual = case when v_item ? 'actual' then (v_item->>'actual')::double precision else null end,
              reps = case when v_item ? 'reps' then (v_item->>'reps')::integer else null end,
              "executedRpe" = case when v_item ? 'executedRpe' then (v_item->>'executedRpe')::double precision else null end,
              "dropPercent" = case when v_item ? 'dropPercent' then (v_item->>'dropPercent')::double precision else null end,
              deleted_at = null, updated_at = v_now
            where es.id = v_set_id and es.exercise_id = v_entity_id;
          else
            insert into public.exercise_sets(id,exercise_id,lexo_rank,label,scope,"plannedWeight","plannedReps","plannedRpe","intensity_type","isAuto","isTop",actual,reps,"executedRpe","dropPercent",updated_at)
            values(v_set_id,v_entity_id,'a'||v_index::text,coalesce(nullif(v_item->>'label',''),'Set '||(v_index+1)::text),
              case when v_item->>'scope' in ('plan','log','both') then v_item->>'scope' else 'both' end,
              case when v_item ? 'plannedWeight' then (v_item->>'plannedWeight')::double precision else null end,
              case when v_item ? 'plannedReps' then (v_item->>'plannedReps')::integer else null end,v_planned_rpe,v_intensity,
              coalesce((v_item->>'isAuto')::boolean,false),case when v_item ? 'isTop' and v_item->'isTop'<>'null'::jsonb then (v_item->>'isTop')::boolean else v_index=0 end,
              case when v_item ? 'actual' then (v_item->>'actual')::double precision else null end,
              case when v_item ? 'reps' then (v_item->>'reps')::integer else null end,
              case when v_item ? 'executedRpe' then (v_item->>'executedRpe')::double precision else null end,
              case when v_item ? 'dropPercent' then (v_item->>'dropPercent')::double precision else null end,v_now);
          end if;
          v_index := v_index + 1;
        end loop;
        update public.exercise_sets es set deleted_at = v_now, updated_at = v_now
        where es.exercise_id = v_entity_id and es.deleted_at is null
          and not (es.id = any(v_incoming_ids));
      elsif v_fields ? 'sets' and v_fields->'sets' = 'null'::jsonb then
        -- Python replace_exercise_sets(None) raises during iteration; keep that
        -- malformed nested payload a request-level error instead of coercing it.
        raise exception 'Invalid nested set payload';
      end if;
    else
      update public.exercise_sets es set
        lexo_rank = case when v_fields ? 'lexo_rank' then v_fields->>'lexo_rank' else es.lexo_rank end,
        label = case when v_fields ? 'label' then v_fields->>'label' else es.label end,
        scope = case when v_fields ? 'scope' then v_fields->>'scope' else es.scope end,
        "plannedWeight" = case when v_fields ? 'plannedWeight' then (v_fields->>'plannedWeight')::double precision else es."plannedWeight" end,
        "plannedReps" = case when v_fields ? 'plannedReps' then (v_fields->>'plannedReps')::integer else es."plannedReps" end,
        "plannedRpe" = case when v_fields ? 'plannedRpe' then (v_fields->>'plannedRpe')::double precision else es."plannedRpe" end,
        "dropPercent" = case when v_fields ? 'dropPercent' then (v_fields->>'dropPercent')::double precision else es."dropPercent" end,
        "isAuto" = case when v_fields ? 'isAuto' then (v_fields->>'isAuto')::boolean else es."isAuto" end,
        actual = case when v_fields ? 'actual' then (v_fields->>'actual')::double precision else es.actual end,
        reps = case when v_fields ? 'reps' then (v_fields->>'reps')::integer else es.reps end,
        "executedRpe" = case when v_fields ? 'executedRpe' then (v_fields->>'executedRpe')::double precision else es."executedRpe" end,
        "isTop" = case when v_fields ? 'isTop' then (v_fields->>'isTop')::boolean else es."isTop" end,
        intensity_type = case when v_fields ? 'intensity_type' then v_fields->>'intensity_type' else es.intensity_type end,
        note = case when v_fields ? 'note' then v_fields->>'note' else es.note end,
        velocity = case when v_fields ? 'velocity' then (v_fields->>'velocity')::double precision else es.velocity end,
        readiness = case when v_fields ? 'readiness' then (v_fields->>'readiness')::integer else es.readiness end,
        hrv = case when v_fields ? 'hrv' then (v_fields->>'hrv')::double precision else es.hrv end,
        updated_at = v_now where es.id = v_entity_id;
    end if;

    v_accepted := v_accepted || pg_catalog.jsonb_build_array(v_mutation_id);
    insert into public.sync_mutations(mutation_id,client_device_id,entity_type,entity_id,field_path,updated_at,applied_at,result)
    values(v_mutation_id,v_device_id,v_entity,v_entity_id,'ALL',v_client_updated,v_now,'ACCEPTED');
  end loop;

  -- Use the same live-only metric function as transactional REST Set replacement.
  v_metrics := al_private.al_recalculate_workout_metrics(p_workout_id);
  v_total_tonnage := (v_metrics->>'tonnage')::double precision;

  select w.updated_at into v_canonical_updated_at from public.workouts w where w.id = p_workout_id;
  insert into public.domain_events(id,workout_id,event_type,payload_json,created_at)
  values('evt-' || extract(epoch from pg_catalog.clock_timestamp())::text,p_workout_id,'WORKOUT_SYNCED',
    pg_catalog.jsonb_build_object('accepted',pg_catalog.jsonb_array_length(v_accepted),'tonnage',v_total_tonnage)::text,
    pg_catalog.clock_timestamp() at time zone 'utc');

  return pg_catalog.jsonb_build_object(
    'denial',null,
    'workout_id',p_workout_id,
    'canonical_last_updated_at',pg_catalog.replace(v_canonical_updated_at::text,' ','T') || 'Z',
    'accepted_mutation_ids',v_accepted,
    'rejected_mutations',v_rejected,
    'conflicts',v_conflicts,
    'math_version','linear-decay-v3'
  );
end;
$function$;

revoke all on function al_private.al_workout_sync(text,text,text,text,boolean,integer,jsonb) from public, anon, authenticated;
grant execute on function al_private.al_workout_sync(text,text,text,text,boolean,integer,jsonb) to al_edge_catalog_runtime;


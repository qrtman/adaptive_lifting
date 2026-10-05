create or replace function al_private.al_sessions_copy_week(
  p_actor_user_id text,
  p_app_session_id text,
  p_source_ids text[],
  p_date_offset_days integer,
  p_target_block_label text,
  p_target_week_label text,
  p_copy_mode text,
  p_preserve_week_label boolean,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_source_id text;
  v_source public.workouts%rowtype;
  v_owner_id text;
  v_plan_owner_id text;
  v_parent_deleted_at timestamp without time zone;
  v_checked_shifted_date date;
  v_access jsonb;
  v_source_date date;
  v_new_date text;
  v_new_day_label text;
  v_new_week_label text;
  v_new_workout_id text;
  v_new_exercise_id text;
  v_new_set_id text;
  v_exercise public.exercises%rowtype;
  v_set public.exercise_sets%rowtype;
  v_created jsonb := '[]'::jsonb;
  v_week text;
  v_match text[];
  v_title_pattern text;
  v_category text;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_app_session_id is null or p_app_session_id = '' or pg_catalog.length(p_app_session_id) > 255
     or p_source_ids is null or pg_catalog.cardinality(p_source_ids) = 0
     or p_date_offset_days is null
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30
     or p_copy_mode not in ('lifts', 'plan', 'logs') then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  -- Validate every requested source and the single-plan boundary before writing.
  -- Duplicates intentionally remain in this list and produce independent copies.
  foreach v_source_id in array p_source_ids loop
    select w.* into v_source
      from public.workouts as w
     where w.id = v_source_id
     for update;
    if not found or v_source.deleted_at is not null then
      return pg_catalog.jsonb_build_object('denial', 'session_not_found', 'session_id', v_source_id);
    end if;

    if v_source.microcycle_id is not null then
      select mc.owner_id, mc.deleted_at into v_owner_id, v_parent_deleted_at
        from public.microcycles as mc
       where mc.id = v_source.microcycle_id
       for share;
      if not found or v_parent_deleted_at is not null then
        return pg_catalog.jsonb_build_object('denial', 'session_not_found', 'session_id', v_source_id);
      end if;
    else
      v_owner_id := null;
    end if;
    v_owner_id := coalesce(v_source.owner_id, v_owner_id);
    if v_owner_id is null or v_owner_id = '' then
      return pg_catalog.jsonb_build_object('denial', 'session_has_no_owner');
    end if;
    -- Validate every date shift before any clone is written so a late invalid
    -- source cannot return a denial after earlier source trees were inserted.
    begin
      v_checked_shifted_date := v_source.date::date + p_date_offset_days;
    exception when others then
      return pg_catalog.jsonb_build_object('denial', 'invalid_source_date', 'session_id', v_source_id);
    end;
    if v_plan_owner_id is null then
      v_plan_owner_id := v_owner_id;
    elsif v_plan_owner_id <> v_owner_id then
      return pg_catalog.jsonb_build_object('denial', 'mixed_plan');
    end if;
  end loop;

  -- The existing session update RPC is the canonical app-session, plan access,
  -- and coach programming entitlement guard. It locks each source through this
  -- transaction and its result is checked before any clone is created.
  foreach v_source_id in array p_source_ids loop
    select al_private.al_session_update(
      p_actor_user_id, p_app_session_id, v_source_id,
      null::text, null::text, null::text, null::text, null::text, null::text,
      p_enforce_legacy_email_verification, p_past_due_grace_days
    ) into v_access;
    if v_access ->> 'denial' is not null then
      v_access := v_access || pg_catalog.jsonb_build_object('session_id', v_source_id);
      return v_access;
    end if;
  end loop;

  foreach v_source_id in array p_source_ids loop
    select w.* into v_source from public.workouts as w where w.id = v_source_id;
    v_source_date := v_source.date::date;
    v_new_date := (v_source_date + p_date_offset_days)::text;

    v_week := pg_catalog.btrim(coalesce(v_source.week_label, ''));
    if p_target_week_label is not null then
      v_new_week_label := p_target_week_label;
    elsif p_preserve_week_label then
      v_new_week_label := v_source.week_label;
    elsif v_week = '' then
      v_new_week_label := null;
    else
      v_match := pg_catalog.regexp_match(v_week, '^(.*?)([0-9]+)$');
      if v_match is null then
        v_new_week_label := v_week || '-next';
      else
        v_new_week_label := v_match[1] || ((v_match[2]::numeric + 1)::text);
      end if;
    end if;

    v_week := pg_catalog.btrim(coalesce(v_source."dayLabel", ''));
    if v_week = '' or v_week ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_new_day_label := v_new_date;
    else
      v_new_day_label := v_week;
    end if;

    v_new_workout_id := 'w-' || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10);
    insert into public.workouts(
      id, date, "dayLabel", title, tonnage, delta, color, status, athlete_bw,
      block_label, week_label, owner_id, microcycle_id, updated_at, deleted_at
    ) values (
      v_new_workout_id, v_new_date, v_new_day_label, v_source.title,
      case when p_copy_mode = 'logs' then v_source.tonnage else 0.0 end,
      0.0, v_source.color, 'PLANNED', v_source.athlete_bw,
      case when p_target_block_label is not null then p_target_block_label else v_source.block_label end,
      v_new_week_label, v_source.owner_id, v_source.microcycle_id, v_now, null
    );

    for v_exercise in
      select e.* from public.exercises as e
       where e.workout_id = v_source.id and e.deleted_at is null
       order by coalesce(e.lexo_rank, ''), e.id
    loop
      v_new_exercise_id := 'e-' || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10);
      v_category := coalesce(nullif(v_exercise.lift_category, ''), 'Other');
      v_title_pattern := v_exercise.movement_pattern;
      if v_title_pattern is null or v_title_pattern = '' then
        -- Keep the existing Python pattern_for title-substring precedence.
        v_title_pattern := case
          when v_exercise.title = 'Squat' or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'squat') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'leg press') > 0 then 'Knee Dominant'
          when v_exercise.title = 'Deadlift' or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'deadlift') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'rdl') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'good morning') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'hip thrust') > 0 then 'Hip Dominant'
          when pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'bench') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'floor press') > 0 then 'Horizontal Push'
          when pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'press') > 0 then 'Vertical Push'
          when pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'chest supported row') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'cable row') > 0 then 'Horizontal Pull'
          when pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'pull-up') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'lat pulldown') > 0 then 'Vertical Pull'
          when pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'curl') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'tricep extension') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'face pull') > 0 then 'Misc'
          when pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'clean') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'snatch') > 0 or pg_catalog.strpos(pg_catalog.lower(v_exercise.title), 'jerk') > 0 then 'Weightlifting'
          else case v_category when 'Squat' then 'Knee Dominant' when 'Bench' then 'Horizontal Push' when 'Deadlift' then 'Hip Dominant' else 'Misc' end
        end;
      end if;
      insert into public.exercises(
        id, lexo_rank, title, variation, tier, lift_category, movement_pattern,
        lift_note, tags_raw, top, vol, workout_id, updated_at, deleted_at
      ) values (
        v_new_exercise_id, coalesce(v_exercise.lexo_rank, 'a0'), v_exercise.title,
        v_exercise.variation, coalesce(v_exercise.tier, 'Comp'), v_category,
        v_title_pattern, v_exercise.lift_note, coalesce(v_exercise.tags_raw, ''),
        case when p_copy_mode = 'lifts' then '—' else v_exercise.top end,
        case when p_copy_mode = 'lifts' then '—' else v_exercise.vol end,
        v_new_workout_id, v_now, null
      );

      if p_copy_mode <> 'lifts' then
        for v_set in
          select s.* from public.exercise_sets as s
           where s.exercise_id = v_exercise.id and s.deleted_at is null
           order by coalesce(s.lexo_rank, ''), s.id
        loop
          v_new_set_id := 's-' || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10);
          insert into public.exercise_sets(
            id, lexo_rank, label, scope, "plannedWeight", "plannedReps", "plannedRpe",
            intensity_type, "dropPercent", "isAuto", actual, reps, "executedRpe", "isTop",
            note, velocity, readiness, hrv, exercise_id, updated_at, deleted_at
          ) values (
            v_new_set_id, coalesce(v_set.lexo_rank, 'a0'), v_set.label,
            case when p_copy_mode = 'plan' then 'plan' else coalesce(nullif(v_set.scope, ''), 'both') end,
            v_set."plannedWeight", v_set."plannedReps", v_set."plannedRpe",
            coalesce(nullif(v_set.intensity_type, ''), 'RPE'), v_set."dropPercent",
            v_set."isAuto", case when p_copy_mode = 'plan' then null else v_set.actual end,
            case when p_copy_mode = 'plan' then null else v_set.reps end,
            case when p_copy_mode = 'plan' then null else v_set."executedRpe" end,
            v_set."isTop", case when p_copy_mode = 'plan' then null else v_set.note end,
            case when p_copy_mode = 'plan' then null else v_set.velocity end,
            case when p_copy_mode = 'plan' then null else v_set.readiness end,
            case when p_copy_mode = 'plan' then null else v_set.hrv end,
            v_new_exercise_id, v_now, null
          );
        end loop;
      end if;
    end loop;

    v_created := v_created || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_new_workout_id,
      'date', v_new_date,
      'title', v_source.title,
      'blockLabel', case when p_target_block_label is not null then p_target_block_label else v_source.block_label end,
      'weekLabel', v_new_week_label,
      'sourceId', v_source.id
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'result', pg_catalog.jsonb_build_object('status', 'success', 'copied', v_created)
  );
end;
$function$;

revoke all on function al_private.al_sessions_copy_week(text,text,text[],integer,text,text,text,boolean,boolean,integer) from public, anon, authenticated;
grant execute on function al_private.al_sessions_copy_week(text,text,text[],integer,text,text,text,boolean,boolean,integer) to al_edge_catalog_runtime;

-- Server-issued row revisions and transactional compare-before-write guards.
-- Existing migrations and remote history are left untouched.

alter table public.workouts add column revision bigint not null default 1 check (revision > 0);
alter table public.exercises add column revision bigint not null default 1 check (revision > 0);
alter table public.exercise_sets add column revision bigint not null default 1 check (revision > 0);

create or replace function al_private.al_bump_training_revision()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.revision := old.revision + 1;
  return new;
end;
$function$;
revoke all on function al_private.al_bump_training_revision() from public,anon,authenticated,al_edge_catalog_runtime;

create trigger workouts_revision_before_update before update on public.workouts
for each row execute function al_private.al_bump_training_revision();
create trigger exercises_revision_before_update before update on public.exercises
for each row execute function al_private.al_bump_training_revision();
create trigger exercise_sets_revision_before_update before update on public.exercise_sets
for each row execute function al_private.al_bump_training_revision();

create or replace function al_private.al_bump_parent_exercise_revision()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_exercise_id text;
begin
  v_exercise_id := case when tg_op = 'DELETE' then old.exercise_id else new.exercise_id end;
  update public.exercises set revision = revision + 1 where id = v_exercise_id;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function al_private.al_bump_parent_exercise_revision() from public,anon,authenticated,al_edge_catalog_runtime;

create trigger exercise_sets_revision_parent_after_write
after insert or update or delete on public.exercise_sets
for each row execute function al_private.al_bump_parent_exercise_revision();

create or replace function al_private.al_exercise_sets_snapshot(p_exercise_id text)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',es.id,'revision',es.revision,'label',es.label,'scope',coalesce(nullif(es.scope,''),'both'),
    'plannedWeight',es."plannedWeight",'plannedReps',es."plannedReps",'plannedRpe',es."plannedRpe",
    'actual',es.actual,'reps',es.reps,'executedRpe',es."executedRpe",'velocity',es.velocity,
    'readiness',es.readiness,'hrv',es.hrv,'isAuto',coalesce(es."isAuto",false),
    'isTop',coalesce(es."isTop",false),'intensityType',coalesce(nullif(es.intensity_type,''),'RPE'),
    'dropPercent',coalesce(es."dropPercent",0),'note',es.note
  ) order by coalesce(es.lexo_rank,''),es.id),'[]'::jsonb)
  from public.exercise_sets es where es.exercise_id=p_exercise_id and es.deleted_at is null;
$function$;
revoke all on function al_private.al_exercise_sets_snapshot(text) from public,anon,authenticated;

-- Preserve the established authorization-filtered projection and add only
-- server-generated revision values needed to form offline baselines.
create or replace function al_private.al_microcycles_read_with_revisions(
  p_actor_user_id text, p_session_id text, p_athlete_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_result jsonb;
  v_cycles jsonb := '[]'::jsonb;
  v_workouts jsonb;
  v_exercises jsonb;
  v_sets jsonb;
  v_mc jsonb;
  v_w jsonb;
  v_e jsonb;
  v_s jsonb;
  v_revision bigint;
begin
  v_result := al_private.al_microcycles_read(
    p_actor_user_id,p_session_id,p_athlete_id,p_enforce_legacy_email_verification
  );
  if coalesce(v_result->>'denial','') <> '' then return v_result; end if;
  for v_mc in select value from pg_catalog.jsonb_array_elements(coalesce(v_result->'microcycles','[]'::jsonb)) loop
    v_workouts := '[]'::jsonb;
    for v_w in select value from pg_catalog.jsonb_array_elements(coalesce(v_mc->'workouts','[]'::jsonb)) loop
      select w.revision into v_revision from public.workouts w where w.id=v_w->>'id' and w.deleted_at is null;
      v_exercises := '[]'::jsonb;
      for v_e in select value from pg_catalog.jsonb_array_elements(coalesce(v_w->'exercises','[]'::jsonb)) loop
        select e.revision into v_revision from public.exercises e where e.id=v_e->>'id' and e.deleted_at is null;
        v_sets := '[]'::jsonb;
        for v_s in select value from pg_catalog.jsonb_array_elements(coalesce(v_e->'sets','[]'::jsonb)) loop
          select es.revision into v_revision from public.exercise_sets es where es.id=v_s->>'id' and es.deleted_at is null;
          v_sets := v_sets || pg_catalog.jsonb_build_array(v_s || pg_catalog.jsonb_build_object('revision',v_revision));
        end loop;
        select e.revision into v_revision from public.exercises e where e.id=v_e->>'id' and e.deleted_at is null;
        v_exercises := v_exercises || pg_catalog.jsonb_build_array(
          v_e || pg_catalog.jsonb_build_object('revision',v_revision,'sets',v_sets)
        );
      end loop;
      select w.revision into v_revision from public.workouts w where w.id=v_w->>'id' and w.deleted_at is null;
      v_workouts := v_workouts || pg_catalog.jsonb_build_array(
        v_w || pg_catalog.jsonb_build_object('revision',v_revision,'exercises',v_exercises)
      );
    end loop;
    v_cycles := v_cycles || pg_catalog.jsonb_build_array(v_mc || pg_catalog.jsonb_build_object('workouts',v_workouts));
  end loop;
  return pg_catalog.jsonb_build_object('denial',null,'microcycles',v_cycles);
end;
$function$;
revoke all on function al_private.al_microcycles_read_with_revisions(text,text,text,boolean) from public,anon,authenticated;
grant execute on function al_private.al_microcycles_read_with_revisions(text,text,text,boolean) to al_edge_catalog_runtime;

-- This guard is called from the runtime wrapper immediately before the legacy
-- sync implementation in the same transaction. Row locks therefore make the
-- compare and write atomic. base_fields lets independent fields merge safely;
-- nested set replacement instead requires the unchanged parent revision.
create or replace function al_private.al_workout_sync_revision_guard(
  p_actor_user_id text,p_session_id text,p_workout_id text,p_client_device_id text,
  p_enforce_legacy_email_verification boolean,p_past_due_grace_days integer,p_changes jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_guard jsonb;
  v_lock public.workout_locks%rowtype;
  v_raw public.client_devices%rowtype;
  v_device public.client_devices%rowtype;
  v_device_id text;
  v_change jsonb;
  v_entity text;
  v_id text;
  v_mutation_id text;
  v_fields jsonb;
  v_base_fields jsonb;
  v_current jsonb;
  v_current_fields jsonb;
  v_server_fields jsonb;
  v_revision bigint;
  v_base_revision bigint;
  v_key text;
  v_conflicts jsonb := '[]'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_scope text;
  v_overlap boolean;
  v_stale boolean;
  v_deleted boolean;
begin
  if p_client_device_id is null or p_client_device_id='' or p_changes is null
     or pg_catalog.jsonb_typeof(p_changes)<>'array' then
    return pg_catalog.jsonb_build_object('denial','invalid_request');
  end if;
  v_guard := al_private.al_session_update(
    p_actor_user_id,p_session_id,p_workout_id,null,null,null,null,null,null,
    p_enforce_legacy_email_verification,p_past_due_grace_days
  );
  if coalesce(v_guard->>'denial','') <> '' then return v_guard; end if;
  select * into v_lock from public.workout_locks wl where wl.workout_id=p_workout_id for update;
  if found and v_lock.holder_user_id<>p_actor_user_id and v_lock.expires_at>pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('denial','workout_locked');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workout-sync:raw:'||p_client_device_id,0));
  select * into v_raw from public.client_devices d where d.id=p_client_device_id;
  v_device_id := case when found and v_raw.user_id<>p_actor_user_id then p_actor_user_id||':'||p_client_device_id else p_client_device_id end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workout-sync:device:'||v_device_id,0));
  select * into v_device from public.client_devices d where d.id=v_device_id for update;
  if found and (v_device.revoked_at is not null or v_device.user_id is distinct from p_actor_user_id) then
    return pg_catalog.jsonb_build_object('denial','device_revoked');
  end if;

  for v_change in select value from pg_catalog.jsonb_array_elements(p_changes) loop
    v_entity := v_change->>'entity'; v_id := v_change->>'id'; v_mutation_id := v_change->>'mutation_id';
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workout-sync:mutation:'||v_device_id||':'||v_mutation_id,0));
    if exists(select 1 from public.sync_mutations m where m.client_device_id=v_device_id and m.mutation_id=v_mutation_id) then
      continue;
    end if;
    v_current := null; v_revision := null; v_deleted := false;
    if v_entity='Workout' then
      select to_jsonb(w),w.revision into v_current,v_revision from public.workouts w where w.id=v_id and w.id=p_workout_id for update;
    elsif v_entity='Exercise' then
      select to_jsonb(e),e.revision into v_current,v_revision from public.exercises e where e.id=v_id and e.workout_id=p_workout_id for update;
      if v_current is not null and coalesce((v_change->'fields') ? 'sets',false) then
        perform 1 from public.exercise_sets es where es.exercise_id=v_id order by es.id for update;
      end if;
    elsif v_entity='ExerciseSet' then
      perform 1 from public.exercises e join public.exercise_sets es on es.exercise_id=e.id
        where es.id=v_id and e.workout_id=p_workout_id for update of e;
      select to_jsonb(es),es.revision into v_current,v_revision from public.exercise_sets es
        join public.exercises e on e.id=es.exercise_id
        where es.id=v_id and e.workout_id=p_workout_id for update of es;
    else
      continue;
    end if;
    if v_current is null then continue; end if; -- Existing RPC returns its normal not-found result.
    v_fields := coalesce(v_change->'fields','{}'::jsonb);
    if pg_catalog.jsonb_typeof(v_fields)<>'object' then return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
    v_deleted := coalesce(v_current->>'deleted_at','') <> '';
    if v_deleted then
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'mutation_id',v_mutation_id,'entity_type',v_entity,'entity_id',v_id,'reason','TOMBSTONE_CONFLICT',
        'base_revision',v_change->'base_revision','server_revision',v_revision,
        'server_fields','{}'::jsonb,'client_fields',v_fields));
      continue;
    end if;
    v_scope := v_entity||':'||v_id;
    v_overlap := false;
    if pg_catalog.jsonb_typeof(v_seen->v_scope)='object' then
      for v_key in select key from pg_catalog.jsonb_each(v_fields) loop
        if (v_seen->v_scope) ? v_key then v_overlap := true; end if;
      end loop;
    end if;
    if not v_overlap then
      v_seen := pg_catalog.jsonb_set(v_seen,array[v_scope],coalesce(v_seen->v_scope,'{}'::jsonb)||v_fields,true);
    end if;
    v_base_fields := v_change->'base_fields';
    if coalesce(v_change->>'base_revision','') ~ '^[1-9][0-9]*$' then
      begin v_base_revision := (v_change->>'base_revision')::bigint; exception when others then v_base_revision := null; end;
    else v_base_revision := null; end if;
    v_stale := v_overlap or v_base_revision is null or v_base_revision > v_revision;
    v_server_fields := '{}'::jsonb;
    if v_entity='Exercise' and v_fields ? 'sets' then
      v_server_fields := pg_catalog.jsonb_build_object('sets',al_private.al_exercise_sets_snapshot(v_id));
      if v_base_revision is distinct from v_revision then v_stale := true; end if;
    elsif v_base_revision < v_revision then
      if pg_catalog.jsonb_typeof(v_base_fields)<>'object' then v_stale := true;
      else
        for v_key in select key from pg_catalog.jsonb_each(v_fields) loop
          if not (v_base_fields ? v_key) or not (v_current ? v_key) then
            v_stale := true;
          elsif (v_current->v_key) is distinct from (v_base_fields->v_key) then
            v_stale := true;
          else
            v_server_fields := v_server_fields || pg_catalog.jsonb_build_object(v_key,v_current->v_key);
          end if;
        end loop;
      end if;
    end if;
    if v_stale then
      if v_entity<>'Exercise' or not (v_fields ? 'sets') then
      if pg_catalog.jsonb_typeof(v_base_fields)='object' then
          for v_key in select key from pg_catalog.jsonb_each(v_fields) loop
            if v_current ? v_key then v_server_fields := v_server_fields || pg_catalog.jsonb_build_object(v_key,v_current->v_key); end if;
          end loop;
      else
        for v_key in select key from pg_catalog.jsonb_each(v_fields) loop
          if v_current ? v_key then v_server_fields := v_server_fields || pg_catalog.jsonb_build_object(v_key,v_current->v_key); end if;
        end loop;
        end if;
      end if;
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'mutation_id',v_mutation_id,'entity_type',v_entity,'entity_id',v_id,'reason',
        case when v_overlap then 'OVERLAPPING_BATCH_PATCH' when v_base_revision is null then 'BASELINE_REQUIRED' else 'STALE_REVISION' end,
        'base_revision',v_base_revision,'server_revision',v_revision,
        'server_fields',v_server_fields,'client_fields',v_fields));
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('denial',null,'conflicts',v_conflicts);
end;
$function$;

revoke all on function al_private.al_workout_sync_revision_guard(text,text,text,text,boolean,integer,jsonb) from public,anon,authenticated;
grant execute on function al_private.al_workout_sync_revision_guard(text,text,text,text,boolean,integer,jsonb) to al_edge_catalog_runtime;

-- Replace only the runtime route wrapper. The 7-argument implementation stays
-- byte-for-byte historical and is callable only by this SECURITY DEFINER owner.
create or replace function al_private.al_workout_sync(
  p_actor_user_id text,p_session_id text,p_route_workout_id text,p_payload_workout_id text,
  p_client_device_id text,p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer,p_changes jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_guard jsonb; v_result jsonb;
begin
  if p_route_workout_id is null or p_payload_workout_id is null or p_route_workout_id is distinct from p_payload_workout_id then
    return pg_catalog.jsonb_build_object('denial','path_payload_mismatch');
  end if;
  v_guard := al_private.al_workout_sync_revision_guard(
    p_actor_user_id,p_session_id,p_payload_workout_id,p_client_device_id,
    p_enforce_legacy_email_verification,p_past_due_grace_days,p_changes
  );
  if coalesce(v_guard->>'denial','')<>'' then return v_guard; end if;
  if pg_catalog.jsonb_array_length(coalesce(v_guard->'conflicts','[]'::jsonb))>0 then
    return pg_catalog.jsonb_build_object('denial','revision_conflict','conflicts',v_guard->'conflicts','accepted_mutation_ids','[]'::jsonb);
  end if;
  v_result := al_private.al_workout_sync(
    p_actor_user_id,p_session_id,p_payload_workout_id,p_client_device_id,
    p_enforce_legacy_email_verification,p_past_due_grace_days,p_changes
  );
  return v_result;
end;
$function$;
revoke all on function al_private.al_workout_sync(text,text,text,text,boolean,integer,jsonb) from public,anon,authenticated,al_edge_catalog_runtime;
revoke all on function al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb) from public,anon,authenticated;
grant execute on function al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb) to al_edge_catalog_runtime;

-- Required next-token CAS for nested child-set replacement from REST.
create or replace function al_private.al_session_replace_exercise_sets_checked(
  p_actor_user_id text,p_app_session_id text,p_workout_id text,p_exercise_id text,
  p_expected_revision bigint,p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer,p_sets jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_guard jsonb; v_ex public.exercises%rowtype; v_result jsonb;
begin
  v_guard := al_private.al_session_update(p_actor_user_id,p_app_session_id,p_workout_id,
    null,null,null,null,null,null,p_enforce_legacy_email_verification,p_past_due_grace_days);
  if coalesce(v_guard->>'denial','')<>'' then return v_guard; end if;
  select e.* into v_ex from public.exercises e where e.id=p_exercise_id and e.workout_id=p_workout_id and e.deleted_at is null for update;
  if not found then return pg_catalog.jsonb_build_object('denial','lift_not_found'); end if;
  perform 1 from public.exercise_sets es where es.exercise_id=p_exercise_id order by es.id for update;
  if p_expected_revision is null or p_expected_revision<>v_ex.revision then
    return pg_catalog.jsonb_build_object('denial','revision_conflict','conflict',pg_catalog.jsonb_build_object(
      'entity_type','Exercise','entity_id',p_exercise_id,'reason',case when p_expected_revision is null then 'BASELINE_REQUIRED' else 'STALE_REVISION' end,
      'server_revision',v_ex.revision,'server_fields',pg_catalog.jsonb_build_object('sets',al_private.al_exercise_sets_snapshot(p_exercise_id))));
  end if;
  v_result := al_private.al_session_replace_exercise_sets(p_actor_user_id,p_app_session_id,p_workout_id,p_exercise_id,
    p_enforce_legacy_email_verification,p_past_due_grace_days,p_sets);
  select e.* into v_ex from public.exercises e where e.id=p_exercise_id;
  return v_result || pg_catalog.jsonb_build_object('exercise',coalesce(v_result->'exercise','{}'::jsonb)||pg_catalog.jsonb_build_object('revision',v_ex.revision));
end;
$function$;
revoke all on function al_private.al_session_replace_exercise_sets(text,text,text,text,boolean,integer,jsonb) from al_edge_catalog_runtime;
revoke all on function al_private.al_session_replace_exercise_sets_checked(text,text,text,text,bigint,boolean,integer,jsonb) from public,anon,authenticated;
grant execute on function al_private.al_session_replace_exercise_sets_checked(text,text,text,text,bigint,boolean,integer,jsonb) to al_edge_catalog_runtime;

-- Required revision on direct Set Log writes; row and parent are locked before
-- the historical writer, matching the same serialization order as nested sync.
create or replace function al_private.al_set_log_checked(
  p_actor_user_id text,p_app_session_id text,p_workout_id text,p_exercise_id text,p_set_id text,
  p_weight double precision,p_reps integer,p_rpe double precision,p_note text,p_velocity double precision,
  p_readiness integer,p_hrv double precision,p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer,p_expected_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_guard jsonb; v_ex public.exercises%rowtype; v_set public.exercise_sets%rowtype; v_result jsonb;
begin
  v_guard := al_private.al_session_update(p_actor_user_id,p_app_session_id,p_workout_id,
    null,null,null,null,null,null,p_enforce_legacy_email_verification,p_past_due_grace_days);
  if coalesce(v_guard->>'denial','')<>'' then return v_guard; end if;
  select e.* into v_ex from public.exercises e where e.id=p_exercise_id and e.workout_id=p_workout_id and e.deleted_at is null for update;
  if not found then return pg_catalog.jsonb_build_object('denial','lift_not_found'); end if;
  select es.* into v_set from public.exercise_sets es where es.id=p_set_id and es.exercise_id=p_exercise_id and es.deleted_at is null for update;
  if not found then return pg_catalog.jsonb_build_object('denial','target_set_not_found'); end if;
  if p_expected_revision is null or p_expected_revision<>v_set.revision then
    return pg_catalog.jsonb_build_object('denial','revision_conflict','conflict',pg_catalog.jsonb_build_object(
      'entity_type','ExerciseSet','entity_id',p_set_id,'reason',case when p_expected_revision is null then 'BASELINE_REQUIRED' else 'STALE_REVISION' end,
      'server_revision',v_set.revision,'server_fields',to_jsonb(v_set)));
  end if;
  v_result := al_private.al_set_log(p_actor_user_id,p_app_session_id,p_workout_id,p_exercise_id,p_set_id,
    p_weight,p_reps,p_rpe,p_note,p_velocity,p_readiness,p_hrv,p_enforce_legacy_email_verification);
  return v_result;
end;
$function$;
revoke all on function al_private.al_set_log(text,text,text,text,text,double precision,integer,double precision,text,double precision,integer,double precision,boolean) from al_edge_catalog_runtime;
revoke all on function al_private.al_set_log_checked(text,text,text,text,text,double precision,integer,double precision,text,double precision,integer,double precision,boolean,integer,bigint) from public,anon,authenticated;
grant execute on function al_private.al_set_log_checked(text,text,text,text,text,double precision,integer,double precision,text,double precision,integer,double precision,boolean,integer,bigint) to al_edge_catalog_runtime;

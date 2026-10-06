-- Narrow DayNote and export interfaces for the custom-auth Edge API.
-- Training tree JSON is delegated to al_microcycles_read for canonical formatting.

grant usage on schema al_private to al_edge_catalog_runtime;

create or replace function al_private.al_day_notes_actor_context(
  p_actor_user_id text,
  p_session_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_role text;
  v_google_sub text;
  v_email_verified_at timestamp without time zone;
  v_verification_required boolean;
  v_legacy_exempt boolean;
  v_deleted_at timestamp without time zone;
  v_owner_ids text[];
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_session_id is null or p_session_id = '' or pg_catalog.length(p_session_id) > 255 then
    return pg_catalog.jsonb_build_object('denial','invalid_request');
  end if;

  select u.role, u.google_sub, u.email_verified_at,
         u.email_verification_required, u.email_verification_legacy_exempt, u.deleted_at
    into v_role, v_google_sub, v_email_verified_at,
         v_verification_required, v_legacy_exempt, v_deleted_at
    from public.users as u
    join public.sessions as s on s.user_id = u.id
   where u.id = p_actor_user_id
     and s.id = p_session_id
     and s.jwt_id = p_session_id
     and s.revoked_at is null
     and s.expires_at > pg_catalog.timezone('utc', pg_catalog.now());

  if not found then
    return pg_catalog.jsonb_build_object('denial','invalid_session');
  end if;
  if v_deleted_at is not null or (v_email_verified_at is null and v_google_sub is null and (
      case when v_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
           else coalesce(v_verification_required,true) end
  )) then
    return pg_catalog.jsonb_build_object('denial','account_ineligible');
  end if;
  if v_role = 'ATHLETE' then
    v_owner_ids := array[p_actor_user_id];
  elsif v_role = 'COACH' then
    select array[p_actor_user_id] || coalesce(
      pg_catalog.array_agg(cr.athlete_id order by cr.athlete_id), array[]::text[]
    ) into v_owner_ids
      from public.coaching_relationships as cr
      join public.users as athlete on athlete.id=cr.athlete_id
     where cr.coach_id = p_actor_user_id and cr.ended_at is null
       and cr.deleted_at is null and athlete.deleted_at is null;
  else
    return pg_catalog.jsonb_build_object('denial','unsupported_role');
  end if;

  return pg_catalog.jsonb_build_object(
    'denial',null,'role',v_role,'owner_ids',to_jsonb(v_owner_ids),
    'linked_ids',case when v_role='COACH' then (
      select coalesce(pg_catalog.jsonb_agg(cr.athlete_id order by cr.athlete_id),'[]'::jsonb)
        from public.coaching_relationships as cr
        join public.users as athlete on athlete.id=cr.athlete_id
       where cr.coach_id=p_actor_user_id and cr.ended_at is null
         and cr.deleted_at is null and athlete.deleted_at is null
    ) else '[]'::jsonb end
  );
end;
$function$;

create or replace function al_private.al_day_notes_read(
  p_actor_user_id text,
  p_session_id text,
  p_athlete_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_owner_id text;
  v_notes jsonb;
begin
  v_context := al_private.al_day_notes_actor_context(
    p_actor_user_id,p_session_id,p_enforce_legacy_email_verification
  );
  if v_context->>'denial' is not null then return v_context; end if;

  if v_context->>'role' = 'ATHLETE' then
    if p_athlete_id is not null and p_athlete_id <> p_actor_user_id then
      return pg_catalog.jsonb_build_object('denial','athlete_forbidden');
    end if;
    v_owner_id := p_actor_user_id;
  else
    if p_athlete_id is null or p_athlete_id = '' then
      return pg_catalog.jsonb_build_object('denial','athlete_required');
    end if;
    if not (v_context->'linked_ids' @> pg_catalog.to_jsonb(p_athlete_id)) then
      return pg_catalog.jsonb_build_object('denial','coach_relationship_required');
    end if;
    v_owner_id := p_athlete_id;
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id',dn.id,'date',dn.date,'body',dn.body,'ownerId',dn.owner_id
    ) order by dn.date asc
  ),'[]'::jsonb)
    into v_notes
    from public.day_notes as dn
   where dn.owner_id = v_owner_id
     and dn.deleted_at is null
     and pg_catalog.btrim(coalesce(dn.body,'')) <> '';
  return pg_catalog.jsonb_build_object('denial',null,'notes',v_notes);
end;
$function$;

create or replace function al_private.al_day_notes_upsert(
  p_actor_user_id text,
  p_session_id text,
  p_athlete_id text,
  p_date text,
  p_body text,
  p_new_note_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_owner_id text;
  v_row public.day_notes%rowtype;
  v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  v_context := al_private.al_day_notes_actor_context(
    p_actor_user_id,p_session_id,p_enforce_legacy_email_verification
  );
  if v_context->>'denial' is not null then return v_context; end if;

  if v_context->>'role' = 'ATHLETE' then
    if p_athlete_id is not null and p_athlete_id <> p_actor_user_id then
      return pg_catalog.jsonb_build_object('denial','athlete_forbidden');
    end if;
    v_owner_id := p_actor_user_id;
  else
    if p_athlete_id is null or p_athlete_id = '' then
      return pg_catalog.jsonb_build_object('denial','athlete_required');
    end if;
    if not (v_context->'linked_ids' @> pg_catalog.to_jsonb(p_athlete_id)) then
      return pg_catalog.jsonb_build_object('denial','coach_relationship_required');
    end if;
    v_owner_id := p_athlete_id;
  end if;

  if p_date is null or p_date !~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$'
     or pg_catalog.length(p_date) > 10 or p_body is null or pg_catalog.length(p_body) > 2000 then
    return pg_catalog.jsonb_build_object('denial','invalid_request');
  end if;
  if p_body <> '' and (p_new_note_id is null or p_new_note_id !~ '^dn-[0-9a-f]{10}$') then
    return pg_catalog.jsonb_build_object('denial','invalid_request');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('day-note:' || v_owner_id || ':' || p_date,0)
  );
  select dn.* into v_row
    from public.day_notes as dn
   where dn.owner_id = v_owner_id and dn.date = p_date
   for update;

  if p_body = '' then
    if found and v_row.deleted_at is null then
      update public.day_notes as dn
         set body = '', deleted_at = v_now, updated_at = v_now
       where dn.id = v_row.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'denial',null,'note',pg_catalog.jsonb_build_object(
        'id',case when found then v_row.id else null end,
        'date',p_date,'body',null,'ownerId',v_owner_id
      )
    );
  end if;

  if found then
    update public.day_notes as dn
       set body = p_body, deleted_at = null, updated_at = v_now
     where dn.id = v_row.id
     returning dn.* into v_row;
  else
    insert into public.day_notes(id,owner_id,date,body,updated_at,deleted_at)
      values(p_new_note_id,v_owner_id,p_date,p_body,v_now,null)
      returning * into v_row;
  end if;
  return pg_catalog.jsonb_build_object('denial',null,'note',pg_catalog.jsonb_build_object(
    'id',v_row.id,'date',v_row.date,'body',v_row.body,'ownerId',v_row.owner_id
  ));
end;
$function$;

create or replace function al_private.al_export_csv_rows(
  p_actor_user_id text,
  p_session_id text,
  p_lift_category text,
  p_tier text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_rows jsonb;
begin
  v_context := al_private.al_day_notes_actor_context(
    p_actor_user_id,p_session_id,p_enforce_legacy_email_verification
  );
  if v_context->>'denial' is not null then return v_context; end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'ownerId',mc.owner_id,'date',w.date,'exerciseId',e.id,'setId',es.id,
    'liftCategory',coalesce(nullif(e.lift_category,''),'Squat'),
    'tier',coalesce(nullif(e.tier,''),'Comp'),'title',e.title,
    'plannedWeight',es."plannedWeight",'actual',es.actual,
    'reps',coalesce(es.reps,es."plannedReps",0),
    'rpe',coalesce(es."executedRpe",es."plannedRpe",0)
  ) order by w.date,e.id,es.id),'[]'::jsonb)
    into v_rows
    from public.exercise_sets as es
    join public.exercises as e on e.id=es.exercise_id and e.deleted_at is null
    join public.workouts as w on w.id=e.workout_id and w.deleted_at is null
    join public.microcycles as mc on mc.id=w.microcycle_id and mc.deleted_at is null
   where es.deleted_at is null
     and v_context->'owner_ids' @> pg_catalog.to_jsonb(mc.owner_id)
     and (p_lift_category is null or p_lift_category = '' or p_lift_category = 'All' or e.lift_category = p_lift_category)
     and (p_tier is null or p_tier = '' or e.tier = p_tier);
  return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_export_json(
  p_actor_user_id text,
  p_session_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_read jsonb;
  v_rows jsonb;
  v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  v_read := al_private.al_microcycles_read(
    p_actor_user_id,p_session_id,null,p_enforce_legacy_email_verification
  );
  if v_read->>'denial' is not null then return v_read; end if;
  v_rows := coalesce(v_read->'microcycles','[]'::jsonb);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(pg_catalog.gen_random_uuid()::text,p_actor_user_id,'EXPORT_JSON','WorkoutTree','all',v_now,
    pg_catalog.jsonb_build_object('microcycle_count',pg_catalog.jsonb_array_length(v_rows))::text);
  return pg_catalog.jsonb_build_object('denial',null,'microcycles',v_rows);
end;
$function$;

create or replace function al_private.al_export_csv_audit(
  p_actor_user_id text,
  p_session_id text,
  p_owner_ids text[],
  p_row_count integer,
  p_lift_category text,
  p_tier text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  v_context := al_private.al_day_notes_actor_context(
    p_actor_user_id,p_session_id,p_enforce_legacy_email_verification
  );
  if v_context->>'denial' is not null then return v_context; end if;
  if p_row_count is null or p_row_count < 0 or p_owner_ids is null then
    return pg_catalog.jsonb_build_object('denial','invalid_request');
  end if;
  if exists(select 1 from pg_catalog.unnest(p_owner_ids) as ids(owner_id)
             where not (v_context->'owner_ids' @> pg_catalog.to_jsonb(ids.owner_id))) then
    return pg_catalog.jsonb_build_object('denial','coach_relationship_required');
  end if;
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(pg_catalog.gen_random_uuid()::text,p_actor_user_id,'EXPORT_CSV','WorkoutTree','all',v_now,
    pg_catalog.jsonb_build_object(
      'row_count',p_row_count,'lift_category',p_lift_category,'tier',p_tier
    )::text);
  return pg_catalog.jsonb_build_object('denial',null);
end;
$function$;

revoke all on function al_private.al_day_notes_actor_context(text,text,boolean) from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader;
revoke all on function al_private.al_day_notes_read(text,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_day_notes_upsert(text,text,text,text,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_export_csv_rows(text,text,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_export_json(text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
revoke all on function al_private.al_export_csv_audit(text,text,text[],integer,text,text,boolean) from public,anon,authenticated,al_edge_catalog_reader;
grant execute on function al_private.al_day_notes_read(text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_day_notes_upsert(text,text,text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_export_csv_rows(text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_export_json(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_export_csv_audit(text,text,text[],integer,text,text,boolean) to al_edge_catalog_runtime;

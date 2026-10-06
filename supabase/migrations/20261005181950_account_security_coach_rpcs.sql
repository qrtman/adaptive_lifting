create or replace function al_private.al_coach_code_create(
  p_actor_user_id text, p_session_id text, p_code_hash text, p_invite_id text,
  p_enforce_legacy_email_verification boolean, p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype; v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  select u.* into v_user from public.users u join public.sessions s on s.user_id = u.id
   where u.id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > v_now for update of u;
  if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
  if v_user.role <> 'COACH' then return pg_catalog.jsonb_build_object('denial','only_coaches_create'); end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_user.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  select * into v_workspace from public.workspaces where owner_user_id = p_actor_user_id;
  if not found then return pg_catalog.jsonb_build_object('denial','workspace_access_required'); end if;
  select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=p_actor_user_id;
  if not found or v_member.role <> 'OWNER' then return pg_catalog.jsonb_build_object('denial','workspace_access_required'); end if;
  if p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  if not (
    exists(select 1 from public.access_grants g where g.workspace_id=v_workspace.id
      and g.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
      and g.starts_at<=v_now and (g.expires_at is null or g.expires_at>v_now) and g.revoked_at is null)
    or exists(select 1 from public.subscriptions s where s.workspace_id=v_workspace.id
      and s.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited') and (
        s.status='TRIALING' or (s.status='ACTIVE' and (not s.cancel_at_period_end or (s.current_period_end is not null and v_now<s.current_period_end)))
        or (s.status='CANCELED' and s.current_period_end is not null and v_now<s.current_period_end)
        or (s.status='PAST_DUE' and s.current_period_end is not null and v_now<s.current_period_end+(p_past_due_grace_days*interval '1 day'))
      ))
  ) then return pg_catalog.jsonb_build_object('denial','workspace_access_required'); end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_invite_id is null then
    return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  update public.invite_codes set used_at=v_now where coach_id=p_actor_user_id and used_at is null;
  insert into public.invite_codes(id,coach_id,code_hash,expires_at,used_at)
    values(p_invite_id,p_actor_user_id,p_code_hash,v_now+interval '365 days',null);
  return pg_catalog.jsonb_build_object('denial',null,
    'expiresAt',pg_catalog.to_char(v_now+interval '365 days','YYYY-MM-DD"T"HH24:MI:SS.US'));
end;
$function$;

create or replace function al_private.al_coach_code_status(
  p_actor_user_id text,p_session_id text,p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_code public.invite_codes%rowtype;
  v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now;
  if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
  if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('denial','only_coaches_view'); end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_user.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  select * into v_code from public.invite_codes where coach_id=p_actor_user_id and used_at is null and expires_at>v_now
    order by expires_at desc,id limit 1;
  if not found then return pg_catalog.jsonb_build_object('denial',null,'active',false,'code',null); end if;
  return pg_catalog.jsonb_build_object('denial',null,'active',true,'expires_at',v_code.expires_at,'hint','Rotate to reveal a new code');
end;
$function$;

create or replace function al_private.al_athlete_link(
  p_athlete_id text,p_session_id text,p_code_hash text,p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_athlete public.users%rowtype; v_coach public.users%rowtype; v_invite public.invite_codes%rowtype;
  v_workspace public.workspaces%rowtype; v_member public.workspace_members%rowtype; v_limit integer;
  v_count integer; v_relationship_id integer; v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  select u.* into v_athlete from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_athlete_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now
   for update of u;
  if not found or v_athlete.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
  if v_athlete.role<>'ATHLETE' then return pg_catalog.jsonb_build_object('denial','only_athletes_link'); end if;
  if v_athlete.email_verified_at is null and v_athlete.google_sub is null and (
    case when v_athlete.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_athlete.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  select * into v_invite from public.invite_codes where code_hash=p_code_hash and used_at is null and expires_at>v_now for update;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_invite'); end if;
  select * into v_coach from public.users where id=v_invite.coach_id and role='COACH';
  if not found then return pg_catalog.jsonb_build_object('denial','coach_not_found'); end if;
  if v_coach.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','account_unavailable'); end if;
  if v_coach.email_verified_at is null and v_coach.google_sub is null and (
    case when v_coach.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_coach.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  if exists(select 1 from public.coaching_relationships where athlete_id=p_athlete_id and ended_at is null) then
    return pg_catalog.jsonb_build_object('denial','already_linked'); end if;
  select * into v_workspace from public.workspaces where owner_user_id=v_coach.id for update;
  if not found then return pg_catalog.jsonb_build_object('denial','workspace_access_required'); end if;
  select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=v_coach.id;
  if not found or v_member.role<>'OWNER' then return pg_catalog.jsonb_build_object('denial','workspace_access_required'); end if;
  select case plan_key when 'coach_starter' then 5 when 'coach_beta' then 20 when 'coach_pro' then 25 else null end
    into v_limit from (
      select plan_key, starts_at, source_id, source_type from (
        select g.plan_key,g.starts_at,g.id as source_id,'grant'::text as source_type from public.access_grants g
         where g.workspace_id=v_workspace.id and g.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
           and g.starts_at<=v_now and (g.expires_at is null or g.expires_at>v_now) and g.revoked_at is null
        union all select s.plan_key,coalesce(s.current_period_start,s.created_at),s.id,'subscription'::text from public.subscriptions s
         where s.workspace_id=v_workspace.id and s.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited') and (
           s.status='TRIALING' or (s.status='ACTIVE' and (not s.cancel_at_period_end or (s.current_period_end is not null and v_now<s.current_period_end)))
           or (s.status='CANCELED' and s.current_period_end is not null and v_now<s.current_period_end)
           or (s.status='PAST_DUE' and s.current_period_end is not null and v_now<s.current_period_end+(p_past_due_grace_days*interval '1 day'))
         )
      ) c order by case plan_key when 'coach_starter' then 1 when 'coach_beta' then 2 when 'coach_pro' then 3 else 4 end desc,
        starts_at desc,source_id desc,source_type desc limit 1
    ) ent;
  if not found then return pg_catalog.jsonb_build_object('denial','workspace_access_required'); end if;
  select count(*)::integer into v_count from public.coaching_relationships where coach_id=v_coach.id and ended_at is null;
  if v_limit is not null and v_count>=v_limit then
    return pg_catalog.jsonb_build_object('denial','athlete_limit_reached','activeAthletes',v_count,'maxActiveAthletes',v_limit); end if;
  update public.invite_codes set used_at=v_now where id=v_invite.id and used_at is null and expires_at>v_now;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_invite'); end if;
  insert into public.coaching_relationships(coach_id,athlete_id,created_at,ended_at,updated_at,deleted_at)
    values(v_coach.id,v_athlete.id,v_now,null,v_now,null) returning id into v_relationship_id;
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,v_athlete.id,'ATHLETE_LINKED','CoachingRelationship',v_relationship_id::text,v_now,
      pg_catalog.json_build_object('relationship_id',v_relationship_id,'coach_id',v_coach.id,'athlete_id',v_athlete.id)::text);
  return pg_catalog.jsonb_build_object('denial',null,'status','success','message','Successfully linked to coach '||v_coach.email);
end;
$function$;

create or replace function al_private.al_coaching_unlink(
  p_actor_user_id text,p_session_id text,p_athlete_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_rel public.coaching_relationships%rowtype;
  v_read jsonb; v_cycles jsonb; v_archived jsonb; v_snapshot jsonb; v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
  v_start text; v_end text; v_type text;
begin
  select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now;
  if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_user.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  if v_user.role='ATHLETE' then
    if p_athlete_id is not null then return pg_catalog.jsonb_build_object('denial','coach_unlink_only'); end if;
    v_type := 'ATHLETE_UNLINKED';
    select * into v_rel from public.coaching_relationships where athlete_id=p_actor_user_id and ended_at is null order by id limit 1 for update;
  elsif v_user.role='COACH' then
    if p_athlete_id is null then return pg_catalog.jsonb_build_object('denial','coach_generic_unlink'); end if;
    v_type := 'COACH_UNLINKED_ATHLETE';
    select * into v_rel from public.coaching_relationships where coach_id=p_actor_user_id and athlete_id=p_athlete_id and ended_at is null order by id limit 1 for update;
  else
    return pg_catalog.jsonb_build_object('denial',case when p_athlete_id is null then 'not_authorized' else 'coach_unlink_only' end);
  end if;
  if not found then return pg_catalog.jsonb_build_object('denial','no_active_link'); end if;

  v_start := pg_catalog.to_char(coalesce(v_rel.created_at,v_now),'YYYY-MM-DD');
  v_end := pg_catalog.to_char(v_now,'YYYY-MM-DD');
  v_read := al_private.al_microcycles_read(p_actor_user_id,p_session_id,v_rel.athlete_id,p_enforce_legacy_email_verification);
  if v_read->>'denial' is not null then return v_read; end if;
  select coalesce(pg_catalog.jsonb_agg(
      (mc.value - 'workouts') || pg_catalog.jsonb_build_object('workouts', filtered.workouts)
      order by mc.value->>'id'), '[]'::jsonb)
    into v_archived
    from pg_catalog.jsonb_array_elements(coalesce(v_read->'microcycles','[]'::jsonb)) mc(value)
    cross join lateral (
      select coalesce(pg_catalog.jsonb_agg(w.value order by w.value->>'date',w.value->>'id'),'[]'::jsonb) as workouts
      from pg_catalog.jsonb_array_elements(coalesce(mc.value->'workouts','[]'::jsonb)) w(value)
      where w.value->>'date' between v_start and v_end
    ) filtered
    where pg_catalog.jsonb_array_length(filtered.workouts)>0;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id',u.id,'email',u.email,'displayName',u.display_name)
  ),'[]'::jsonb) into v_cycles from public.users u where u.id=v_rel.athlete_id;
  v_snapshot := pg_catalog.jsonb_build_object('relationshipId',v_rel.id,'fromDate',v_start,'throughDate',v_end,
    'athlete',coalesce(v_cycles->0,pg_catalog.jsonb_build_object('id',v_rel.athlete_id,'email','','displayName',null)),
    'microcycles',coalesce(v_archived,'[]'::jsonb));

  update public.coaching_relationships set ended_at=v_now,updated_at=v_now where id=v_rel.id and ended_at is null;
  if not found then return pg_catalog.jsonb_build_object('denial','no_active_link'); end if;
  insert into public.coaching_history_snapshots(relationship_id,snapshot_at,snapshot_json)
    values(v_rel.id,v_now,v_snapshot::text);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,p_actor_user_id,v_type,'CoachingRelationship',v_rel.id::text,v_now,
      pg_catalog.json_build_object('relationship_id',v_rel.id,'coach_id',v_rel.coach_id,'athlete_id',v_rel.athlete_id)::text);
  return pg_catalog.jsonb_build_object('denial',null,'status','success','message','Unlinked. Athlete plan remains in athlete space.');
end;
$function$;

create or replace function al_private.al_coach_roster(
 p_actor_user_id text,p_session_id text,p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_rows jsonb;
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null
    and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('denial','not_authorized'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
   case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
     else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',athlete.id,'email',athlete.email,'displayName',athlete.display_name,'activeMicrocycles',
   (select pg_catalog.count(*)::integer from public.microcycles mc where mc.owner_id=athlete.id and mc.active is true)
 ) order by athlete.id),'[]'::jsonb) into v_rows
 from public.coaching_relationships cr join public.users athlete on athlete.id=cr.athlete_id
 where cr.coach_id=p_actor_user_id and cr.ended_at is null and cr.deleted_at is null and athlete.deleted_at is null;
 return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_coach_history(
 p_actor_user_id text,p_session_id text,p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_rows jsonb;
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null
    and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('denial','not_authorized'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
   case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
     else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 select coalesce(pg_catalog.jsonb_agg(row_json order by ended_at desc),'[]'::jsonb) into v_rows from (
   select cr.ended_at,pg_catalog.jsonb_build_object('relationshipId',cr.id,'athleteId',cr.athlete_id,
     'email',coalesce(snapshot->'athlete'->>'email',athlete.email,''),
     'displayName',case when snapshot is null then athlete.display_name else snapshot->'athlete'->'displayName' end,
     'linkedAt',cr.created_at,'endedAt',cr.ended_at,'archiveAvailable',snapshot is not null) as row_json
   from public.coaching_relationships cr
   left join public.coaching_history_snapshots hs on hs.relationship_id=cr.id
   left join lateral (select hs.snapshot_json::jsonb as payload) snap on true
   left join public.users athlete on athlete.id=cr.athlete_id
   cross join lateral (select snap.payload as snapshot) history
   where cr.coach_id=p_actor_user_id and cr.ended_at is not null
 ) history_rows;
 return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_coach_history_snapshot(
 p_actor_user_id text,p_session_id text,p_relationship_id integer,
 p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_payload jsonb;
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null
    and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('denial','not_authorized'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
   case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
     else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 select hs.snapshot_json::jsonb into v_payload from public.coaching_relationships cr
  join public.coaching_history_snapshots hs on hs.relationship_id=cr.id
  where cr.id=p_relationship_id and cr.coach_id=p_actor_user_id and cr.ended_at is not null;
 if not found then
   if exists(select 1 from public.coaching_relationships cr where cr.id=p_relationship_id
      and cr.coach_id=p_actor_user_id and cr.ended_at is not null) then
     return pg_catalog.jsonb_build_object('denial','history_unavailable');
   end if;
   return pg_catalog.jsonb_build_object('denial','history_not_found');
 end if;
 return pg_catalog.jsonb_build_object('denial',null,'snapshot',v_payload);
end;
$function$;

create or replace function al_private.al_coach_push_program(
 p_actor_user_id text,p_session_id text,p_athlete_id text,
 p_enforce_legacy_email_verification boolean,p_past_due_grace_days integer
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype; v_active boolean;
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null
   and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.role<>'COACH' then return pg_catalog.jsonb_build_object('denial','not_authorized'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
   case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
     else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 if not exists(select 1 from public.coaching_relationships cr where cr.coach_id=p_actor_user_id
   and cr.athlete_id=p_athlete_id and cr.ended_at is null and cr.deleted_at is null) then
   return pg_catalog.jsonb_build_object('denial','push_forbidden'); end if;
 select * into v_workspace from public.workspaces where owner_user_id=p_actor_user_id;
 if not found then return pg_catalog.jsonb_build_object('denial','programming_required'); end if;
 select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=p_actor_user_id;
 if not found or v_member.role<>'OWNER' then return pg_catalog.jsonb_build_object('denial','programming_required'); end if;
 select exists(
   select 1 from public.access_grants g where g.workspace_id=v_workspace.id
    and g.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited') and g.starts_at<=pg_catalog.timezone('utc',pg_catalog.now())
    and (g.expires_at is null or g.expires_at>pg_catalog.timezone('utc',pg_catalog.now())) and g.revoked_at is null
   union all
   select 1 from public.subscriptions s where s.workspace_id=v_workspace.id
    and s.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited') and (
      s.status='TRIALING' or (s.status='ACTIVE' and (not s.cancel_at_period_end or (s.current_period_end is not null and pg_catalog.timezone('utc',pg_catalog.now())<s.current_period_end)))
      or (s.status='CANCELED' and s.current_period_end is not null and pg_catalog.timezone('utc',pg_catalog.now())<s.current_period_end)
      or (s.status='PAST_DUE' and s.current_period_end is not null and pg_catalog.timezone('utc',pg_catalog.now())<s.current_period_end+(greatest(coalesce(p_past_due_grace_days,3),0)*interval '1 day'))
    )
 ) into v_active;
 if not v_active then return pg_catalog.jsonb_build_object('denial','programming_required'); end if;
 return pg_catalog.jsonb_build_object('denial',null,'status','success');
end;
$function$;

create or replace function al_private.al_security_devices(
 p_actor_user_id text,p_session_id text,p_revoke_device_id text,p_default_device_id text,
 p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_device public.client_devices%rowtype; v_rows jsonb;
 v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now
  for update of u;
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
  case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
    else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 if p_revoke_device_id is not null then
   select * into v_device from public.client_devices where id=p_revoke_device_id and user_id=p_actor_user_id for update;
   if not found then return pg_catalog.jsonb_build_object('denial','device_not_found'); end if;
   update public.client_devices set revoked_at=v_now where id=p_revoke_device_id;
   return pg_catalog.jsonb_build_object('denial',null,'status','success');
 end if;
 if not exists(select 1 from public.client_devices where user_id=p_actor_user_id) then
   insert into public.client_devices(id,user_id,device_label,last_seen_at,revoked_at)
     values(coalesce(p_default_device_id,'dev-default-'||pg_catalog.left(extensions.gen_random_uuid()::text,8)),
       p_actor_user_id,'Primary Mobile PWA Terminal',v_now,null);
 end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',d.id,
   'device_label',coalesce(d.device_label,'PWA Web App'),'last_seen_at',d.last_seen_at,'revoked_at',d.revoked_at)
   order by d.id),'[]'::jsonb) into v_rows from public.client_devices d where d.user_id=p_actor_user_id;
 return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_security_sessions(
 p_actor_user_id text,p_session_id text,p_revoke_session_id text,
 p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_session public.sessions%rowtype; v_rows jsonb;
 v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now;
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
  case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
    else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 if p_revoke_session_id is not null then
   select * into v_session from public.sessions where id=p_revoke_session_id and user_id=p_actor_user_id for update;
   if not found then return pg_catalog.jsonb_build_object('denial','security_session_not_found'); end if;
   update public.sessions set revoked_at=v_now where id=p_revoke_session_id and user_id=p_actor_user_id;
   return pg_catalog.jsonb_build_object('denial',null,'status','success');
 end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'expires_at',s.expires_at,'revoked_at',s.revoked_at)
   order by s.expires_at desc),'[]'::jsonb) into v_rows from public.sessions s where s.user_id=p_actor_user_id;
 return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_security_audit_events(
 p_actor_user_id text,p_session_id text,p_enforce_legacy_email_verification boolean
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_rows jsonb;
begin
 select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
  where u.id=p_actor_user_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null
    and s.expires_at>pg_catalog.timezone('utc',pg_catalog.now());
 if not found or v_user.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
 if v_user.email_verified_at is null and v_user.google_sub is null and (
  case when v_user.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
    else coalesce(v_user.email_verification_required,true) end
 ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
 if v_user.role='COACH' then
   select coalesce(pg_catalog.jsonb_agg(event_json order by created_at desc),'[]'::jsonb) into v_rows from (
     select distinct on (e.id) e.id,e.created_at,pg_catalog.jsonb_build_object('id',e.id,
       'actor_email',coalesce(actor.email,'system'),'event_type',e.event_type,'resource_type',e.resource_type,
       'resource_id',e.resource_id,'created_at',e.created_at,'metadata_json',e.metadata_json) as event_json
     from public.audit_events e left join public.users actor on actor.id=e.actor_user_id
     where e.actor_user_id=p_actor_user_id or (e.resource_type='CoachingRelationship'
       and e.event_type in ('ATHLETE_LINKED','ATHLETE_UNLINKED','COACH_UNLINKED_ATHLETE')
       and exists(select 1 from public.coaching_relationships cr where cr.coach_id=p_actor_user_id and cr.id::text=e.resource_id))
     order by e.id,e.created_at desc
   ) ev order by created_at desc limit 100;
 else
   select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id,
     'actor_email',coalesce(actor.email,'system'),'event_type',e.event_type,'resource_type',e.resource_type,
     'resource_id',e.resource_id,'created_at',e.created_at,'metadata_json',e.metadata_json)
     order by e.created_at desc),'[]'::jsonb) into v_rows
   from (select * from public.audit_events where actor_user_id=p_actor_user_id order by created_at desc limit 100) e
   left join public.users actor on actor.id=e.actor_user_id;
 end if;
 return pg_catalog.jsonb_build_object('denial',null,'rows',v_rows);
end;
$function$;

create or replace function al_private.al_account_access_state(
  p_actor_user_id text, p_session_id text,
  p_enforce_legacy_email_verification boolean, p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype;
  v_selected record;
  v_stripe public.subscriptions%rowtype;
  v_latest public.subscriptions%rowtype;
  v_active_count integer;
  v_plan jsonb;
  v_grant jsonb := null;
  v_source jsonb := null;
  v_billing jsonb := null;
  v_entitlements jsonb;
  v_can_checkout boolean;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;
  select u.* into v_user from public.users u join public.sessions s on s.user_id = u.id
   where u.id = p_actor_user_id and s.id = p_session_id and s.jwt_id = p_session_id
     and s.revoked_at is null and s.expires_at > v_now
   for update of u;
  if not found or v_user.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_user.email_verified_at is null and v_user.google_sub is null and (
    case when v_user.email_verification_legacy_exempt
      then coalesce(p_enforce_legacy_email_verification, false)
      else coalesce(v_user.email_verification_required, true)
    end
  ) then return pg_catalog.jsonb_build_object('denial', 'account_ineligible'); end if;
  if v_user.role <> 'COACH' then
    return pg_catalog.jsonb_build_object('denial', null, 'workspace', null,
      'membershipRole', null, 'entitlements', null, 'grant', null,
      'accessSource', null, 'usage', null);
  end if;

  select * into v_workspace from public.workspaces where owner_user_id = p_actor_user_id for update;
  if not found then
    insert into public.workspaces(id, name, owner_user_id, created_at, updated_at)
    values (extensions.gen_random_uuid()::text,
      coalesce(nullif(pg_catalog.btrim(v_user.display_name), ''), pg_catalog.split_part(v_user.email, '@', 1)) || ' Coaching',
      p_actor_user_id, v_now, v_now)
    on conflict (owner_user_id) do nothing;
    select * into v_workspace from public.workspaces where owner_user_id = p_actor_user_id for update;
    if not found then raise exception 'workspace initialization failed'; end if;
    insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'WORKSPACE_CREATED', 'Workspace', v_workspace.id,
      v_now, pg_catalog.json_build_object('owner_user_id', p_actor_user_id)::text);
  end if;
  select * into v_member from public.workspace_members
   where workspace_id = v_workspace.id and user_id = p_actor_user_id for update;
  if not found then
    insert into public.workspace_members(id, workspace_id, user_id, role, created_at)
    values (extensions.gen_random_uuid()::text, v_workspace.id, p_actor_user_id, 'OWNER', v_now);
    v_member.role := 'OWNER';
    insert into public.audit_events(id, actor_user_id, event_type, resource_type, resource_id, created_at, metadata_json)
    values (extensions.gen_random_uuid()::text, null, 'WORKSPACE_MEMBER_ADDED', 'Workspace', v_workspace.id,
      v_now, pg_catalog.json_build_object('user_id', p_actor_user_id, 'role', 'OWNER')::text);
  elsif v_member.role <> 'OWNER' then
    update public.workspace_members set role = 'OWNER'
     where workspace_id = v_workspace.id and user_id = p_actor_user_id;
    v_member.role := 'OWNER';
  end if;

  select count(*)::integer into v_active_count from public.coaching_relationships
   where coach_id = p_actor_user_id and ended_at is null;

  with candidates as (
    select g.plan_key, 'grant'::text as source_type, g.id as source_id,
      'ACTIVE'::text as source_status, g.starts_at,
      g.expires_at as period_end, null::boolean as cancel_at_period_end
    from public.access_grants g
    where g.workspace_id = v_workspace.id and g.starts_at <= v_now
      and (g.expires_at is null or g.expires_at > v_now) and g.revoked_at is null
      and g.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
    union all
    select s.plan_key, 'subscription'::text, s.id, s.status,
      coalesce(s.current_period_start, s.created_at), s.current_period_end, s.cancel_at_period_end
    from public.subscriptions s
    where s.workspace_id = v_workspace.id
      and s.plan_key in ('coach_beta','coach_starter','coach_pro','coach_unlimited')
      and (
        s.status = 'TRIALING'
        or (s.status = 'ACTIVE' and (not s.cancel_at_period_end or (s.current_period_end is not null and v_now < s.current_period_end)))
        or (s.status = 'CANCELED' and s.current_period_end is not null and v_now < s.current_period_end)
        or (s.status = 'PAST_DUE' and s.current_period_end is not null and v_now < s.current_period_end + (p_past_due_grace_days * interval '1 day'))
      )
  )
  select c.* into v_selected from candidates c order by
    case c.plan_key when 'coach_starter' then 1 when 'coach_beta' then 2 when 'coach_pro' then 3 when 'coach_unlimited' then 4 else 0 end desc,
    c.starts_at desc, c.source_id desc, c.source_type desc limit 1;

  if found then
    v_plan := case v_selected.plan_key
      when 'coach_starter' then pg_catalog.jsonb_build_object('maxActiveAthletes',5,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',false)
      when 'coach_beta' then pg_catalog.jsonb_build_object('maxActiveAthletes',20,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',true)
      when 'coach_pro' then pg_catalog.jsonb_build_object('maxActiveAthletes',25,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',true)
      when 'coach_unlimited' then pg_catalog.jsonb_build_object('maxActiveAthletes',null,'canProgram',true,'canUseAnalytics',true,'canUseIntegrations',true)
    end;
    v_entitlements := pg_catalog.jsonb_build_object('active',true,'planKey',v_selected.plan_key) || v_plan;
    if v_selected.source_type = 'grant' then
      select pg_catalog.jsonb_build_object('source',g.source,'startsAt',g.starts_at,
        'expiresAt',g.expires_at) into v_grant
      from public.access_grants g where g.id = v_selected.source_id and g.workspace_id = v_workspace.id;
      v_source := pg_catalog.jsonb_build_object('type','grant','status','ACTIVE','expiresAt',v_selected.period_end);
    else
      v_source := pg_catalog.jsonb_build_object('type','subscription','status',v_selected.source_status,
        'currentPeriodEnd',v_selected.period_end,'cancelAtPeriodEnd',coalesce(v_selected.cancel_at_period_end,false));
    end if;
  else
    v_entitlements := pg_catalog.jsonb_build_object('active',false,'planKey',null,
      'maxActiveAthletes',0,'canProgram',false,'canUseAnalytics',false,'canUseIntegrations',false);
  end if;

  if v_selected.source_type is distinct from 'subscription' and v_selected.source_type is not null then
    select * into v_stripe from public.subscriptions where id = v_selected.source_id and workspace_id = v_workspace.id;
  elsif v_selected.source_type is null then
    select * into v_latest from public.subscriptions where workspace_id = v_workspace.id
      order by updated_at desc, id limit 1;
    if found then
      v_source := pg_catalog.jsonb_build_object('type','subscription','status',v_latest.status,
        'currentPeriodEnd',v_latest.current_period_end,'cancelAtPeriodEnd',coalesce(v_latest.cancel_at_period_end,false));
    end if;
  end if;
  select * into v_stripe from public.subscriptions where workspace_id = v_workspace.id and provider = 'stripe'
    order by updated_at desc, id limit 1;
  if found then
    v_billing := pg_catalog.jsonb_build_object('planKey',v_stripe.plan_key,'status',v_stripe.status,
      'currentPeriodEnd',v_stripe.current_period_end,'cancelAtPeriodEnd',v_stripe.cancel_at_period_end);
  end if;
  select not exists(select 1 from public.subscriptions s where s.workspace_id = v_workspace.id and s.provider = 'stripe'
    and s.status <> 'EXPIRED' and not (s.status = 'CANCELED' and s.current_period_end is not null and s.current_period_end <= v_now))
    into v_can_checkout;

  return pg_catalog.jsonb_build_object('denial',null,
    'workspace',pg_catalog.jsonb_build_object('id',v_workspace.id,'name',v_workspace.name),
    'membershipRole',v_member.role,'entitlements',v_entitlements,'grant',v_grant,
    'accessSource',v_source,'billingSubscription',v_billing,'canStartCheckout',v_can_checkout,
    'usage',pg_catalog.jsonb_build_object('activeAthletes',v_active_count,
      'maxActiveAthletes',coalesce(v_entitlements->'maxActiveAthletes','null'::jsonb)));
end;
$function$;

revoke all on function al_private.al_coach_code_create(text,text,text,text,boolean,integer) from public, anon, authenticated;
revoke all on function al_private.al_coach_code_status(text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_athlete_link(text,text,text,boolean,integer) from public, anon, authenticated;
revoke all on function al_private.al_coaching_unlink(text,text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_coach_roster(text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_coach_history(text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_coach_history_snapshot(text,text,integer,boolean) from public, anon, authenticated;
revoke all on function al_private.al_coach_push_program(text,text,text,boolean,integer) from public, anon, authenticated;
revoke all on function al_private.al_security_devices(text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_security_sessions(text,text,text,boolean) from public, anon, authenticated;
revoke all on function al_private.al_security_audit_events(text,text,boolean) from public, anon, authenticated;
grant execute on function al_private.al_coach_code_create(text,text,text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_coach_code_status(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_athlete_link(text,text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_coaching_unlink(text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_coach_roster(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_coach_history(text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_coach_history_snapshot(text,text,integer,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_coach_push_program(text,text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_security_devices(text,text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_security_sessions(text,text,text,boolean) to al_edge_catalog_runtime;
grant execute on function al_private.al_security_audit_events(text,text,boolean) to al_edge_catalog_runtime;


\n
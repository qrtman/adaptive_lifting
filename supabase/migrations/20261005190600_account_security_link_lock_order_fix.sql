create or replace function al_private.al_athlete_link(
 p_athlete_id text,p_session_id text,p_code_hash text,p_enforce_legacy_email_verification boolean,
 p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_athlete public.users%rowtype; v_coach public.users%rowtype; v_invite public.invite_codes%rowtype;
  v_invite_id text; v_workspace public.workspaces%rowtype; v_member public.workspace_members%rowtype; v_limit integer;
  v_count integer; v_relationship_id integer; v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
begin
  select * into v_athlete from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_athlete_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now
   for update of u;
  if not found or v_athlete.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;
  if v_athlete.role<>'ATHLETE' then return pg_catalog.jsonb_build_object('denial','only_athletes_link'); end if;
  if v_athlete.email_verified_at is null and v_athlete.google_sub is null and (
    case when v_athlete.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_athlete.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;

  -- Peek without locking, then lock coach before invite to match code rotation's
  -- user -> invite order and avoid a link/rotation FK deadlock.
  select * into v_invite from public.invite_codes
   where code_hash=p_code_hash and used_at is null and expires_at>v_now;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_invite'); end if;
  v_invite_id := v_invite.id;
  select * into v_coach from public.users where id=v_invite.coach_id and role='COACH' for update;
  if not found then return pg_catalog.jsonb_build_object('denial','coach_not_found'); end if;
  if v_coach.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','account_unavailable'); end if;
  if v_coach.email_verified_at is null and v_coach.google_sub is null and (
    case when v_coach.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_coach.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  select * into v_invite from public.invite_codes
   where id=v_invite_id and code_hash=p_code_hash and used_at is null and expires_at>v_now for update;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_invite'); end if;

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

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
     select e.created_at,pg_catalog.jsonb_build_object('id',e.id,
       'actor_email',coalesce(actor.email,'system'),'event_type',e.event_type,'resource_type',e.resource_type,
       'resource_id',e.resource_id,'created_at',e.created_at,'metadata_json',e.metadata_json) as event_json
     from public.audit_events e left join public.users actor on actor.id=e.actor_user_id
     where e.actor_user_id=p_actor_user_id or (e.resource_type='CoachingRelationship'
       and e.event_type in ('ATHLETE_LINKED','ATHLETE_UNLINKED','COACH_UNLINKED_ATHLETE')
       and exists(select 1 from public.coaching_relationships cr where cr.coach_id=p_actor_user_id and cr.id::text=e.resource_id))
     order by e.created_at desc limit 100
   ) ev;
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

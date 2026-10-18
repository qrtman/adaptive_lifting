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
     'displayName',case when snapshot is null then to_jsonb(athlete.display_name) else snapshot->'athlete'->'displayName' end,
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

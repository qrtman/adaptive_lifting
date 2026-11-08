-- Coach code hardening (architecture.md 9.3, 9.5).
-- * New codes are 10 characters from an unambiguous 32-symbol alphabet
--   (~50 bits), keyed with an HMAC whose key never leaves the database, expire
--   after 15 minutes and stay single-use.
-- * Link attempts are rate limited per account and per client IP before any
--   code-dependent work, and every code-dependent failure returns one generic
--   denial so responses do not reveal whether a code exists.
-- * The link success payload no longer includes the coach's email.
-- Legacy 6-hex SHA-256 codes remain redeemable until their stored expiry.

do $block$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='adaptive_lifting_coach_code_hmac_key') then
    perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32),'hex'), 'adaptive_lifting_coach_code_hmac_key');
  end if;
end;
$block$;

create or replace function al_private.al_coach_code_hmac(p_code text)
returns text language plpgsql stable security definer set search_path = ''
as $function$
declare v_key text; v_count integer;
begin
  if p_code is null or p_code !~ '^[A-HJ-NP-Z2-9]{10}$' then return null; end if;
  select pg_catalog.count(*)::integer, min(d.decrypted_secret) into v_count, v_key
    from vault.decrypted_secrets d where d.name='adaptive_lifting_coach_code_hmac_key';
  if v_count<>1 or pg_catalog.length(pg_catalog.btrim(coalesce(v_key,'')))<32 then return null; end if;
  return pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('coach-code:v2:'||p_code,'UTF8'),
    pg_catalog.convert_to(v_key,'UTF8'),'sha256'),'hex');
end;
$function$;

create or replace function al_private.al_coach_code_issue(
  p_actor_user_id text, p_session_id text, p_code text, p_invite_id text,
  p_enforce_legacy_email_verification boolean, p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_user public.users%rowtype; v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype; v_code_hash text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
  v_expires timestamp without time zone;
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
  if p_code is null or p_code !~ '^[A-HJ-NP-Z2-9]{10}$' or p_invite_id is null or p_invite_id = '' then
    return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  v_code_hash := al_private.al_coach_code_hmac(p_code);
  if v_code_hash is null then return pg_catalog.jsonb_build_object('denial','coach_code_unavailable'); end if;
  v_expires := v_now + interval '15 minutes';
  -- Rotation retires every outstanding code, including legacy ones.
  update public.invite_codes set used_at=v_now where coach_id=p_actor_user_id and used_at is null;
  insert into public.invite_codes(id,coach_id,code_hash,expires_at,used_at)
    values(p_invite_id,p_actor_user_id,v_code_hash,v_expires,null);
  return pg_catalog.jsonb_build_object('denial',null,
    'expiresAt',pg_catalog.to_char(v_expires,'YYYY-MM-DD"T"HH24:MI:SS.US'));
end;
$function$;

create or replace function al_private.al_athlete_link_code(
 p_athlete_id text,p_session_id text,p_code text,p_ip_subject_hash text,
 p_enforce_legacy_email_verification boolean,p_past_due_grace_days integer
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_athlete public.users%rowtype; v_coach public.users%rowtype; v_invite public.invite_codes%rowtype;
  v_invite_id text; v_workspace public.workspaces%rowtype; v_member public.workspace_members%rowtype; v_limit integer;
  v_count integer; v_relationship_id integer; v_now timestamp without time zone := pg_catalog.timezone('utc',pg_catalog.clock_timestamp());
  v_code text; v_code_hash text;
  v_user_minute boolean; v_user_hour boolean; v_ip_minute boolean; v_ip_hour boolean;
begin
  if p_ip_subject_hash is null or p_ip_subject_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;
  select * into v_athlete from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_athlete_id and s.id=p_session_id and s.jwt_id=p_session_id and s.revoked_at is null and s.expires_at>v_now
   for update of u;
  if not found or v_athlete.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_session'); end if;

  -- Every attempt counts against both the account and the client IP, before any
  -- code-dependent work. Each window has its own subject because the helper
  -- prunes events older than its window. Limited and invalid share one denial.
  v_user_minute := al_private.al_email_rate_allow(pg_catalog.encode(extensions.digest('coach-link:user:minute:'||v_athlete.id,'sha256'),'hex'),5,60);
  v_user_hour := al_private.al_email_rate_allow(pg_catalog.encode(extensions.digest('coach-link:user:hour:'||v_athlete.id,'sha256'),'hex'),20,3600);
  v_ip_minute := al_private.al_email_rate_allow(pg_catalog.encode(extensions.digest('coach-link:ip:minute:'||p_ip_subject_hash,'sha256'),'hex'),5,60);
  v_ip_hour := al_private.al_email_rate_allow(pg_catalog.encode(extensions.digest('coach-link:ip:hour:'||p_ip_subject_hash,'sha256'),'hex'),20,3600);
  if not (v_user_minute and v_user_hour and v_ip_minute and v_ip_hour) then
    return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;

  -- Athlete state is checked before the code is looked up so these answers do
  -- not depend on whether the submitted code exists.
  if v_athlete.role<>'ATHLETE' then return pg_catalog.jsonb_build_object('denial','only_athletes_link'); end if;
  if v_athlete.email_verified_at is null and v_athlete.google_sub is null and (
    case when v_athlete.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_athlete.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','account_ineligible'); end if;
  if exists(select 1 from public.coaching_relationships where athlete_id=p_athlete_id and ended_at is null) then
    return pg_catalog.jsonb_build_object('denial','already_linked'); end if;
  if p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial','invalid_request'); end if;

  v_code := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code,''),'[[:space:]-]','','g'));
  if v_code ~ '^[A-HJ-NP-Z2-9]{10}$' then
    v_code_hash := al_private.al_coach_code_hmac(v_code);
    if v_code_hash is null then return pg_catalog.jsonb_build_object('denial','coach_code_unavailable'); end if;
  elsif v_code ~ '^[0-9A-F]{6}$' then
    -- Legacy codes (unsalted SHA-256 of the uppercase hex) until they expire.
    v_code_hash := pg_catalog.encode(extensions.digest(v_code,'sha256'),'hex');
  else
    return pg_catalog.jsonb_build_object('denial','invalid_code');
  end if;

  -- Peek without locking, then lock coach before invite to match code rotation's
  -- user -> invite order and avoid a link/rotation FK deadlock.
  select * into v_invite from public.invite_codes
   where code_hash=v_code_hash and used_at is null and expires_at>v_now;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  v_invite_id := v_invite.id;
  select * into v_coach from public.users where id=v_invite.coach_id and role='COACH' for update;
  if not found or v_coach.deleted_at is not null then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  if v_coach.email_verified_at is null and v_coach.google_sub is null and (
    case when v_coach.email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification,false)
      else coalesce(v_coach.email_verification_required,true) end
  ) then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  select * into v_invite from public.invite_codes
   where id=v_invite_id and code_hash=v_code_hash and used_at is null and expires_at>v_now for update;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;

  select * into v_workspace from public.workspaces where owner_user_id=v_coach.id for update;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=v_coach.id;
  if not found or v_member.role<>'OWNER' then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
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
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  select count(*)::integer into v_count from public.coaching_relationships where coach_id=v_coach.id and ended_at is null;
  if v_limit is not null and v_count>=v_limit then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  update public.invite_codes set used_at=v_now where id=v_invite.id and used_at is null and expires_at>v_now;
  if not found then return pg_catalog.jsonb_build_object('denial','invalid_code'); end if;
  insert into public.coaching_relationships(coach_id,athlete_id,created_at,ended_at,updated_at,deleted_at)
    values(v_coach.id,v_athlete.id,v_now,null,v_now,null) returning id into v_relationship_id;
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,v_athlete.id,'ATHLETE_LINKED','CoachingRelationship',v_relationship_id::text,v_now,
      pg_catalog.json_build_object('relationship_id',v_relationship_id,'coach_id',v_coach.id,'athlete_id',v_athlete.id)::text);
  return pg_catalog.jsonb_build_object('denial',null,'status','success','message','Linked to your coach.');
end;
$function$;

revoke all on function al_private.al_coach_code_hmac(text)
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;
revoke all on function al_private.al_coach_code_issue(text,text,text,text,boolean,integer)
  from public, anon, authenticated, al_edge_catalog_reader;
revoke all on function al_private.al_athlete_link_code(text,text,text,text,boolean,integer)
  from public, anon, authenticated, al_edge_catalog_reader;
grant execute on function al_private.al_coach_code_issue(text,text,text,text,boolean,integer) to al_edge_catalog_runtime;
grant execute on function al_private.al_athlete_link_code(text,text,text,text,boolean,integer) to al_edge_catalog_runtime;

-- The previous entry points issued 365-day 6-hex codes and linked without
-- rate limits. The Edge runtime no longer calls them; remove its access.
revoke execute on function al_private.al_coach_code_create(text,text,text,text,boolean,integer) from al_edge_catalog_runtime;
revoke execute on function al_private.al_athlete_link(text,text,text,boolean,integer) from al_edge_catalog_runtime;

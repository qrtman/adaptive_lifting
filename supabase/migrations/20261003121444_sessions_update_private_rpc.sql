-- Narrow transactional interface for PATCH /api/sessions/{id}.
-- Edge validates the application JWT; this function repeats session,
-- eligibility, plan ownership, active relationship, and coach entitlement checks.

create or replace function al_private.al_session_update(
  p_actor_user_id text,
  p_session_id text,
  p_workout_id text,
  p_date text,
  p_title text,
  p_day_label text,
  p_block_label text,
  p_week_label text,
  p_status text,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_actor_role text;
  v_google_sub text;
  v_email_verified_at timestamp without time zone;
  v_email_verification_required boolean;
  v_email_verification_legacy_exempt boolean;
  v_deleted_at timestamp without time zone;
  v_owner_id text;
  v_workspace_id text;
  v_plan_key text;
  v_can_program boolean;
  v_date date;
  v_date_text text;
  v_status_color text;
  v_workout public.workouts%rowtype;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_session_id is null or p_session_id = '' or pg_catalog.length(p_session_id) > 255
     or p_workout_id is null or p_workout_id = '' or pg_catalog.length(p_workout_id) > 255
     or p_past_due_grace_days is null or p_past_due_grace_days < 0 or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  select u.role, u.google_sub, u.email_verified_at,
         u.email_verification_required, u.email_verification_legacy_exempt,
         u.deleted_at
    into v_actor_role, v_google_sub, v_email_verified_at,
         v_email_verification_required, v_email_verification_legacy_exempt,
         v_deleted_at
  from public.users as u
  join public.sessions as s on s.user_id = u.id
  where u.id = p_actor_user_id
    and s.id = p_session_id
    and s.jwt_id = p_session_id
    and s.revoked_at is null
    and s.expires_at > v_now
  for share of u, s;

  if not found then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  if v_deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'account_ineligible');
  end if;
  if v_email_verified_at is null and v_google_sub is null and (
     case
       when v_email_verification_legacy_exempt then coalesce(p_enforce_legacy_email_verification, false)
       else coalesce(v_email_verification_required, true)
     end
  ) then
    return pg_catalog.jsonb_build_object('denial', 'account_ineligible');
  end if;

  select w.* into v_workout
    from public.workouts as w
   where w.id = p_workout_id
   for update;
  if not found or v_workout.deleted_at is not null then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;

  v_owner_id := v_workout.owner_id;
  if v_owner_id is null and v_workout.microcycle_id is not null then
    select mc.owner_id into v_owner_id
      from public.microcycles as mc
     where mc.id = v_workout.microcycle_id
     for share;
  end if;
  if v_owner_id is null then
    return pg_catalog.jsonb_build_object('denial', 'session_has_no_owner');
  end if;

  if v_actor_role = 'ATHLETE' then
    if v_owner_id <> p_actor_user_id then
      return pg_catalog.jsonb_build_object('denial', 'athlete_forbidden');
    end if;
  elsif v_actor_role = 'COACH' then
    perform 1
      from public.coaching_relationships as cr
     where cr.coach_id = p_actor_user_id
       and cr.athlete_id = v_owner_id
       and cr.ended_at is null
     for share;
    if not found then
      return pg_catalog.jsonb_build_object('denial', 'coach_relationship_required');
    end if;

    select w.id into v_workspace_id
      from public.workspaces as w
      join public.workspace_members as wm
        on wm.workspace_id = w.id
       and wm.user_id = p_actor_user_id
       and wm.role = 'OWNER'
     where w.owner_user_id = p_actor_user_id
     for share of w, wm;
    if v_workspace_id is null then
      return pg_catalog.jsonb_build_object('denial', 'workspace_access_required');
    end if;

    perform 1 from public.access_grants as ag
      where ag.workspace_id = v_workspace_id for share;
    perform 1 from public.subscriptions as sub
      where sub.workspace_id = v_workspace_id for share;

    with candidates as (
      select ag.plan_key, ag.starts_at as starts_at, ag.id as source_id,
             'grant'::text as source_type
        from public.access_grants as ag
       where ag.workspace_id = v_workspace_id
         and ag.plan_key in ('coach_beta', 'coach_starter', 'coach_pro', 'coach_unlimited')
         and ag.starts_at <= v_now
         and (ag.expires_at is null or ag.expires_at > v_now)
         and ag.revoked_at is null
      union all
      select sub.plan_key,
             coalesce(sub.current_period_start, sub.created_at) as starts_at,
             sub.id as source_id,
             'subscription'::text as source_type
        from public.subscriptions as sub
       where sub.workspace_id = v_workspace_id
         and sub.plan_key in ('coach_beta', 'coach_starter', 'coach_pro', 'coach_unlimited')
         and (
           sub.status = 'TRIALING'
           or (sub.status = 'ACTIVE' and
             (not sub.cancel_at_period_end or sub.current_period_end > v_now))
           or (sub.status = 'CANCELED' and sub.current_period_end > v_now)
           or (sub.status = 'PAST_DUE' and sub.current_period_end is not null
             and v_now < sub.current_period_end + pg_catalog.make_interval(days => p_past_due_grace_days))
         )
    )
    select c.plan_key into v_plan_key
      from candidates as c
     order by case c.plan_key
                when 'coach_starter' then 1
                when 'coach_beta' then 2
                when 'coach_pro' then 3
                when 'coach_unlimited' then 4
              end desc,
              c.starts_at desc,
              c.source_id desc,
              c.source_type desc
     limit 1;

    if v_plan_key is null then
      return pg_catalog.jsonb_build_object('denial', 'workspace_access_required');
    end if;
    v_can_program := case v_plan_key
      when 'coach_beta' then true
      when 'coach_starter' then true
      when 'coach_pro' then true
      when 'coach_unlimited' then true
      else false
    end;
    if not v_can_program then
      return pg_catalog.jsonb_build_object('denial', 'feature_not_included');
    end if;
  else
    return pg_catalog.jsonb_build_object('denial', 'unsupported_role');
  end if;

  if p_date is not null then
    v_date_text := pg_catalog.btrim(p_date);
    if v_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
      return pg_catalog.jsonb_build_object('denial', 'invalid_date');
    end if;
    begin
      v_date := v_date_text::date;
    exception when others then
      return pg_catalog.jsonb_build_object('denial', 'invalid_date');
    end;
  end if;

  if p_status is not null and p_status not in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'MISSED') then
    return pg_catalog.jsonb_build_object('denial', 'invalid_status');
  end if;
  v_status_color := case p_status
    when 'COMPLETED' then 'mac-green'
    when 'MISSED' then 'gray'
    when 'PLANNED' then 'mac-blue'
    when 'IN_PROGRESS' then 'mac-blue'
    else null
  end;

  update public.workouts as w
     set date = case when p_date is not null then v_date_text else w.date end,
         title = case when p_title is not null then p_title else w.title end,
         "dayLabel" = case when p_day_label is not null then p_day_label else w."dayLabel" end,
         block_label = case when p_block_label is not null then nullif(pg_catalog.btrim(p_block_label), '') else w.block_label end,
         week_label = case when p_week_label is not null then nullif(pg_catalog.btrim(p_week_label), '') else w.week_label end,
         status = case when p_status is not null then p_status else w.status end,
         color = case when p_status is not null then v_status_color else w.color end,
         updated_at = v_now
   where w.id = p_workout_id
     and w.deleted_at is null
     and (
       (p_date is not null and w.date is distinct from v_date_text)
       or (p_title is not null and w.title is distinct from p_title)
       or (p_day_label is not null and w."dayLabel" is distinct from p_day_label)
       or (p_block_label is not null and w.block_label is distinct from nullif(pg_catalog.btrim(p_block_label), ''))
       or (p_week_label is not null and w.week_label is distinct from nullif(pg_catalog.btrim(p_week_label), ''))
       or (p_status is not null and (w.status is distinct from p_status or w.color is distinct from v_status_color))
     )
  returning w.* into v_workout;

  if not found then
    -- A no-op PATCH leaves the ORM onupdate timestamp unchanged.
    select w.* into v_workout
      from public.workouts as w
     where w.id = p_workout_id and w.deleted_at is null;
  end if;

  if not found then
    return pg_catalog.jsonb_build_object('denial', 'session_not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'session', pg_catalog.jsonb_build_object(
      'id', v_workout.id,
      'date', v_workout.date,
      'dayLabel', v_workout."dayLabel",
      'title', v_workout.title,
      'status', v_workout.status,
      'blockLabel', v_workout.block_label,
      'weekLabel', v_workout.week_label,
      'microcycleId', v_workout.microcycle_id,
      'ownerId', v_workout.owner_id
    )
  );
end;
$function$;

revoke all on function al_private.al_session_update(
  text, text, text, text, text, text, text, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function al_private.al_session_update(
  text, text, text, text, text, text, text, text, text, boolean, integer
) to al_edge_catalog_runtime;

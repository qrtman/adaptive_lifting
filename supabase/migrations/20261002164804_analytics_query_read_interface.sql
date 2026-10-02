-- Narrow, server-only read interface for POST /api/analytics/query.
-- The Edge API authenticates the Adaptive Lifting JWT first. This function
-- repeats session, account, athlete-link, and coach-entitlement checks so the
-- runtime login cannot use it to select an arbitrary athlete's training data.
create or replace function public.al_analytics_read_facts(
  p_actor_user_id text,
  p_session_id text,
  p_athlete_id text,
  p_start_date date,
  p_end_date date,
  p_include_acwr boolean,
  p_enforce_legacy_email_verification boolean,
  p_past_due_grace_days integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_workspace_id text;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_fetch_start date;
  v_set_rows jsonb;
  v_acwr_rows jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null or pg_catalog.length(p_actor_user_id) > 255
     or p_session_id is null or pg_catalog.length(p_session_id) > 255
     or p_athlete_id is null or pg_catalog.length(p_athlete_id) > 255
     or p_actor_user_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_athlete_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_past_due_grace_days is null or p_past_due_grace_days < 0
     or p_past_due_grace_days > 30 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  select u.role into v_actor_role
  from public.users as u
  join public.sessions as s on s.user_id = u.id
  where u.id = p_actor_user_id
    and s.id = p_session_id
    and s.jwt_id = p_session_id
    and s.revoked_at is null
    and s.expires_at > v_now
    and u.deleted_at is null;

  if v_actor_role is null then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;

  if exists (
    select 1 from public.users as u
    where u.id = p_actor_user_id
      and u.google_sub is null
      and u.email_verified_at is null
      and u.email_verification_required
      and (not u.email_verification_legacy_exempt or p_enforce_legacy_email_verification)
  ) then
    return pg_catalog.jsonb_build_object('denial', 'account_ineligible');
  end if;

  if v_actor_role = 'ATHLETE' then
    if p_athlete_id <> p_actor_user_id then
      return pg_catalog.jsonb_build_object('denial', 'athlete_forbidden');
    end if;
  elsif v_actor_role = 'COACH' then
    select w.id into v_workspace_id
    from public.workspaces as w
    join public.workspace_members as wm
      on wm.workspace_id = w.id
     and wm.user_id = p_actor_user_id
     and wm.role = 'OWNER'
    where w.owner_user_id = p_actor_user_id
    limit 1;

    if v_workspace_id is null or not (
      exists (
        select 1 from public.access_grants as ag
        where ag.workspace_id = v_workspace_id
          and ag.plan_key in ('coach_beta', 'coach_starter', 'coach_pro', 'coach_unlimited')
          and ag.starts_at <= v_now
          and (ag.expires_at is null or ag.expires_at > v_now)
          and ag.revoked_at is null
      ) or exists (
        select 1 from public.subscriptions as sub
        where sub.workspace_id = v_workspace_id
          and sub.plan_key in ('coach_beta', 'coach_starter', 'coach_pro', 'coach_unlimited')
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
      select 1 from public.coaching_relationships as cr
      where cr.coach_id = p_actor_user_id
        and cr.athlete_id = p_athlete_id
        and cr.ended_at is null
    ) then
      return pg_catalog.jsonb_build_object('denial', 'coach_relationship_required');
    end if;
  else
    return pg_catalog.jsonb_build_object('denial', 'unsupported_role');
  end if;

  v_fetch_start := case when p_include_acwr then p_start_date - 27 else p_start_date end;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'date', w.date, 'workout_id', w.id,
        'block_label', w.block_label, 'week_label', w.week_label,
        'workout_tonnage', coalesce(w.tonnage, 0),
        'exercise_id', e.id, 'title', e.title,
        'lift_category', coalesce(e.lift_category, 'Other'),
        'movement_pattern', coalesce(e.movement_pattern, 'Misc'),
        'tier', e.tier,
        'actual', coalesce(es.actual, 0),
        'reps', coalesce(es.reps, 0),
        'executed_rpe', coalesce(es."executedRpe", 0),
        'planned_weight', coalesce(es."plannedWeight", 0),
        'planned_reps', coalesce(es."plannedReps", 0),
        'planned_rpe', coalesce(es."plannedRpe", 0)
      ) order by w.date, e.id, es.id
    ), '[]'::jsonb
  ) into v_set_rows
  from public.workouts as w
  join public.microcycles as mc on mc.id = w.microcycle_id
  join public.exercises as e on e.workout_id = w.id
  join public.exercise_sets as es on es.exercise_id = e.id
  where mc.owner_id = p_athlete_id
    and w.deleted_at is null
    and e.deleted_at is null
    and es.deleted_at is null
    and w.date >= p_start_date::text
    and w.date <= p_end_date::text;

  if p_include_acwr then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'date', w.date, 'workout_id', w.id,
          'workout_tonnage', coalesce(w.tonnage, 0),
          'actual', es.actual, 'reps', es.reps
        ) order by w.date, w.id, e.id, es.id
      ), '[]'::jsonb
    ) into v_acwr_rows
    from public.workouts as w
    join public.microcycles as mc on mc.id = w.microcycle_id
    left join public.exercises as e on e.workout_id = w.id
    left join public.exercise_sets as es on es.exercise_id = e.id
    where mc.owner_id = p_athlete_id
      and w.deleted_at is null
      and w.date >= v_fetch_start::text
      and w.date <= p_end_date::text;
  end if;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'set_rows', v_set_rows,
    'acwr_rows', v_acwr_rows
  );
end;
$function$;

revoke all on function public.al_analytics_read_facts(text, text, text, date, date, boolean, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.al_analytics_read_facts(text, text, text, date, date, boolean, boolean, integer)
  to al_edge_catalog_runtime;

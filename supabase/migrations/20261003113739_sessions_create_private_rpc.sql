-- Narrow transactional interface for POST /api/sessions.
-- Application JWT validation occurs at Edge and the session/account checks are
-- repeated here. The function is the only runtime write path for this route.

create or replace function al_private.al_session_create(
  p_actor_user_id text,
  p_session_id text,
  p_requested_athlete_id text,
  p_date text,
  p_title text,
  p_day_label text,
  p_block_label text,
  p_week_label text,
  p_microcycle_id text,
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
  v_athlete_id text;
  v_workspace_id text;
  v_plan_key text;
  v_can_program boolean;
  v_date date;
  v_date_text text;
  v_microcycle_id text;
  v_workout_id text;
  v_workout_title text;
  v_day_label text;
  v_block_label text;
  v_week_label text;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_session_id is null or p_session_id = '' or pg_catalog.length(p_session_id) > 255
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

  if v_actor_role = 'ATHLETE' then
    -- Legacy resolve_athlete_id deliberately ignores athleteId for athletes.
    v_athlete_id := p_actor_user_id;
  elsif v_actor_role = 'COACH' then
    if p_requested_athlete_id is null or p_requested_athlete_id = '' then
      return pg_catalog.jsonb_build_object('denial', 'coach_athlete_required');
    end if;
    v_athlete_id := p_requested_athlete_id;
    perform 1
      from public.coaching_relationships as cr
      where cr.coach_id = p_actor_user_id
        and cr.athlete_id = v_athlete_id
        and cr.ended_at is null
      for update;
    if not found then
      return pg_catalog.jsonb_build_object('denial', 'coach_relationship_required');
    end if;

    -- Match get_coach_workspace(): only the coach's own workspace and OWNER
    -- membership count. Lock the boundary rows while checking its entitlement.
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

    -- Keep the Python PLAN_CONFIG keys and PLAN_PRECEDENCE semantics. Every
    -- currently supported plan includes programming; the explicit capability
    -- result preserves FEATURE_NOT_INCLUDED if the plan catalog adds a
    -- recognized non-programming tier later.
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

  v_date_text := pg_catalog.btrim(coalesce(p_date, ''));
  if v_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_date');
  end if;
  begin
    v_date := v_date_text::date;
  exception when others then
    return pg_catalog.jsonb_build_object('denial', 'invalid_date');
  end;
  if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> v_date_text then
    return pg_catalog.jsonb_build_object('denial', 'invalid_date');
  end if;

  v_workout_title := coalesce(nullif(pg_catalog.btrim(p_title), ''), 'Session');
  -- Python's `req.dayLabel or session_date`: empty/null falls back; whitespace
  -- is truthy and is therefore retained verbatim.
  v_day_label := case when p_day_label is null or p_day_label = '' then v_date_text else p_day_label end;
  v_block_label := nullif(pg_catalog.btrim(p_block_label), '');
  v_week_label := nullif(pg_catalog.btrim(p_week_label), '');

  if p_microcycle_id is not null and p_microcycle_id <> '' then
    select mc.id into v_microcycle_id
      from public.microcycles as mc
     where mc.id = p_microcycle_id
       and mc.owner_id = v_athlete_id
       and mc.deleted_at is null;
    if v_microcycle_id is null then
      return pg_catalog.jsonb_build_object('denial', 'microcycle_not_found');
    end if;
  else
    -- Serialize first creation per athlete so two simultaneous POSTs share a
    -- single live Ungrouped row. Tombstoned rows are intentionally ignored.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('session-create:ungrouped:' || v_athlete_id, 0)
    );
    select mc.id into v_microcycle_id
      from public.microcycles as mc
     where mc.owner_id = v_athlete_id
       and mc."weekName" = 'Ungrouped'
       and mc.deleted_at is null
     order by mc.id
     limit 1;
    if v_microcycle_id is null then
      v_microcycle_id := 'ungrouped-' || pg_catalog.substr(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8
      );
      insert into public.microcycles(id, "weekName", focus, status, active, owner_id, updated_at)
      values(v_microcycle_id, 'Ungrouped', 'Unlabeled sessions', 'DRAFT', true, v_athlete_id, v_now);
    end if;
  end if;

  v_workout_id := 'w-' || pg_catalog.substr(
    pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text || pg_catalog.txid_current()::text),
    1, 10
  );
  insert into public.workouts(
    id, date, "dayLabel", title, tonnage, delta, color, status,
    block_label, week_label, owner_id, microcycle_id, updated_at, deleted_at
  ) values (
    v_workout_id, v_date_text, v_day_label, v_workout_title, 0.0, 0.0,
    'mac-blue', 'PLANNED', v_block_label, v_week_label, v_athlete_id,
    v_microcycle_id, v_now, null
  );

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'session', pg_catalog.jsonb_build_object(
      'id', v_workout_id,
      'date', v_date_text,
      'dayLabel', v_day_label,
      'title', v_workout_title,
      'status', 'PLANNED',
      'blockLabel', v_block_label,
      'weekLabel', v_week_label,
      'microcycleId', v_microcycle_id,
      'ownerId', v_athlete_id,
      'exercises', '[]'::jsonb
    )
  );
end;
$function$;

revoke all on function al_private.al_session_create(
  text, text, text, text, text, text, text, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function al_private.al_session_create(
  text, text, text, text, text, text, text, text, text, boolean, integer
) to al_edge_catalog_runtime;

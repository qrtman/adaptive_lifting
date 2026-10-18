-- Defense in depth: child Workouts must belong to the authorized Microcycle owner.
-- Narrow read-only projection for GET /api/microcycles.
-- The Edge API validates the app JWT first; this function repeats session,
-- account, and athlete/coach relationship checks in the same read snapshot.

create or replace function al_private.al_microcycle_pattern_for(
  p_title text,
  p_lift_category text
) returns text
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select patterns.pattern
      from (values
        (1, 'Squat', 'Knee Dominant'),
        (2, 'Front Squat', 'Knee Dominant'),
        (3, 'Box Squat', 'Knee Dominant'),
        (4, 'SSB Squat', 'Knee Dominant'),
        (5, 'Split Squat', 'Knee Dominant'),
        (6, 'Leg Press', 'Knee Dominant'),
        (7, 'Deadlift', 'Hip Dominant'),
        (8, 'Sumo Deadlift', 'Hip Dominant'),
        (9, 'RDL', 'Hip Dominant'),
        (10, 'Good Morning', 'Hip Dominant'),
        (11, 'Hip Thrust', 'Hip Dominant'),
        (12, 'Bench', 'Horizontal Push'),
        (13, 'Close Grip Bench', 'Horizontal Push'),
        (14, 'Incline Bench', 'Horizontal Push'),
        (15, 'Floor Press', 'Horizontal Push'),
        (16, 'Press', 'Vertical Push'),
        (17, 'Push Press', 'Vertical Push'),
        (18, 'Chest Supported Row', 'Horizontal Pull'),
        (19, 'Cable Row', 'Horizontal Pull'),
        (20, 'Pull-up', 'Vertical Pull'),
        (21, 'Lat Pulldown', 'Vertical Pull'),
        (22, 'Curl', 'Misc'),
        (23, 'Tricep Extension', 'Misc'),
        (24, 'Face Pull', 'Misc'),
        (25, 'Clean', 'Weightlifting'),
        (26, 'Snatch', 'Weightlifting'),
        (27, 'Jerk', 'Weightlifting')
      ) as patterns(priority, title, pattern)
      where pg_catalog.strpos(
        pg_catalog.lower(coalesce(p_title, '')),
        pg_catalog.lower(patterns.title)
      ) > 0
      order by patterns.priority
      limit 1
    ),
    case coalesce(p_lift_category, 'Other')
      when 'Squat' then 'Knee Dominant'
      when 'Bench' then 'Horizontal Push'
      when 'Deadlift' then 'Hip Dominant'
      else 'Misc'
    end
  );
$function$;

create or replace function al_private.al_microcycles_read(
  p_actor_user_id text,
  p_session_id text,
  p_athlete_id text,
  p_enforce_legacy_email_verification boolean
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_google_sub text;
  v_email_verified_at timestamp without time zone;
  v_email_verification_required boolean;
  v_email_verification_legacy_exempt boolean;
  v_deleted_at timestamp without time zone;
  v_athlete_ids text[];
  v_payload jsonb;
begin
  if p_actor_user_id is null or p_actor_user_id = '' or pg_catalog.length(p_actor_user_id) > 255
     or p_session_id is null or p_session_id = '' or pg_catalog.length(p_session_id) > 255
     or (p_athlete_id is not null and (p_athlete_id = '' or pg_catalog.length(p_athlete_id) > 255)) then
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
    and s.expires_at > pg_catalog.timezone('utc', pg_catalog.now());

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
    if p_athlete_id is not null and p_athlete_id <> p_actor_user_id then
      return pg_catalog.jsonb_build_object('denial', 'athlete_forbidden');
    end if;
    v_athlete_ids := array[p_actor_user_id];
  elsif v_actor_role = 'COACH' then
    if p_athlete_id is not null then
      if not exists (
        select 1 from public.coaching_relationships as cr
        where cr.coach_id = p_actor_user_id
          and cr.athlete_id = p_athlete_id
          and cr.ended_at is null
      ) then
        return pg_catalog.jsonb_build_object('denial', 'coach_relationship_required');
      end if;
      v_athlete_ids := array[p_athlete_id];
    else
      select coalesce(pg_catalog.array_agg(cr.athlete_id order by cr.athlete_id), array[]::text[])
        into v_athlete_ids
      from public.coaching_relationships as cr
      where cr.coach_id = p_actor_user_id and cr.ended_at is null;
    end if;
  else
    return pg_catalog.jsonb_build_object('denial', 'unsupported_role');
  end if;

  select coalesce(pg_catalog.jsonb_agg(microcycle_json order by microcycle_id), '[]'::jsonb)
    into v_payload
  from (
    select mc.id as microcycle_id,
      pg_catalog.jsonb_build_object(
        'id', mc.id,
        'weekName', mc."weekName",
        'focus', mc.focus,
        'status', mc.status,
        'active', mc.active,
        'workouts', (
          select coalesce(pg_catalog.jsonb_agg(workout_json order by workout_id), '[]'::jsonb)
          from (
            select w.id as workout_id,
              pg_catalog.jsonb_build_object(
                'id', w.id,
                'date', w.date,
                'dayLabel', w."dayLabel",
                'title', w.title,
                'tonnage', w.tonnage,
                'delta', w.delta,
                'color', w.color,
                'status', w.status,
                'blockLabel', w.block_label,
                'weekLabel', w.week_label,
                'exercises', (
                  select coalesce(pg_catalog.jsonb_agg(exercise_json order by exercise_rank, exercise_id), '[]'::jsonb)
                  from (
                    select e.id as exercise_id,
                      coalesce(e.lexo_rank, '') as exercise_rank,
                      pg_catalog.jsonb_build_object(
                        'id', e.id,
                        'title', e.title,
                        'variation', e.variation,
                        'tier', coalesce(nullif(e.tier, ''), 'Comp'),
                        'liftCategory', coalesce(nullif(e.lift_category, ''), 'Other'),
                        'movementPattern', coalesce(nullif(e.movement_pattern, ''),
                          al_private.al_microcycle_pattern_for(e.title, e.lift_category)),
                        'liftNote', e.lift_note,
                        'tags', coalesce((
                          select pg_catalog.jsonb_agg(pg_catalog.btrim(tag_value) order by tag_order)
                          from pg_catalog.unnest(pg_catalog.string_to_array(coalesce(e.tags_raw, ''), ','))
                            with ordinality as tags(tag_value, tag_order)
                          where pg_catalog.btrim(tag_value) <> ''
                        ), '[]'::jsonb),
                        'top', e.top,
                        'vol', e.vol,
                        'sets', (
                          select coalesce(pg_catalog.jsonb_agg(set_json order by set_rank, set_id), '[]'::jsonb)
                          from (
                            select es.id as set_id,
                              coalesce(es.lexo_rank, '') as set_rank,
                              pg_catalog.jsonb_build_object(
                                'id', es.id,
                                'label', es.label,
                                'scope', coalesce(nullif(es.scope, ''), 'both'),
                                'plannedWeight', es."plannedWeight",
                                'plannedReps', es."plannedReps",
                                'plannedRpe', es."plannedRpe",
                                'actual', es.actual,
                                'reps', es.reps,
                                'executedRpe', es."executedRpe",
                                'velocity', es.velocity,
                                'readiness', es.readiness,
                                'hrv', es.hrv,
                                'isAuto', coalesce(es."isAuto", false),
                                'isTop', coalesce(es."isTop", false),
                                'intensityType', coalesce(nullif(es.intensity_type, ''), 'RPE'),
                                'dropPercent', coalesce(es."dropPercent", 0)
                              ) || case when es.note is null then '{}'::jsonb
                                        else pg_catalog.jsonb_build_object('note', es.note) end as set_json
                            from public.exercise_sets as es
                            where es.exercise_id = e.id and es.deleted_at is null
                          ) as set_rows
                        )
                      ) as exercise_json
                    from public.exercises as e
                    where e.workout_id = w.id and e.deleted_at is null
                  ) as exercise_rows
                )
              ) as workout_json
            from public.workouts as w
            where w.microcycle_id = mc.id and w.deleted_at is null and w.owner_id = mc.owner_id
          ) as workout_rows
        )
      ) as microcycle_json
    from public.microcycles as mc
    where mc.owner_id = any(v_athlete_ids)
      and mc.deleted_at is null
  ) as microcycle_rows;

  return pg_catalog.jsonb_build_object('denial', null, 'microcycles', coalesce(v_payload, '[]'::jsonb));
end;
$function$;

revoke all on function al_private.al_microcycle_pattern_for(text, text) from public, anon, authenticated;
revoke all on function al_private.al_microcycles_read(text, text, text, boolean) from public, anon, authenticated;
grant execute on function al_private.al_microcycles_read(text, text, text, boolean) to al_edge_catalog_runtime;

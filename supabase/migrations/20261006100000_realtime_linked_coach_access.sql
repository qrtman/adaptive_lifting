create or replace function al_private.al_realtime_workout_access(
  p_actor_user_id text,
  p_workout_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workouts as w
    left join public.microcycles as mc on mc.id = w.microcycle_id
    join public.users as workout_owner
      on workout_owner.id = coalesce(w.owner_id, mc.owner_id)
    where w.id = p_workout_id
      and w.deleted_at is null
      and (w.microcycle_id is null or mc.deleted_at is null)
      and workout_owner.deleted_at is null
      and (
        workout_owner.id = p_actor_user_id
        or (
          exists (
            select 1 from public.users as coach
            where coach.id = p_actor_user_id
              and coach.role = 'COACH'
              and coach.deleted_at is null
          )
          and exists (
            select 1 from public.coaching_relationships as cr
            where cr.coach_id = p_actor_user_id
              and cr.athlete_id = workout_owner.id
              and cr.ended_at is null
              and cr.deleted_at is null
          )
        )
      )
  );
$$;

alter function al_private.al_realtime_workout_access(text, text) owner to postgres;
revoke all on function al_private.al_realtime_workout_access(text, text)
  from public, anon, authenticated;
grant execute on function al_private.al_realtime_workout_access(text, text)
  to al_edge_catalog_runtime;

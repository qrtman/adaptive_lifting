-- A coach keeps their own training plan. Before this, every plan read/write
-- function sent COACH accounts down the linked-athlete path only, so a coach
-- could neither see nor log sessions they own (no coaching link to self).
--
-- Rule: when the actor owns the plan, authorize exactly as an athlete owner,
-- whatever their role. Coaching access (grant/subscription) and coaching
-- links still apply only to other athletes' plans.
--
-- Patched in place (same approach as 20261009170000): each function's role
-- branch `if v_actor_role = 'ATHLETE' then` becomes
-- `if v_actor_role = 'ATHLETE' or <actor owns the plan> then`. The athlete
-- branch already confirms ownership, so nothing else changes. The migration
-- fails if a branch is not found exactly once, so drift cannot be skipped.
-- Day notes, exports and realtime already include the coach's own plan.
do $migration$
declare
  v_target record;
  v_proc record;
  v_definition text;
  v_old text := 'if v_actor_role = ''ATHLETE'' then';
  v_new text;
  v_patched integer;
begin
  for v_target in
    select * from (values
      ('al_private', 'al_workout_sync', 'v_owner_id = p_actor_user_id'),
      ('al_private', 'al_session_update', 'v_owner_id = p_actor_user_id'),
      ('al_private', 'al_set_log', 'v_owner_id = p_actor_user_id'),
      ('al_private', 'al_session_create', 'p_requested_athlete_id = p_actor_user_id'),
      ('al_private', 'al_microcycles_read', 'p_athlete_id = p_actor_user_id'),
      ('public', 'al_analytics_read_facts', 'p_athlete_id = p_actor_user_id')
    ) as t(schema_name, function_name, owns_plan)
  loop
    v_new := 'if v_actor_role = ''ATHLETE'' or ' || v_target.owns_plan || ' then';
    v_patched := 0;
    for v_proc in
      select p.oid from pg_catalog.pg_proc as p
        join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = v_target.schema_name and p.proname = v_target.function_name
    loop
      v_definition := pg_catalog.pg_get_functiondef(v_proc.oid);
      if pg_catalog.strpos(v_definition, v_new) > 0 then
        v_patched := v_patched + 1;  -- already applied
        continue;
      end if;
      -- Overloads without a role branch (e.g. the al_workout_sync revision
      -- wrapper) delegate to the patched function; leave them alone.
      if pg_catalog.strpos(v_definition, v_old) = 0 then continue; end if;
      if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
           / pg_catalog.length(v_old) <> 1 then
        raise exception '%.%: expected exactly one athlete branch', v_target.schema_name, v_target.function_name;
      end if;
      execute pg_catalog.replace(v_definition, v_old, v_new);
      v_patched := v_patched + 1;
    end loop;
    if v_patched = 0 then
      raise exception '%.%: athlete branch not found', v_target.schema_name, v_target.function_name;
    end if;
  end loop;
end;
$migration$;

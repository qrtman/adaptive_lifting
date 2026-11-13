-- Set notes in the Plan sync (session sheet phase 6). The web grid saves a lift's
-- sets as one Exercise `{ sets }` sync mutation. That nested set write ignored
-- `note`: an update kept the old note, an insert wrote none. Set notes could only
-- be saved through the Set Log RPC (Telegram).
--
-- Rule: when a nested set item carries a `note` key, it is written (empty → null);
-- without the key the stored note is kept, so older clients never erase notes.
--
-- Patched in place, like 20261111120000: each fragment of al_private.al_workout_sync
-- must be found exactly once, or the migration fails. Re-running is a no-op.
do $migration$
declare
  v_proc record;
  v_definition text;
  v_patched integer := 0;
  v_fragment record;
  v_marker text := 'note = case when v_item ? ''note'' then';
begin
  for v_proc in
    select p.oid from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'al_private' and p.proname = 'al_workout_sync'
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_proc.oid);
    if pg_catalog.strpos(v_definition, v_marker) > 0 then
      v_patched := v_patched + 1;  -- already applied
      continue;
    end if;
    -- The revision wrapper overload has no nested set write; it calls the patched one.
    if pg_catalog.strpos(v_definition, 'v_item ? ''dropPercent''') = 0 then continue; end if;
    for v_fragment in
      select * from (values
        -- Update of an existing set.
        ($old$"dropPercent" = case when v_item ? 'dropPercent' then (v_item->>'dropPercent')::double precision else null end,$old$,
         $new$"dropPercent" = case when v_item ? 'dropPercent' then (v_item->>'dropPercent')::double precision else null end,
              note = case when v_item ? 'note' then nullif(pg_catalog.btrim(v_item->>'note'),'') else es.note end,$new$),
        -- Insert of a new set: column list, then its value.
        ($old$"executedRpe","dropPercent",updated_at)$old$,
         $new$"executedRpe","dropPercent",note,updated_at)$new$),
        ($old$case when v_item ? 'dropPercent' then (v_item->>'dropPercent')::double precision else null end,v_now);$old$,
         $new$case when v_item ? 'dropPercent' then (v_item->>'dropPercent')::double precision else null end,
              nullif(pg_catalog.btrim(v_item->>'note'),''),v_now);$new$)
      ) as f(old_text, new_text)
    loop
      if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_fragment.old_text, '')))
           / pg_catalog.length(v_fragment.old_text) <> 1 then
        raise exception 'al_workout_sync: expected exactly one fragment %', v_fragment.old_text;
      end if;
      v_definition := pg_catalog.replace(v_definition, v_fragment.old_text, v_fragment.new_text);
    end loop;
    execute v_definition;
    v_patched := v_patched + 1;
  end loop;
  if v_patched = 0 then
    raise exception 'al_workout_sync: nested set write not found';
  end if;
end;
$migration$;
